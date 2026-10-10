/* Tiendas de la competencia: catálogo público de Shopify y señales de venta (dentro de la pestaña Competencia) */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const R = VC.research;
  const S = VC.stores;
  const A = VC.auto;
  const { Store, Browser } = VC.runtime;
  const { e, $, App, chip, emptyState, toast, storeFail, icon, bubble, info, more, toggle } = VC.ui;

  const CADA = [24, 48, 72];
  const TONO = { alto: 'good', medio: 'info', bajo: 'neutral' };

  const state = {
    docs: new Map(), // dominio → documento guardado
    anuncios: {}, // dominio → {anuncios, diasMax} (de los anuncios guardados en Competencia)
    log: [], // [{st: 'ok'|'err', texto}] de la corrida en curso o la última
    enCola: false,
    confirmar: null, // {d, hasta}: botón Quitar esperando el segundo toque
    skip: '', // por qué no se pudo revisar (si el motor la salteó)
    det: {}, // desplegables abiertos o cerrados a mano en cada tarjeta
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

  const EXPLICA =
    'Leo el catálogo público de cada tienda Shopify (precios, agotados y productos nuevos) y las reseñas de sus correctores. Shopify no muestra las ventas de otros: comparando una revisión con la siguiente se ven lanzamientos, cambios de precio y reseñas nuevas. Son señales, no ventas exactas, y las reseñas pueden ser inventadas.';
  const MOV = { alto: 'Mucho movimiento', medio: 'Algo de movimiento', bajo: 'Poco movimiento' };
  // Precio que no se corta entre "$" y el número
  const plata = (n) => U.money(n).replace(' ', '\u00a0');

  function mount(container) {
    if (!container) return;
    if (el === container && $('.tn', el)) {
      render();
      return;
    }
    el = container;
    el.innerHTML =
      '<section class="panel tn" aria-labelledby="tn-title">' +
      '<div class="tn-top">' +
      bubble('store', 'source') +
      '<div class="tn-top-txt"><div class="tn-title"><h3 id="tn-title">Tiendas</h3>' +
      info(EXPLICA, 'Cómo se miden las tiendas') +
      '</div><p class="tn-meta" id="tn-meta"></p></div><div class="row-actions" id="tn-act"></div></div>' +
      '<div id="tn-ctrl" class="tn-ctrl"></div><div id="tn-prog" class="tn-prog"></div>' +
      '<form class="tn-add" id="tn-add" novalidate><label for="tn-dominio" class="sr-only">Dominio o link de la tienda</label><input id="tn-dominio" name="dominio" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="tienda.com.ar o su link"><button class="btn ghost" type="submit">' +
      icon('plus') +
      'Agregar</button></form>' +
      '<div id="tn-summary"></div><div id="tn-list" class="tn-list"></div>' +
      more('Opciones', '<div id="tn-opts" class="tn-opts"></div>', 'tn-more') +
      '</section>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('submit', onSubmit);
    // Recordamos qué desplegables de cada tarjeta quedaron abiertos (el evento toggle no burbujea)
    el.addEventListener(
      'toggle',
      (ev) => {
        const k = ev.target && ev.target.dataset && ev.target.dataset.k;
        if (k) state.det[k] = ev.target.open;
      },
      true
    );
    if (!unwatch) {
      unwatch = Store.watch(
        'tiendas',
        (m) => {
          const antes = dominios().length;
          state.docs = m;
          paintList();
          // Si cambió la cantidad de tiendas, se actualizan el botón y la línea de estado
          if (dominios().length !== antes) paintStatus();
        },
        () => Store.list('tiendas').then((m) => ((state.docs = m), render()))
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
      if (ev.type === 'start') state.skip = '';
      if (ev.type === 'skip' && ev.motivo) state.skip = ev.motivo;
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

  function plural(n, uno, varios) {
    return (n || 0) + ' ' + (n === 1 ? uno : varios);
  }

  function num(n, label, tone, prefijo) {
    return '<span class="chip cp-num tone-' + (tone || 'neutral') + '"><strong>' + (prefijo || '') + e(U.int(n || 0)) + '</strong>' + e(label) + '</span>';
  }

  function nota(ic, html) {
    return '<div class="note tn-note">' + icon(ic) + '<span>' + html + '</span></div>';
  }

  function paintStatus() {
    paintCtrl();
    paintProg();
  }

  function paintCtrl() {
    if (!montado()) return;
    const box = $('#tn-ctrl', el);
    const act = $('#tn-act', el);
    const c = A.cfg.tiendas || {};
    const horas = Number(c.cadaHoras) || 24;
    const opts = CADA.includes(horas) ? CADA : CADA.concat([horas]).sort((a, b) => a - b);
    $('#tn-opts', el).innerHTML =
      toggle('tn-auto', !!c.auto, 'Revisarlas solas al abrir el panel') +
      '<label class="tn-cada" for="tn-cada">Cada <select id="tn-cada">' +
      opts.map((h) => '<option value="' + h + '"' + (h === horas ? ' selected' : '') + '>' + h + ' horas</option>').join('') +
      '</select></label>';
    if (!Browser.checked) {
      act.innerHTML = '';
      box.innerHTML = nota('clock', 'Buscando el navegador de Claude…');
      return;
    }
    if (!Browser.available) {
      act.innerHTML = '';
      box.innerHTML = nota(
        'alert',
        'Necesita la app de escritorio de Claude. ' +
          info('La revisión usa el navegador de Claude en tu PC: abrí este panel desde la app de escritorio (Cowork). Igual podés agregar o quitar tiendas y ver lo que ya se revisó.')
      );
      return;
    }
    const corriendo = A.running === 'tiendas';
    const otra = A.running && !corriendo ? A.running : null;
    const n = dominios().length;
    act.innerHTML = corriendo
      ? '<button class="btn ghost" data-act="tn-detener">' + icon('stop') + 'Detener</button>'
      : n
        ? '<button class="btn" data-act="tn-revisar"' + (state.enCola ? ' disabled' : '') + '>' + icon('refresh') + 'Revisar ahora</button>'
        : '';
    box.innerHTML = state.enCola && otra ? nota('clock', 'En cola: espera que termine la ' + e(A.NOMBRES[otra] || otra) + '.') : '';
  }

  function paintProg() {
    if (!montado()) return;
    const est = A.estado.tiendas;
    const c = A.cfg.tiendas || {};
    const corriendo = A.running === 'tiendas';
    const n = dominios().length;
    const meta = corriendo ? 'Revisando…' : est && est.ultima ? 'Revisadas ' + U.timeAgo(est.ultima) : 'Sin revisar todavía';
    $('#tn-meta', el).innerHTML =
      '<span>' + e(meta + ' · ' + plural(n, 'tienda', 'tiendas')) + '</span>' + (c.auto ? chip('Solas cada ' + (Number(c.cadaHoras) || 24) + ' h', 'good') : '');
    let h = '';
    if (corriendo) {
      h +=
        '<ul class="auto-progress tn-log-list" aria-live="polite">' +
        state.log.map((l) => '<li><span class="st ' + (l.st === 'ok' ? 'ok' : 'err') + '">' + (l.st === 'ok' ? 'listo' : 'error') + '</span><span class="tn-log">' + e(l.texto) + '</span></li>').join('') +
        '<li class="is-curso"><span class="st">revisando</span><span class="tn-log">' +
        e(A.progress.tiendas || 'Empezando…') +
        '</span></li></ul>';
    } else if (state.skip) h += nota('info', e(state.skip));
    else if (est && est.error === 'Cancelado.') h += nota('stop', 'La última revisión se detuvo antes de terminar.');
    else if (est && est.error) h += '<p class="error-text">No terminó: ' + e(est.error) + '</p>';
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
      box.innerHTML = emptyState('Sin tiendas todavía', 'Pegá arriba el link de un competidor. El escaneo de anuncios también las suma solo.', '', 'store');
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
      '<div class="chips cp-nums">' +
      num(rev.length, rev.length === 1 ? 'revisada' : 'revisadas', '') +
      num(altos, 'con mucho movimiento', altos ? 'good' : '') +
      num(cambios, cambios === 1 ? 'cambio' : 'cambios', cambios ? 'info' : '') +
      num(resenas, resenas === 1 ? 'reseña nueva' : 'reseñas nuevas', resenas ? 'source' : '', resenas ? '+' : '') +
      '</div>';
  }

  // Desplegable de una tarjeta que recuerda si quedó abierto
  function det(d, kind, open, summary, body) {
    const k = d + ':' + kind;
    const abierto = state.det[k] != null ? state.det[k] : open;
    return '<details class="tn-det" data-k="' + e(k) + '"' + (abierto ? ' open' : '') + '><summary>' + icon('chevronRight') + summary + '</summary><div class="tn-det-body">' + body + '</div></details>';
  }

  function card(x, hoy) {
    const { d, doc, mv } = x;
    const u = doc && doc.ultima;
    const origen = !doc || doc.origen === 'anuncio' ? 'vino de un anuncio' : 'agregada a mano';
    let cuando = u && u.fecha ? 'Revisada ' + U.timeAgo(u.fecha) : 'Sin revisar';
    if (u && u.error && u.intento) cuando += ' · falló ' + U.timeAgo(u.intento);
    const conf = state.confirmar && state.confirmar.d === d && Date.now() < state.confirmar.hasta;
    let h =
      '<article class="tn-card' +
      (mv.nivel ? ' is-' + mv.nivel : '') +
      '"><header class="tn-card-head"><span class="tn-ini" aria-hidden="true">' +
      e(d.charAt(0).toUpperCase()) +
      '</span><div class="tn-name"><a class="tn-dom" href="https://' +
      e(d) +
      '" target="_blank" rel="noopener">' +
      e(d) +
      icon('external') +
      '</a><span class="tn-sub">' +
      e(cuando + ' · ' + origen) +
      '</span></div><div class="tn-head-r">' +
      '<span class="tn-mov">' +
      chip(mv.nivel ? MOV[mv.nivel] : 'Sin revisar', mv.nivel ? TONO[mv.nivel] : 'neutral') +
      (mv.nivel && mv.motivos && mv.motivos.length ? info(e(mv.texto), 'Por qué') : '') +
      '</span><button type="button" class="btn link sm tn-quitar' +
      (conf ? ' is-confirm' : '') +
      '" data-act="tn-quitar" data-d="' +
      e(d) +
      '" aria-label="Dejar de seguir ' +
      e(d) +
      '" title="Quitar">' +
      icon('trash') +
      (conf ? 'Tocá de nuevo para quitar' : '') +
      '</button></div></header>';
    if (u && u.fecha) {
      const lz = S.lanzamientos(u.productos, hoy).length;
      const total = u.total != null ? u.total : u.productos.length;
      const agotados = u.agotados != null ? u.agotados : u.productos.filter((p) => !p.disponible).length;
      h +=
        '<p class="tn-facts"><span><strong>' +
        e(U.int(total)) +
        '</strong> productos</span><span><strong>' +
        e(U.int(agotados)) +
        '</strong> agotados</span><span><strong>' +
        e(U.int(lz)) +
        '</strong> nuevos en ' +
        S.DIAS_LANZAMIENTO +
        ' días</span>' +
        (u.parcial ? '<span>catálogo leído en parte</span>' : '') +
        '</p>' +
        '<div class="tn-body">' +
        corrector(d, doc, hoy) +
        cambios(d, doc) +
        '</div>' +
        otrosYHistorial(d, doc);
    }
    if (u && u.error) h += '<p class="error-text">' + e(u.error) + '</p>';
    return h + '</article>';
  }

  function corrector(d, doc, hoy) {
    const u = doc.ultima;
    const res = u.resenas || {};
    const c = S.principal(u.productos, res);
    if (!c) return '<p class="tn-quiet">' + icon('search') + 'No vende correctores de postura.</p>';
    const delta = ((doc.cambios && doc.cambios.resenas) || []).find((r) => r.handle === c.handle);
    const dias = R.daysSince(c.publicado || c.creado, hoy);
    const mio = App.tienda.precio1;
    const cmp = S.compararPrecio(c.precioMin, mio);
    const chips = [chip(c.disponible ? 'Con stock' : 'Agotado', c.disponible ? 'good' : 'bad')];
    if (c.variantes > 1) chips.push(chip(c.disponibles + ' de ' + c.variantes + ' variantes', c.disponibles < c.variantes ? 'warn' : 'neutral'));
    if (dias != null) chips.push(chip('Publicado hace ' + dias + (dias === 1 ? ' día' : ' días'), 'neutral'));
    chips.push(
      res[c.handle] != null
        ? '<span class="chip tone-source">' + e(U.int(res[c.handle]) + ' reseñas') + (delta && delta.suma ? '<strong class="tn-delta">+' + e(U.int(delta.suma)) + '</strong>' : '') + '</span>'
        : chip('Sin reseñas visibles', 'neutral')
    );
    const est = delta ? S.ventasEstimadas(delta.suma) : null;
    let vs = '';
    if (cmp) {
      const etiqueta = cmp.tono === 'neutral' ? 'Mismo precio' : U.pct(Math.abs(cmp.pct)) + (cmp.dif < 0 ? ' más barato' : ' más caro');
      vs = '<span class="tn-mio">Tu precio ' + e(plata(mio)) + '</span>' + chip(etiqueta, cmp.tono, ' title="' + e(cmp.texto) + '"');
    }
    return (
      '<div class="tn-corr"><div class="tn-corr-top"><div class="tn-corr-name"><span class="eyebrow">Su corrector</span><a href="' +
      e(R.productUrl(d, c.handle)) +
      '" target="_blank" rel="noopener">' +
      e(c.titulo || c.handle) +
      '</a></div><div class="tn-price"><strong>' +
      e(plata(c.precioMin)) +
      '</strong>' +
      (c.tachado && c.tachado > c.precioMin ? '<s>' + e(plata(c.tachado)) + '</s>' : '') +
      '</div></div>' +
      (vs ? '<div class="tn-vs">' + vs + '</div>' : '') +
      '<div class="chips">' +
      chips.join('') +
      '</div>' +
      (est
        ? nota(
            'trending',
            'Unas ' +
              e(U.int(est.min)) +
              ' a ' +
              e(U.int(est.max)) +
              ' ventas desde el <span class="nowrap">' +
              e(U.fmtDay(U.dayKeyAR(doc.cambios.desde))) +
              ' ' +
              info(
                'Si esas ' +
                  e(U.int(delta.suma)) +
                  ' reseñas nuevas son reales. Se suele dejar 1 reseña cada ' +
                  S.COMPRAS_POR_RESENA[0] +
                  ' a ' +
                  S.COMPRAS_POR_RESENA[1] +
                  ' compras: es una estimación gruesa.'
              ) +
              '</span>'
          )
        : '') +
      '</div>'
    );
  }

  const GRUPOS = [
    ['nuevos', 'Nuevo', 'info', (x) => x.titulo + ' · ' + plata(x.precio)],
    ['precios', 'Precio', 'warn', (x) => x.titulo + ': ' + plata(x.antes) + ' → ' + plata(x.ahora)],
    ['agotados', 'Se agotó', 'bad', (x) => x.titulo + ' · ' + plata(x.precio)],
    ['repuestos', 'Repuesto', 'good', (x) => x.titulo + ' · ' + plata(x.precio)],
    ['variantes', 'Variantes', 'neutral', (x) => x.titulo + ': ' + x.ahora + ' de ' + x.de + ' con stock (antes ' + x.antes + ')'],
    ['resenas', 'Reseñas', 'source', (x) => x.titulo + ': +' + U.int(x.suma) + ' (' + U.int(x.ahora) + ' en total)'],
    ['quitados', 'Quitado', 'neutral', (x) => x.titulo + ' · ' + plata(x.precio)],
  ];

  function cambios(d, doc) {
    const k = doc.cambios;
    if (!k) return '<p class="tn-quiet">' + icon('clock') + 'Primera revisión: los cambios se ven en la próxima.</p>';
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
    if (!total) return '<p class="tn-quiet">' + icon('check') + 'Sin cambios desde el ' + e(desde) + '.</p>';
    return det(d, 'cambios', total <= 6, '<span>' + plural(total, 'cambio', 'cambios') + '</span><span class="muted small">desde el ' + e(desde) + '</span>', '<ul class="tn-changes">' + lis + '</ul>');
  }

  function otrosYHistorial(d, doc) {
    const u = doc.ultima;
    const res = u.resenas || {};
    const c = S.principal(u.productos, res);
    const otros = S.posturaOrdenada(u.productos)
      .filter((p) => !c || p.id !== c.id)
      .slice(0, 4);
    const h = (doc.historial || []).filter((x) => x && x.fecha);
    let out = '';
    if (otros.length)
      out += det(
        d,
        'otros',
        false,
        '<span>Otros de postura</span><span class="muted small">' + otros.length + '</span>',
        '<ul class="tn-otros">' +
          otros
            .map(
              (p) =>
                '<li><a href="' +
                e(R.productUrl(d, p.handle)) +
                '" target="_blank" rel="noopener">' +
                e(p.titulo || p.handle) +
                '</a><span class="muted">' +
                e(plata(p.precioMin) + (p.disponible ? '' : ' · agotado') + (res[p.handle] != null ? ' · ' + U.int(res[p.handle]) + ' reseñas' : '')) +
                '</span></li>'
            )
            .join('') +
          '</ul>'
      );
    if (h.length >= 2) {
      const n = (v) => (v == null ? '—' : e(U.int(v)));
      out += det(
        d,
        'hist',
        false,
        '<span>Historial</span><span class="muted small">' + h.length + ' revisiones</span>',
        '<div class="table-wrap"><table class="table tn-hist"><thead><tr><th>Fecha</th><th class="num">Productos</th><th class="num">Agotados</th><th class="num">Corrector</th><th class="num">Reseñas</th></tr></thead><tbody>' +
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
                (x.precioCorrector == null ? '—' : e(plata(x.precioCorrector))) +
                '</td><td class="num">' +
                n(x.resenasTotal) +
                (x.resenasNuevas ? ' <span class="tn-delta">+' + e(U.int(x.resenasNuevas)) + '</span>' : '') +
                '</td></tr>'
            )
            .join('') +
          '</tbody></table></div>'
      );
    }
    return out ? '<div class="tn-dets">' + out + '</div>' : '';
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
    toast(Browser.available ? 'Agregaste ' + d + '. Tocá “Revisar ahora” para leer su catálogo.' : 'Agregaste ' + d + '. Se revisa desde la app de escritorio de Claude.', 'good');
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
        state.skip = '';
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
        t.innerHTML = icon('trash') + 'Tocá de nuevo para quitar';
        setTimeout(() => {
          if (state.confirmar && state.confirmar.d === d && Date.now() >= state.confirmar.hasta) {
            state.confirmar = null;
            if (t.isConnected) {
              t.classList.remove('is-confirm');
              t.innerHTML = icon('trash');
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
