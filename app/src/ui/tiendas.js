/* Tiendas de la competencia: catálogo público de Shopify y señales de venta (dentro de la pestaña Competencia) */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const R = VC.research;
  const S = VC.stores;
  const A = VC.auto;
  const { Store, Browser } = VC.runtime;
  const { e, $, App, chip, emptyState, toast, storeFail } = VC.ui;

  const CADA = [24, 48, 72];
  const TONO = { alto: 'good', medio: 'info', bajo: 'neutral' };

  const state = {
    docs: new Map(), // dominio → documento guardado
    anuncios: {}, // dominio → {anuncios, diasMax} (de los anuncios guardados en Competencia)
    log: [], // [{st: 'ok'|'err', texto}] de la corrida en curso o la última
    enCola: false,
    confirmar: null, // {d, hasta}: botón Quitar esperando el segundo toque
  };
  let el = null;
  let unwatch = null;
  let suscripto = false;

  /* ---------- Tarea automática ---------- */

  async function revisarTiendas(ctx) {
    const cfg = A.cfg.tiendas || {};
    const guardadas = await Store.list('tiendas');
    const dominios = S.dominiosARevisar(cfg.dominios, guardadas, cfg.quitadas);
    state.log = [];
    paintStatus();
    if (!dominios.length) return { novedades: 0, tiendas: 0, resumen: 'No hay tiendas para revisar.' };
    const totales = { nuevos: 0, precios: 0, agotados: 0, repuestos: 0, resenas: 0 };
    let hechas = 0;
    let errores = 0;
    for (let i = 0; i < dominios.length; i++) {
      if (ctx.signal.aborted) break;
      const d = dominios[i];
      const paso = i + 1 + '/' + dominios.length + ' · ' + d;
      ctx.progress(paso);
      let cat = null;
      let error = '';
      const resenas = {};
      try {
        const texto = await Browser.read(R.productsJsonUrl(d), { ready: R.shopifyReady, tries: 3, firstWait: 1500, wait: 2000 });
        cat = S.leerCatalogo(texto);
        if (!cat) error = S.motivoError(texto);
      } catch (err) {
        if (Browser.fatal(err)) throw new Error(Browser.errorText(err));
        error = Browser.errorText(err);
      }
      // Reseñas de sus productos de postura (las páginas de producto las muestran; el catálogo no)
      const top = cat ? S.posturaOrdenada(cat.productos).slice(0, S.TOPE_RESENAS) : [];
      for (let j = 0; j < top.length && !ctx.signal.aborted; j++) {
        ctx.progress(paso + ' · reseñas ' + (j + 1) + '/' + top.length);
        try {
          resenas[top[j].handle] = R.reviewCount(await Browser.read(R.productUrl(d, top[j].handle), { tries: 2 }));
        } catch (err) {
          if (Browser.fatal(err)) throw new Error(Browser.errorText(err));
          resenas[top[j].handle] = null;
        }
      }
      const prev = guardadas.get(d) || null;
      const r = S.revisar(prev, {
        dominio: d,
        fecha: new Date().toISOString(),
        productos: cat ? cat.productos : null,
        parcial: cat ? cat.parcial : false,
        resenas,
        error,
        origen: prev ? prev.origen : 'anuncio', // sin documento: la sumó el escaneo de anuncios
      });
      hechas++;
      // Si la quitaron mientras se revisaba, no se vuelve a guardar
      if ((A.cfg.tiendas.quitadas || []).includes(d)) continue;
      let guardo = true;
      await Store.set('tiendas/' + d, r.doc).catch(() => (guardo = false));
      state.docs.set(d, r.doc);
      if (r.doc.ultima.error) {
        errores++;
        state.log.push({ st: 'err', texto: d + ' · ' + r.doc.ultima.error });
      } else {
        for (const k of Object.keys(totales)) totales[k] += r.cuenta[k];
        state.log.push({ st: 'ok', texto: d + ' · ' + lineaLog(r) + (guardo ? '' : ' (no se pudo guardar)') });
      }
      paintList();
    }
    const novedades = totales.nuevos + totales.precios + totales.agotados + totales.repuestos + totales.resenas;
    return {
      novedades,
      tiendas: hechas,
      cambios: totales.nuevos + totales.precios + totales.agotados + totales.repuestos,
      resenas: totales.resenas,
      errores,
      resumen: S.resumenCorrida(hechas, totales, errores),
    };
  }

  function lineaLog(r) {
    const u = r.doc.ultima;
    const n = u.total + ' producto' + (u.total === 1 ? '' : 's');
    if (!r.doc.cambios) return n + ', primera revisión';
    const c = r.cuenta.nuevos + r.cuenta.precios + r.cuenta.agotados + r.cuenta.repuestos;
    return n + ', ' + (c ? c + ' cambio' + (c === 1 ? '' : 's') : 'sin cambios') + (r.cuenta.resenas ? ', +' + r.cuenta.resenas + ' reseñas' : '');
  }

  A.register('tiendas', { needs: ['browser'], run: revisarTiendas });

  /* ---------- Interfaz ---------- */

  function mount(container) {
    if (!container) return;
    if (el === container && $('.tn', el)) {
      render();
      return;
    }
    el = container;
    el.innerHTML =
      '<section class="panel auto-panel tn" aria-labelledby="tn-title"><div class="auto-head"><h3 id="tn-title">Tiendas de la competencia</h3><div class="auto-meta" id="tn-meta"></div></div>' +
      '<p class="muted small">Lee el catálogo público de cada tienda Shopify (precios, precio tachado, qué está agotado y cuándo publicó cada producto) y las reseñas de sus correctores. Shopify no muestra las ventas de otros: comparando una revisión con la siguiente se ven lanzamientos, cambios de precio, productos que se agotan y se reponen, y reseñas nuevas. Son señales de venta, no ventas exactas, y las reseñas pueden ser inventadas.</p>' +
      '<form class="tn-add" id="tn-add" novalidate><label for="tn-dominio" class="sr-only">Dominio o dirección de la tienda</label><input id="tn-dominio" name="dominio" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="tienda.com.ar o el link de la tienda"><button class="btn ghost" type="submit">Agregar tienda</button></form>' +
      '<div id="tn-ctrl" class="tn-ctrl"></div><div id="tn-prog" class="tn-prog"></div><div id="tn-summary"></div><div id="tn-list" class="tn-list"></div></section>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('submit', onSubmit);
    if (!unwatch) {
      unwatch = Store.watch(
        'tiendas',
        (m) => {
          state.docs = m;
          paintList();
        },
        () => Store.list('tiendas').then((m) => ((state.docs = m), paintList()))
      );
    }
    if (!suscripto) {
      suscripto = true;
      A.on(onAuto);
    }
    cargarAnuncios();
    render();
  }

  function render() {
    paintStatus();
    paintList();
  }

  function montado() {
    return !!(el && el.isConnected && $('.tn', el));
  }

  function cargarAnuncios() {
    Store.list('competencia')
      .then((m) => {
        state.anuncios = S.anunciosPorDominio([...m.values()]);
        paintList();
      })
      .catch(() => {});
  }

  function onAuto(ev) {
    if (!montado()) return;
    if (ev.type === 'cfg') {
      render();
      return;
    }
    if (ev.job === 'tiendas') {
      if (ev.type === 'progress') {
        paintProg();
        return;
      }
      state.enCola = false;
      if (ev.type === 'skip' && ev.motivo) state.log = [{ st: 'err', texto: ev.motivo }];
      render();
      return;
    }
    if (ev.job === 'competencia' && ev.type === 'done') cargarAnuncios();
    if (ev.type === 'start' || ev.type === 'done' || ev.type === 'error') paintCtrl();
  }

  // Dominios que se siguen: los de la configuración (manuales y del escaneo de anuncios) y los guardados, sin los quitados
  function dominios() {
    const c = A.cfg.tiendas || {};
    const fuera = new Set(c.quitadas || []);
    const set = new Set();
    for (const x of (c.dominios || []).concat([...state.docs.keys()])) {
      const n = R.normalizeDomain(x);
      if (n && R.isStoreDomain(n) && !fuera.has(n)) set.add(n);
    }
    return [...set];
  }

  function paintStatus() {
    paintCtrl();
    paintProg();
  }

  function paintCtrl() {
    if (!montado()) return;
    const box = $('#tn-ctrl', el);
    if (!Browser.checked) {
      box.innerHTML = '<p class="muted small">Buscando el navegador de Claude en tu PC…</p>';
      return;
    }
    if (!Browser.available) {
      box.innerHTML =
        '<div class="auto-off">La revisión usa el navegador de Claude en tu PC, que solo está disponible si abrís este panel desde la app de escritorio de Claude (Cowork). Igual podés agregar o quitar tiendas y ver lo que ya se revisó.</div>';
      return;
    }
    const c = A.cfg.tiendas || {};
    const corriendo = A.running === 'tiendas';
    const otra = A.running && !corriendo ? A.running : null;
    const n = dominios().length;
    const horas = Number(c.cadaHoras) || 24;
    const opts = CADA.includes(horas) ? CADA : CADA.concat([horas]).sort((a, b) => a - b);
    box.innerHTML =
      '<div class="row-actions">' +
      (corriendo
        ? '<button class="btn ghost" data-act="tn-detener">Detener</button>'
        : '<button class="btn" data-act="tn-revisar"' + (n && !state.enCola ? '' : ' disabled') + '>Revisar tiendas ahora</button>') +
      (state.enCola && otra ? '<span class="muted small">En cola: espera que termine ' + e(A.NOMBRES[otra] || otra) + '.</span>' : '') +
      (!n ? '<span class="muted small">Agregá una tienda para revisarla.</span>' : '') +
      '</div><div class="auto-toggles"><label><input type="checkbox" id="tn-auto"' +
      (c.auto ? ' checked' : '') +
      '> Revisar solas al abrir el panel</label><label for="tn-cada">cada <select id="tn-cada">' +
      opts.map((h) => '<option value="' + h + '"' + (h === horas ? ' selected' : '') + '>' + h + '</option>').join('') +
      '</select> horas</label></div>';
  }

  function paintProg() {
    if (!montado()) return;
    const est = A.estado.tiendas;
    const c = A.cfg.tiendas || {};
    const corriendo = A.running === 'tiendas';
    const meta = [];
    meta.push(est && est.ultima ? 'Última revisión ' + U.timeAgo(est.ultima) + (est.origen === 'auto' ? ' (sola)' : '') : 'Todavía no se revisó');
    meta.push(dominios().length + ' tienda' + (dominios().length === 1 ? '' : 's'));
    if (c.auto) meta.push('se revisan solas cada ' + (Number(c.cadaHoras) || 24) + ' h');
    $('#tn-meta', el).innerHTML = meta.map((m) => '<span>' + e(m) + '</span>').join('');
    let h = '';
    if (corriendo || state.log.length) {
      h +=
        '<ul class="auto-progress" aria-live="polite">' +
        state.log.map((l) => '<li><span class="st ' + (l.st === 'ok' ? 'ok' : 'err') + '">' + (l.st === 'ok' ? 'listo' : 'error') + '</span><span class="tn-log">' + e(l.texto) + '</span></li>').join('') +
        (corriendo ? '<li><span class="st">revisando</span><span class="tn-log">' + e(A.progress.tiendas || 'Empezando…') + '</span></li>' : '') +
        '</ul>';
    }
    if (!corriendo && est) {
      if (est.resultado && est.resultado.resumen) h += '<p class="small">' + e(est.resultado.resumen) + '</p>';
      if (est.error) h += '<p class="error-text">' + e(est.error === 'Cancelado.' ? 'La última revisión se detuvo antes de terminar.' : est.error) + '</p>';
    }
    $('#tn-prog', el).innerHTML = h;
  }

  function paintList() {
    if (!montado()) return;
    const hoy = U.todayKeyAR();
    const items = dominios().map((d) => {
      const doc = state.docs.get(d) || null;
      return { d, doc, mv: S.movimiento(doc, { hoy, anuncios: state.anuncios[d] }) };
    });
    items.sort((a, b) => (a.mv.nivel ? 0 : 1) - (b.mv.nivel ? 0 : 1) || b.mv.puntos - a.mv.puntos || a.d.localeCompare(b.d));
    paintSummary(items);
    const box = $('#tn-list', el);
    if (!items.length) {
      box.innerHTML = emptyState(
        'Todavía no seguís ninguna tienda',
        'Pegá arriba el dominio o el link de un competidor (por ejemplo, la tienda a la que llevan sus anuncios) y tocá “Agregar tienda”. El escaneo de anuncios de esta pestaña también suma solo las tiendas que encuentra.'
      );
      return;
    }
    box.innerHTML = items.map((x) => card(x, hoy)).join('');
  }

  function paintSummary(items) {
    const box = $('#tn-summary', el);
    const rev = items.filter((x) => x.mv.nivel);
    if (!rev.length) {
      box.innerHTML = '';
      return;
    }
    const altos = rev.filter((x) => x.mv.nivel === 'alto').length;
    let cambios = 0;
    let resenas = 0;
    for (const x of rev) {
      const k = x.doc.cambios;
      if (!k) continue;
      cambios += (k.conteo.nuevos || 0) + (k.conteo.precios || 0) + (k.conteo.agotados || 0) + (k.conteo.repuestos || 0);
      resenas += U.sum(k.resenas || [], (r) => r.suma);
    }
    box.innerHTML =
      '<div class="summary-strip">' +
      stat(rev.length, 'tiendas revisadas') +
      stat(altos, 'con movimiento alto', altos ? 'good' : '') +
      stat(cambios, 'cambios en la última revisión') +
      stat(resenas ? '+' + U.int(resenas) : 0, 'reseñas nuevas') +
      '</div>';
  }

  function stat(v, label, tone) {
    return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><span class="stat-value">' + e(v) + '</span><span class="stat-label">' + e(label) + '</span></div>';
  }

  function card(x, hoy) {
    const { d, doc, mv } = x;
    const u = doc && doc.ultima;
    const origen = !doc || doc.origen === 'anuncio' ? 'La sumó el escaneo de anuncios' : 'Agregada a mano';
    let cuando = u && u.fecha ? 'Revisada ' + U.timeAgo(u.fecha) : 'Todavía no se revisó';
    if (u && u.error && u.intento) cuando += ' · el último intento ' + U.timeAgo(u.intento) + ' falló';
    let h =
      '<article class="tn-card' +
      (mv.nivel ? ' is-' + mv.nivel : '') +
      '"><header class="tn-card-head"><div class="tn-name"><a class="tn-dom" href="https://' +
      e(d) +
      '" target="_blank" rel="noopener">' +
      e(d) +
      '</a><span class="muted small">' +
      e(cuando + ' · ' + origen) +
      '</span></div>' +
      chip(mv.nivel ? 'Movimiento ' + mv.nivel : 'Sin revisar', mv.nivel ? TONO[mv.nivel] : 'neutral') +
      '</header>';
    if (u && u.fecha) {
      const lz = S.lanzamientos(u.productos, hoy).length;
      h +=
        '<p class="small tn-why">' +
        e(mv.texto) +
        '</p><ul class="tn-facts"><li><strong>' +
        e(U.int(u.total != null ? u.total : u.productos.length)) +
        '</strong> productos</li><li><strong>' +
        e(U.int(u.agotados != null ? u.agotados : u.productos.filter((p) => !p.disponible).length)) +
        '</strong> agotados</li><li><strong>' +
        e(U.int(lz)) +
        '</strong> publicados en los últimos ' +
        S.DIAS_LANZAMIENTO +
        ' días</li>' +
        (u.parcial ? '<li>catálogo leído en parte</li>' : '') +
        '</ul>' +
        corrector(d, doc, hoy) +
        cambios(doc) +
        historial(doc);
    } else if (!u || !u.error) {
      h += '<p class="muted small">' + (Browser.available ? 'Tocá “Revisar tiendas ahora” para leer su catálogo.' : 'Se va a revisar cuando abras el panel desde la app de escritorio de Claude.') + '</p>';
    }
    if (u && u.error) h += '<p class="error-text">' + e(u.error) + '</p>';
    const conf = state.confirmar && state.confirmar.d === d && Date.now() < state.confirmar.hasta;
    h +=
      '<div class="row-actions tn-actions"><button type="button" class="btn link tn-quitar' +
      (conf ? ' is-confirm' : '') +
      '" data-act="tn-quitar" data-d="' +
      e(d) +
      '" aria-label="Dejar de seguir ' +
      e(d) +
      '">' +
      (conf ? 'Tocá de nuevo para quitar' : 'Quitar') +
      '</button></div></article>';
    return h;
  }

  function corrector(d, doc, hoy) {
    const u = doc.ultima;
    const res = u.resenas || {};
    const c = S.principal(u.productos, res);
    if (!c) return '<div class="tn-corr"><span class="eyebrow">Su corrector</span><p class="muted small">No encontramos productos de postura en su catálogo.</p></div>';
    const delta = ((doc.cambios && doc.cambios.resenas) || []).find((r) => r.handle === c.handle);
    const dias = R.daysSince(c.publicado || c.creado, hoy);
    const cmp = S.compararPrecio(c.precioMin, App.tienda.precio1);
    const facts = [chip(c.disponible ? 'Disponible' : 'Agotado', c.disponible ? 'good' : 'bad')];
    if (c.variantes > 1) facts.push(e(c.disponibles + ' de ' + c.variantes + ' variantes con stock'));
    if (dias != null) facts.push(e('Publicado hace ' + dias + (dias === 1 ? ' día' : ' días')));
    facts.push(
      res[c.handle] != null
        ? '<strong>' + e(U.int(res[c.handle])) + '</strong> reseñas' + (delta ? ' <span class="tn-delta' + (delta.suma ? ' is-up' : '') + '">+' + e(U.int(delta.suma)) + ' desde la revisión anterior</span>' : '')
        : 'Sin reseñas visibles'
    );
    const est = delta ? S.ventasEstimadas(delta.suma) : null;
    const otros = S.posturaOrdenada(u.productos)
      .filter((p) => p.id !== c.id)
      .slice(0, 4);
    return (
      '<div class="tn-corr"><div class="tn-corr-head"><span class="eyebrow">Su corrector</span><a href="' +
      e(R.productUrl(d, c.handle)) +
      '" target="_blank" rel="noopener">' +
      e(c.titulo || c.handle) +
      '</a></div><div class="tn-price"><strong>' +
      e(U.money(c.precioMin)) +
      '</strong>' +
      (c.tachado && c.tachado > c.precioMin ? '<s>' + e(U.money(c.tachado)) + '</s>' : '') +
      (cmp ? chip(cmp.texto, cmp.tono) : '') +
      '</div><ul class="tn-facts">' +
      facts.map((f) => '<li>' + f + '</li>').join('') +
      '</ul>' +
      (est
        ? '<p class="note">Si esas ' +
          e(U.int(delta.suma)) +
          ' reseñas nuevas son reales, del orden de ' +
          e(U.int(est.min)) +
          ' a ' +
          e(U.int(est.max)) +
          ' ventas desde el ' +
          e(U.fmtDay(U.dayKeyAR(doc.cambios.desde))) +
          ' (se suele dejar 1 reseña cada ' +
          S.COMPRAS_POR_RESENA[0] +
          ' a ' +
          S.COMPRAS_POR_RESENA[1] +
          ' compras). Es una estimación gruesa.</p>'
        : '') +
      (otros.length
        ? '<ul class="tn-otros">' +
          otros
            .map(
              (p) =>
                '<li><a href="' +
                e(R.productUrl(d, p.handle)) +
                '" target="_blank" rel="noopener">' +
                e(p.titulo || p.handle) +
                '</a><span class="muted">' +
                e(U.money(p.precioMin) + (p.disponible ? '' : ' · agotado') + (res[p.handle] != null ? ' · ' + U.int(res[p.handle]) + ' reseñas' : '')) +
                '</span></li>'
            )
            .join('') +
          '</ul>'
        : '') +
      '</div>'
    );
  }

  const GRUPOS = [
    ['nuevos', 'Nuevo', 'info', (x) => x.titulo + ' · ' + U.money(x.precio)],
    ['precios', 'Precio', 'warn', (x) => x.titulo + ': ' + U.money(x.antes) + ' → ' + U.money(x.ahora)],
    ['agotados', 'Se agotó', 'bad', (x) => x.titulo + ' · ' + U.money(x.precio)],
    ['repuestos', 'Repuesto', 'good', (x) => x.titulo + ' · ' + U.money(x.precio)],
    ['variantes', 'Variantes', 'neutral', (x) => x.titulo + ': ' + x.ahora + ' de ' + x.de + ' con stock (antes ' + x.antes + ')'],
    ['resenas', 'Reseñas', 'source', (x) => x.titulo + ': +' + U.int(x.suma) + ' (' + U.int(x.ahora) + ' en total)'],
    ['quitados', 'Quitado', 'neutral', (x) => x.titulo + ' · ' + U.money(x.precio)],
  ];

  function cambios(doc) {
    const k = doc.cambios;
    if (!k) return '<p class="muted small">Primera revisión: los cambios aparecen a partir de la próxima.</p>';
    const conteo = k.conteo || {};
    let total = 0;
    let lis = '';
    for (const [key, label, tone, fmt] of GRUPOS) {
      const list = (k[key] || []).filter((x) => key !== 'resenas' || x.suma > 0);
      const n = key === 'resenas' ? list.length : conteo[key] || list.length;
      total += n;
      lis += list.map((x) => '<li>' + chip(label, tone) + '<span>' + e(fmt(x)) + '</span></li>').join('');
      if (n > list.length) lis += '<li class="muted small">y ' + (n - list.length) + ' más (' + e(label.toLowerCase()) + ')</li>';
    }
    const desde = U.fmtDay(U.dayKeyAR(k.desde));
    if (!total) return '<p class="muted small">Sin cambios desde la revisión del ' + e(desde) + '.</p>';
    return '<details class="tn-changes"' + (total <= 6 ? ' open' : '') + '><summary>Cambios desde el ' + e(desde) + ' (' + total + ')</summary><ul>' + lis + '</ul></details>';
  }

  function historial(doc) {
    const h = (doc.historial || []).filter((x) => x && x.fecha);
    if (h.length < 2) return '';
    const n = (v) => (v == null ? '—' : e(U.int(v)));
    return (
      '<details class="tn-hist"><summary>Historial (' +
      h.length +
      ' revisiones)</summary><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th class="num">Productos</th><th class="num">Agotados</th><th class="num">Corrector</th><th class="num">Reseñas</th></tr></thead><tbody>' +
      h
        .slice()
        .reverse()
        .map(
          (x) =>
            '<tr><th scope="row">' +
            e(U.fmtDay(U.dayKeyAR(x.fecha))) +
            '</th><td class="num">' +
            n(x.productos) +
            '</td><td class="num">' +
            n(x.agotados) +
            '</td><td class="num">' +
            (x.precioCorrector == null ? '—' : e(U.money(x.precioCorrector))) +
            '</td><td class="num">' +
            n(x.resenasTotal) +
            (x.resenasNuevas ? ' <span class="tn-delta is-up">+' + e(U.int(x.resenasNuevas)) + '</span>' : '') +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table></div></details>'
    );
  }

  /* ---------- Acciones ---------- */

  function agregar(raw) {
    const d = R.normalizeDomain(raw);
    if (!d) {
      toast('Escribí el dominio de la tienda, por ejemplo tienda.com.ar.', 'warn');
      return false;
    }
    if (!R.isStoreDomain(d)) {
      toast('Eso es una red social, un marketplace o un acortador: poné el dominio de la tienda propia.', 'warn');
      return false;
    }
    if (dominios().includes(d)) {
      toast('Ya seguís ' + d + '.', 'warn');
      return false;
    }
    const doc = S.docBase(d, new Date().toISOString(), 'manual');
    state.docs.set(d, doc);
    const c = A.cfg.tiendas || {};
    A.setCfg('tiendas', { dominios: [...new Set((c.dominios || []).concat(d))], quitadas: (c.quitadas || []).filter((x) => x !== d) });
    Store.set('tiendas/' + d, doc).catch(storeFail);
    toast(Browser.available ? 'Agregaste ' + d + '. Tocá “Revisar tiendas ahora” para leer su catálogo.' : 'Agregaste ' + d + '. Se revisa cuando abras el panel desde la app de escritorio de Claude.', 'good');
    return true;
  }

  function quitar(d) {
    const c = A.cfg.tiendas || {};
    state.confirmar = null;
    state.docs.delete(d);
    // "quitadas" evita que el escaneo de anuncios la vuelva a sumar
    A.setCfg('tiendas', { dominios: (c.dominios || []).filter((x) => R.normalizeDomain(x) !== d), quitadas: [...new Set((c.quitadas || []).concat(d))].slice(-200) });
    Store.remove('tiendas/' + d).catch(storeFail);
    toast('Dejaste de seguir ' + d + '.', 'good');
  }

  function onSubmit(ev) {
    const f = ev.target.closest('#tn-add');
    if (!f) return;
    ev.preventDefault();
    const inp = $('#tn-dominio', f);
    if (agregar(inp.value)) inp.value = '';
    inp.focus();
  }

  function onChange(ev) {
    if (ev.target.id === 'tn-auto') A.setCfg('tiendas', { auto: ev.target.checked });
    else if (ev.target.id === 'tn-cada') A.setCfg('tiendas', { cadaHoras: Number(ev.target.value) || 24 });
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t || !el.contains(t) || !t.closest('.tn')) return;
    switch (t.dataset.act) {
      case 'tn-revisar':
        state.log = [];
        state.enCola = !!A.running && A.running !== 'tiendas';
        A.run('tiendas', { origen: 'manual' });
        paintStatus();
        break;
      case 'tn-detener':
        if (A.running === 'tiendas') A.stop();
        break;
      case 'tn-quitar': {
        const d = t.dataset.d;
        if (state.confirmar && state.confirmar.d === d && Date.now() < state.confirmar.hasta) {
          quitar(d);
          return;
        }
        state.confirmar = { d, hasta: Date.now() + 4000 };
        t.classList.add('is-confirm');
        t.textContent = 'Tocá de nuevo para quitar';
        setTimeout(() => {
          if (state.confirmar && state.confirmar.d === d && Date.now() >= state.confirmar.hasta) {
            state.confirmar = null;
            if (t.isConnected) {
              t.classList.remove('is-confirm');
              t.textContent = 'Quitar';
            }
          }
        }, 4100);
        break;
      }
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.tiendas = { mount, render };
})(window);
