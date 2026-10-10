/* Competencia: qué anuncian los competidores en la Biblioteca de anuncios de Meta y qué les funciona */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const CP = VC.competitors;
  const R = VC.research;
  const S = VC.scan;
  const { Store, AI, Browser } = VC.runtime;
  const { e, $, $$, App, chip, emptyState, toast, copyText, storeFail, icon, bubble, pageHead, info, more, toggle, banner } = VC.ui;
  const A = VC.auto;

  const LOGIN = 'Meta pide iniciar sesión en el navegador de Claude: entrá una vez a facebook.com en ese navegador';
  const HORAS = [12, 24, 48, 72];
  const CANCELADO = 'Cancelado.'; // texto que deja VC.auto cuando se detiene una tarea
  const FILAS = 12; // anuncios guardados visibles antes de "Ver todos"

  const state = {
    ads: new Map(),
    texto: '',
    imagenes: [],
    imgLimits: null,
    running: false,
    error: '',
    ideas: { text: '', fecha: null, running: false, error: '' },
    verTodos: false,
    abierto: { found: false, ideas: false }, // textos largos desplegados
  };
  let el;
  let ctl;
  // Escaneo automático: progreso en vivo, último escaneo guardado y si el usuario lo dejó en cola
  const vivo = { items: [] };
  let ultimo = null;
  let ultimoCargado = false;
  let pedido = false;
  let enCurso = false;
  let dataTimer = 0;
  let ultimoTipeo = 0;

  function mount(section) {
    el = section;
    el.innerHTML =
      pageHead('Competencia', 'Qué anuncian y qué les funciona.') +
      '<section class="panel auto-panel cp-auto" id="cp-auto" aria-labelledby="cp-auto-title"></section>' +
      '<section class="panel cp-found" id="cp-found" aria-labelledby="cp-found-title"></section>' +
      '<div id="cp-tiendas"></div>' +
      '<section class="panel cp-saved" id="cp-table" aria-labelledby="cp-table-title"><div id="cp-saved-head"></div><div id="cp-ideas" hidden></div><div id="cp-saved-body"></div></section>' +
      '<div class="cp-manual">' +
      more('Buscar a mano', '<div class="cp-manual-body"><section class="cp-step" id="cp-links"></section><section class="cp-step" id="cp-input"></section><section class="cp-step" id="cp-hand"></section></div>', 'cp-manual') +
      '</div>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', (ev) => {
      ultimoTipeo = Date.now();
      if (ev.target.id === 'cp-texto') state.texto = ev.target.value;
    });
    el.addEventListener('submit', onSubmit);
    el.addEventListener('paste', onPaste);
    Store.watch('competencia', (m) => {
      state.ads = m;
      renderDataSoon();
    });
    if (A) A.on(onAuto);
    if (!ultimoCargado) {
      Store.get('escaneos/ultimo').then((d) => {
        if (!ultimoCargado) ultimo = d || null;
        ultimoCargado = true;
        renderFound();
        renderDataSoon();
      });
    }
    Store.get('ideas/competencia').then((d) => {
      if (d && d.text && !state.ideas.text) {
        state.ideas.text = d.text;
        state.ideas.fecha = d.fecha;
        renderIdeas();
      }
    });
    if (AI.sample && AI.sample.limits) AI.sample.limits().then((l) => ((state.imgLimits = l && l.images ? l.images : null), renderInput())).catch(() => {});
    renderAuto();
    renderFound();
    if (VC.tools.tiendas) VC.tools.tiendas.mount($('#cp-tiendas', el));
    renderLinks();
    renderInput();
    renderHand();
    renderData();
  }

  function render() {
    renderAuto();
    renderFound();
    if (VC.tools.tiendas && VC.tools.tiendas.render) VC.tools.tiendas.render();
    renderInput();
    renderData();
  }

  /* ---------- Piezas chicas ---------- */

  function plural(n, uno, varios) {
    return (n || 0) + ' ' + (n === 1 ? uno : varios);
  }

  // Chip con número destacado: "12 nuevos"
  function num(n, label, tone) {
    return '<span class="chip cp-num tone-' + (tone || 'neutral') + '"><strong>' + e(U.int(n || 0)) + '</strong>' + e(label) + '</span>';
  }

  function nota(ic, html) {
    return '<div class="note cp-note">' + icon(ic) + '<span>' + html + '</span></div>';
  }

  const SEC_ICON = [
    [/novedad/i, 'sparkles'],
    [/funciona/i, 'trending'],
    [/precio/i, 'tag'],
    [/probar|idea|creativo/i, 'video'],
    [/hueco/i, 'search'],
  ];

  /* Parte el texto plano de Claude en secciones (título en una línea y viñetas con guion) */
  function secciones(text) {
    const out = [];
    let cur = null;
    let lista = false;
    const nueva = (t) => {
      cur = { t, h: '' };
      out.push(cur);
      lista = false;
    };
    const cerrar = () => {
      if (cur && lista) cur.h += '</ul>';
      lista = false;
    };
    for (const raw of String(text || '').split(/\r?\n/)) {
      // Sin markdown y sin cortar "$ 49.990" entre líneas
      const l = raw.replace(/\*\*/g, '').replace(/^#+\s*/, '').replace(/\$ (?=\d)/g, '$\u00a0').trim();
      if (!l) {
        cerrar();
        continue;
      }
      const vin = l.match(/^[-•*–]\s+(.*)$/);
      if (vin) {
        if (!cur) nueva('');
        if (!lista) {
          cur.h += '<ul>';
          lista = true;
        }
        cur.h += '<li>' + e(vin[1]) + '</li>';
        continue;
      }
      cerrar();
      if (l.length <= 60 && (/:$/.test(l) || !/[.!?…)"”]$/.test(l))) {
        nueva(l.replace(/:$/, '').replace(/^\d+[.)]\s+/, ''));
        continue;
      }
      if (!cur) nueva('');
      cur.h += '<p>' + e(l) + '</p>';
    }
    cerrar();
    return out.filter((s) => s.t || s.h);
  }

  function seccion(s) {
    const ic = s.t ? (SEC_ICON.find(([re]) => re.test(s.t)) || [])[1] : '';
    return '<section class="cp-sec">' + (s.t ? '<h4>' + (ic ? icon(ic) : '') + '<span>' + e(s.t) + '</span></h4>' : '') + s.h + '</section>';
  }

  // "Ver más: Precios y Qué probar" (o "Ver todo" si las partes no tienen título)
  function resto(secs) {
    const t = secs.map((x) => x.t).filter(Boolean);
    if (!t.length || t.length !== secs.length || t.join('').length > 60) return 'Ver todo';
    return 'Ver más: ' + (t.length > 1 ? t.slice(0, -1).join(', ') + ' y ' + t[t.length - 1] : t[0]);
  }

  /* Texto de Claude con buena tipografía; si es largo, muestra las dos primeras partes y "Ver todo" */
  function prosa(text, key) {
    const secs = secciones(text);
    const largo = secs.length > 2 && String(text).length > 700;
    const abierto = !largo || state.abierto[key];
    const vis = abierto ? secs : secs.slice(0, 2);
    return (
      '<div class="cp-prose' +
      (secs.length > 1 ? ' is-grid' : '') +
      '">' +
      vis.map(seccion).join('') +
      '</div>' +
      (largo
        ? '<button type="button" class="btn link sm cp-fold" data-act="plegar" data-k="' +
          key +
          '" aria-expanded="' +
          !!abierto +
          '">' +
          e(abierto ? 'Ver menos' : resto(secs.slice(2))) +
          icon('chevronDown') +
          '</button>'
        : '')
    );
  }

  /* ---------- Escaneo automático: interfaz ---------- */

  function renderAuto() {
    const box = el && $('#cp-auto', el);
    if (!box) return;
    if (!box.dataset.ready) {
      box.innerHTML = '<div id="cp-auto-head"></div><div id="cp-auto-prog"></div>' + (A ? more('Opciones', '<div id="cp-auto-cfg"></div>', 'cp-auto-more') : '');
      box.dataset.ready = '1';
    }
    renderAutoHead();
    renderAutoProg();
    renderAutoCfg();
  }

  function renderAutoHead() {
    const box = el && $('#cp-auto-head', el);
    if (!box || !A) return;
    const c = A.cfg.competencia || A.DEFAULTS.competencia;
    const corriendo = A.running === 'competencia';
    const otra = A.running && !corriendo ? A.NOMBRES[A.running] || A.running : '';
    const chk = A.can('competencia');
    const est = A.estado.competencia || {};
    const ult = A.ultima('competencia');
    let meta;
    if (corriendo) meta = vivo.items.some((it) => it.estado === 'leyendo' || it.estado === 'espera') ? 'Escaneando la Biblioteca…' : A.progress.competencia || 'Escaneando…';
    else if (ult) meta = 'Escaneado ' + U.timeAgo(ult) + (est.resultado && est.resultado.nuevos != null ? ' · ' + plural(est.resultado.nuevos, 'nuevo', 'nuevos') : '');
    else meta = 'Todavía no escaneaste';
    let accion = '';
    if (Browser.available) {
      accion = corriendo
        ? '<button class="btn ghost" data-act="auto-detener">' + icon('stop') + 'Detener</button>'
        : '<button class="btn" data-act="auto-escanear"' + (!chk.ok || pedido ? ' disabled' : '') + '>' + icon('search') + (pedido ? 'En cola…' : 'Escanear ahora') + '</button>';
    }
    let aviso = '';
    if (!Browser.checked) aviso = nota('clock', 'Buscando el navegador de Claude…');
    else if (!Browser.available)
      aviso = nota(
        'alert',
        'Necesita la app de escritorio de Claude. ' +
          info('El escaneo abre la Biblioteca de anuncios en el navegador de Claude de tu PC. Funciona si abrís este panel desde la app de escritorio (Cowork). Mientras tanto podés buscar a mano.') +
          ' <button type="button" class="btn link sm" data-act="abrir-manual">Buscar a mano</button>'
      );
    else if (!chk.ok) aviso = nota('alert', e(chk.motivo));
    else if (otra) aviso = nota('clock', pedido ? 'En cola: arranca cuando termine la ' + e(otra) + '.' : 'Ahora corre la ' + e(otra) + '. Si escaneás, queda en cola.');
    else if (!corriendo && est.error === CANCELADO) aviso = nota('stop', 'Detuviste el último escaneo.');
    else if (!corriendo && est.error) aviso = '<p class="error-text">No terminó: ' + e(est.error) + '</p>';
    box.innerHTML =
      '<div class="cp-auto-row">' +
      bubble('zap', 'peach') +
      '<div class="cp-auto-txt"><h3 id="cp-auto-title">Escaneo automático</h3><p class="cp-auto-meta"><span>' +
      e(meta) +
      '</span>' +
      (c.auto ? chip('Solo cada ' + c.cadaHoras + ' h', 'good') : '') +
      '</p></div>' +
      (accion ? '<div class="row-actions">' + accion + '</div>' : '') +
      '</div>' +
      aviso;
  }

  const ST = {
    espera: ['en espera', ''],
    leyendo: ['leyendo', ''],
    ok: ['listo', 'ok'],
    sin: ['sin anuncios', 'ok'],
    error: ['error', 'err'],
    omitida: ['no se revisó', ''],
  };

  function renderAutoProg() {
    const box = el && $('#cp-auto-prog', el);
    if (!box || !A) return;
    const corriendo = A.running === 'competencia';
    const est = A.estado.competencia || {};
    if (!vivo.items.length || (!corriendo && (!est.error || est.error === CANCELADO))) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<ul class="auto-progress cp-prog" aria-live="polite">' +
      vivo.items
        .map((it) => {
          const st = ST[it.estado] || ST.espera;
          const det = it.error ? it.error : it.estado === 'ok' ? plural(it.anuncios, 'anuncio', 'anuncios') + ' · ' + plural(it.nuevos, 'nuevo', 'nuevos') : '';
          return '<li class="is-' + e(it.estado) + '"><span class="st' + (st[1] ? ' ' + st[1] : '') + '">' + e(st[0]) + '</span><span>' + e(it.q) + (det ? ' <span class="muted">· ' + e(det) + '</span>' : '') + '</span></li>';
        })
        .join('') +
      '</ul>';
  }

  function busquedasCfg() {
    const c = (A && A.cfg.competencia) || {};
    return S.limpiarBusquedas(c.busquedas && c.busquedas.length ? c.busquedas : CP.BUSQUEDAS);
  }

  function renderAutoCfg() {
    const box = el && $('#cp-auto-cfg', el);
    if (!box || !A) return;
    const c = A.cfg.competencia || A.DEFAULTS.competencia;
    const qs = busquedasCfg();
    const dis = A.loaded ? '' : ' disabled';
    const horas = HORAS.includes(Number(c.cadaHoras)) ? HORAS : HORAS.concat(Number(c.cadaHoras) || 24).sort((a, b) => a - b);
    const lleno = qs.length >= S.MAX_BUSQUEDAS;
    const igualDefault = qs.join('|') === CP.BUSQUEDAS.join('|');
    // Si el usuario está escribiendo una búsqueda o usando una opción, conservamos el foco al redibujar
    const act = document.activeElement;
    const keep = act && act.id === 'cp-q-nueva' && box.contains(act) ? act.value : null;
    const keepCfg = act && box.contains(act) && act.dataset ? act.dataset.cfg : '';
    box.innerHTML =
      '<div class="cp-auto-cfg"><div class="cp-cfg-row">' +
      toggle('cp-auto-solo', !!c.auto, 'Escanear solo al abrir el panel', 'data-cfg="auto"' + dis) +
      '<label class="cp-cada">Cada <select data-cfg="cadaHoras" aria-label="Cada cuántas horas"' +
      dis +
      '>' +
      horas.map((h) => '<option value="' + h + '"' + (Number(c.cadaHoras) === h ? ' selected' : '') + '>' + h + ' horas</option>').join('') +
      '</select></label></div>' +
      toggle('cp-guiones-tras', !!c.guionesTras, 'Después, escribir guiones nuevos', 'data-cfg="guionesTras"' + dis) +
      '<div class="cp-qs"><div class="cp-qs-head"><span class="eyebrow">Búsquedas · ' +
      qs.length +
      ' de ' +
      S.MAX_BUSQUEDAS +
      '</span>' +
      (igualDefault ? '' : '<button type="button" class="btn link sm" data-act="q-default"' + dis + '>Volver a las de siempre</button>') +
      '</div><div class="chips">' +
      qs
        .map(
          (q) =>
            '<span class="chip cp-q">' +
            e(q) +
            '<button type="button" class="cp-q-x" data-act="q-quitar" data-q="' +
            e(q) +
            '" aria-label="Quitar la búsqueda ' +
            e(q) +
            '"' +
            (qs.length <= 1 || !A.loaded ? ' disabled' : '') +
            '>' +
            icon('x') +
            '</button></span>'
        )
        .join('') +
      '</div><form id="cp-q-form" class="cp-q-form"><label for="cp-q-nueva" class="sr-only">Agregar una búsqueda</label><input id="cp-q-nueva" maxlength="60" autocomplete="off" placeholder="' +
      (lleno ? 'Quitá una para agregar otra' : 'Ej. faja lumbar') +
      '"' +
      (lleno ? ' disabled' : '') +
      dis +
      '><button class="btn ghost" type="submit"' +
      (lleno ? ' disabled' : '') +
      dis +
      '>' +
      icon('plus') +
      'Agregar</button></form></div></div>';
    if (keep != null) {
      const inp = $('#cp-q-nueva', box);
      if (inp && !inp.disabled) {
        inp.value = keep;
        inp.focus();
      }
    } else if (keepCfg) {
      const opt = $('[data-cfg="' + keepCfg + '"]', box);
      if (opt) opt.focus();
    }
  }

  /* ---------- Qué encontré ---------- */

  function renderFound() {
    const box = el && $('#cp-found', el);
    if (!box) return;
    const abiertos = $$('details[id][open]', box).map((d) => d.id);
    const head = (sub, acciones) =>
      '<div class="panel-head"><div class="panel-title">' +
      bubble('sparkles') +
      '<div><div class="cp-title"><h3 id="cp-found-title">Qué encontré</h3>' +
      info('Meta no publica cuánto vende cada anuncio. Que siga activo ' + CP.GANADOR_DIAS + ' días o más es señal de que le rinde, no un dato de ventas.') +
      '</div>' +
      (sub ? '<p class="small muted">' + e(sub) + '</p>' : '') +
      '</div></div>' +
      (acciones || '') +
      '</div>';
    if (!ultimoCargado) {
      box.innerHTML = head('Cargando el último escaneo…') + '<div class="skeleton cp-sk"></div>';
      return;
    }
    const u = ultimo;
    if (!u) {
      box.innerHTML = head() + emptyState('Sin escaneos todavía', 'Escaneá y acá vas a ver qué anuncian y qué les funciona.', '', 'eye');
      return;
    }
    const pb = Array.isArray(u.porBusqueda) ? u.porBusqueda : [];
    const errores = pb.filter((b) => b.error).length;
    const det =
      (u.nombresNuevos && u.nombresNuevos.length ? '<p class="cp-det-line"><span class="eyebrow">Anunciantes nuevos</span>' + e(u.nombresNuevos.join(', ')) + '</p>' : '') +
      (u.dominiosNuevos && u.dominiosNuevos.length ? '<p class="cp-det-line"><span class="eyebrow">Tiendas sumadas</span>' + e(u.dominiosNuevos.join(', ')) + '</p>' : '') +
      (pb.length
        ? '<ul class="auto-progress cp-prog">' +
          pb
            .map(
              (b) =>
                '<li><span class="st ' +
                (b.error ? 'err' : 'ok') +
                '">' +
                (b.error ? 'error' : b.anuncios ? 'listo' : 'sin anuncios') +
                '</span><span>' +
                e(b.q) +
                ' <span class="muted">· ' +
                e(b.error || (b.anuncios ? plural(b.anuncios, 'anuncio', 'anuncios') + ' · ' + plural(b.nuevos, 'nuevo', 'nuevos') : 'ningún anuncio activo')) +
                '</span></span></li>'
            )
            .join('') +
          '</ul>'
        : '');
    box.innerHTML =
      head(
        'Escaneado ' + U.timeAgo(u.fecha) + (pb.length ? ' · ' + plural(pb.length, 'búsqueda', 'búsquedas') : ''),
        u.resumen ? '<button type="button" class="btn ghost sm cp-copy" data-act="found-copiar" aria-label="Copiar el resumen">' + icon('copy') + '<span>Copiar</span></button>' : ''
      ) +
      '<div class="chips cp-nums">' +
      num(u.nuevos, u.nuevos === 1 ? 'nuevo' : 'nuevos', u.nuevos ? 'peach' : '') +
      num(u.ganadores, (u.ganadores === 1 ? 'activo ' : 'activos ') + CP.GANADOR_DIAS + '+ días', u.ganadores ? 'good' : '') +
      num(u.anunciantesNuevos, u.anunciantesNuevos === 1 ? 'anunciante nuevo' : 'anunciantes nuevos', u.anunciantesNuevos ? 'source' : '') +
      num(u.total, u.total === 1 ? 'visto' : 'vistos', '') +
      '</div>' +
      (u.aviso ? banner('warn', e(u.aviso)) : '') +
      (u.resumen
        ? '<div class="cp-found-body">' + prosa(u.resumen, 'found') + '</div>'
        : '<p class="muted small">' +
          (!u.total ? 'No apareció ningún anuncio activo con estas búsquedas.' : u.errorResumen ? 'No se pudo escribir el resumen: ' + e(u.errorResumen) : A && A.running === 'competencia' ? 'Escribiendo el resumen…' : 'Sin resumen en este escaneo.') +
          '</p>') +
      (det ? more('Detalle' + (errores ? ' · ' + plural(errores, 'búsqueda con error', 'búsquedas con error') : ''), '<div class="cp-det">' + det + '</div>', 'cp-found-det') : '');
    for (const id of abiertos) {
      const d = $('#' + id, box);
      if (d) d.open = true;
    }
  }

  function onAuto(ev) {
    if (!el) return;
    if (ev.type === 'cfg') {
      if (!ev.job || ev.job === 'competencia') {
        renderAutoHead();
        renderAutoCfg();
      }
      return;
    }
    if (ev.job !== 'competencia') {
      if (ev.type === 'start' || ev.type === 'done' || ev.type === 'error') renderAutoHead();
      return;
    }
    if (ev.type === 'start') vivo.items = [];
    if (ev.type === 'skip' && pedido) toast(ev.motivo || 'No se pudo escanear acá.', 'warn');
    renderAutoHead();
    renderAutoProg();
    if (ev.type === 'done' || ev.type === 'error') {
      renderFound();
      renderDataSoon();
    }
  }

  function escanearAhora() {
    if (!A || pedido || A.running === 'competencia') return;
    pedido = true;
    renderAutoHead();
    A.run('competencia', { origen: 'manual' }).finally(() => {
      pedido = false;
      renderAutoHead();
    });
  }

  function agregarBusqueda(form) {
    const inp = $('#cp-q-nueva', form);
    const r = S.agregarBusqueda(busquedasCfg(), inp ? inp.value : '');
    if (r.error) {
      toast(r.error, 'warn');
      return;
    }
    if (inp) inp.value = '';
    A.setCfg('competencia', { busquedas: r.lista });
    const nuevo = $('#cp-q-nueva', el);
    if (nuevo && !nuevo.disabled) nuevo.focus();
  }

  // Redibuja la tabla sin molestar si el usuario está escribiendo en un campo de esta pestaña
  function renderDataSoon() {
    if (!el) return;
    clearTimeout(dataTimer);
    dataTimer = setTimeout(() => {
      const a = document.activeElement;
      const tipeando = a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && Date.now() - ultimoTipeo < 2500;
      if (tipeando) renderDataSoon();
      else renderData();
    }, 300);
  }

  /* ---------- Buscar a mano ---------- */

  function paso(n, titulo, extra) {
    return '<div class="cp-step-head"><span class="cp-step-n" aria-hidden="true">' + n + '</span><h4>' + e(titulo) + '</h4>' + (extra || '') + '</div>';
  }

  function renderLinks() {
    $('#cp-links', el).innerHTML =
      paso(1, 'Abrí la Biblioteca', info('Se abre filtrada por Argentina y anuncios activos. Mirá “Comenzó a circular el…”: los que llevan ' + CP.GANADOR_DIAS + ' días o más son los que les rinden.')) +
      '<div class="cp-links">' +
      CP.BUSQUEDAS.map((q) => '<a class="btn ghost sm" href="' + e(CP.adLibraryUrl(q)) + '" target="_blank" rel="noopener">' + e(q) + icon('external') + '</a>').join('') +
      '<a class="btn ghost sm" href="' +
      e(CP.tiktokTopAdsUrl()) +
      '" target="_blank" rel="noopener">TikTok Creative Center' +
      icon('external') +
      '</a></div>';
  }

  function renderInput() {
    const box = el && $('#cp-input', el);
    if (!box) return;
    const canImg = !!state.imgLimits;
    if (!AI.sample) {
      box.innerHTML = paso(2, 'Pegá lo que ves') + nota('info', 'Para leer el texto hace falta Claude: abrí el panel desde claude.ai. Mientras tanto, cargalos a mano.');
      return;
    }
    box.innerHTML =
      paso(
        2,
        'Pegá lo que ves',
        info('En la página de resultados seleccioná todo (Ctrl+A o Cmd+A), copiá y pegalo acá.' + (canImg ? ' También podés pegar o subir capturas (hasta ' + state.imgLimits.maxCount + ').' : '') + ' Claude saca los anuncios y los guarda.')
      ) +
      '<label for="cp-texto" class="sr-only">Texto copiado de la Biblioteca de anuncios</label><textarea id="cp-texto" rows="5" placeholder="Pegá acá el texto de la Biblioteca…">' +
      e(state.texto) +
      '</textarea>' +
      '<div class="row-actions">' +
      (state.running
        ? '<button class="btn ghost" data-act="detener">' + icon('stop') + 'Detener</button><span class="muted small">Leyendo los anuncios…</span>'
        : '<button class="btn" data-act="extraer">' + icon('sparkles') + 'Extraer anuncios</button>') +
      (canImg && !state.running
        ? '<label class="btn ghost file-btn">' +
          icon('upload') +
          'Subir capturas<input type="file" id="cp-imgs" accept="' +
          e(state.imgLimits.mediaTypes.join(',')) +
          '" multiple hidden></label>' +
          (state.imagenes.length
            ? chip(plural(state.imagenes.length, 'captura', 'capturas'), 'info') + '<button type="button" class="btn link sm" data-act="quitar-imgs">Quitar</button>'
            : '')
        : '') +
      '</div>' +
      (state.error ? '<p class="error-text">' + e(state.error) + '</p>' : '');
  }

  function renderHand() {
    const box = el && $('#cp-hand', el);
    if (!box) return;
    box.innerHTML =
      paso(3, 'O cargá uno a mano') +
      '<form id="cp-form" class="cp-form"><div class="form-grid">' +
      inp('anunciante', 'Anunciante') +
      inp('desde', 'Activo desde', 'date') +
      '<label for="cp-f-angulo">Ángulo<select id="cp-f-angulo" name="angulo">' +
      Object.entries(CP.ANGULOS)
        .map(([k, v]) => '<option value="' + k + '">' + e(v) + '</option>')
        .join('') +
      '</select></label>' +
      inp('oferta', 'Oferta') +
      inp('precio', 'Precio') +
      '<label for="cp-f-formato">Formato<select id="cp-f-formato" name="formato"><option>video</option><option>imagen</option><option>carrusel</option></select></label></div>' +
      '<div class="form-grid wide"><label for="cp-f-gancho">Gancho (primera frase)<input id="cp-f-gancho" name="gancho" required></label>' +
      inp('nota', 'Nota') +
      '</div><div class="row-actions"><button class="btn ghost" type="submit">' +
      icon('plus') +
      'Guardar anuncio</button></div></form>';
  }

  function inp(k, label, type) {
    return '<label for="cp-f-' + k + '">' + e(label) + '<input id="cp-f-' + k + '" name="' + k + '"' + (type ? ' type="' + type + '"' : '') + '></label>';
  }

  /* ---------- Anuncios guardados ---------- */

  function adsList() {
    return [...state.ads.entries()].map(([id, a]) => Object.assign({ id }, a));
  }

  function renderData() {
    if (!el) return;
    const s = CP.summarize(adsList());
    const head = $('#cp-saved-head', el);
    const body = $('#cp-saved-body', el);
    const ideasBox = $('#cp-ideas', el);
    if (!head || !body || !ideasBox) return;
    const sub = s.total
      ? plural(s.total, 'anuncio', 'anuncios') + ' · ' + plural(s.anunciantes, 'anunciante', 'anunciantes') + (s.ganadores ? ' · ' + s.ganadores + ' activos ' + CP.GANADOR_DIAS + '+ días' : '')
      : '';
    const titulo =
      '<div class="panel-title">' + bubble('grid', 'source') + '<div><h3 id="cp-table-title">Anuncios guardados</h3>' + (sub ? '<p class="small muted">' + e(sub) + '</p>' : '') + '</div></div>';
    if (!s.total) {
      head.innerHTML = '<div class="panel-head">' + titulo + '</div>';
      ideasBox.hidden = true;
      ideasBox.innerHTML = '';
      body.innerHTML = emptyState('Sin anuncios guardados', 'Escaneá o buscá a mano: quedan acá para comparar.', '', 'grid');
      return;
    }
    ideasBox.hidden = false;
    const angulos = s.angulos.slice(0, 4).map(([k, n]) => num(n, CP.ANGULOS[k] || k, 'source')).join('');
    const ofertas = s.ofertas.slice(0, 4).map(([k, n]) => num(n, k, '')).join('');
    head.innerHTML =
      '<div class="panel-head">' +
      titulo +
      '<div class="row-actions" id="cp-ideas-act"></div></div>' +
      (angulos || ofertas
        ? '<div class="cp-mix">' +
          (angulos ? '<div class="cp-mix-row"><span class="eyebrow">Ángulos</span><div class="chips">' + angulos + '</div></div>' : '') +
          (ofertas ? '<div class="cp-mix-row"><span class="eyebrow">Ofertas</span><div class="chips">' + ofertas + '</div></div>' : '') +
          '</div>'
        : '');
    const filas = state.verTodos ? s.ads : s.ads.slice(0, FILAS);
    body.innerHTML =
      '<div class="table-wrap"><table class="table cp-table"><thead><tr><th>Anunciante</th><th class="num">Días</th><th>Ángulo</th><th>Oferta</th><th class="num">Precio</th><th>Gancho</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>' +
      filas.map(fila).join('') +
      '</tbody></table></div><div class="cp-saved-foot">' +
      (s.ads.length > FILAS
        ? '<button type="button" class="btn link sm" data-act="ver-todos" aria-expanded="' + state.verTodos + '">' + (state.verTodos ? 'Ver menos' : 'Ver los ' + s.ads.length) + '</button>'
        : '<span></span>') +
      '<button type="button" class="btn link sm cp-del-all" data-act="borrar-todo">Borrar todos</button></div>';
    renderIdeas();
  }

  function fila(a) {
    const angulo = CP.ANGULOS[a.angulo] || a.angulo || '';
    // En el celular ángulo, oferta y precio van juntos en una sola línea
    const metaCel = [angulo, a.oferta || '', a.precio ? U.money(a.precio).replace(' ', '\u00a0') : ''].filter(Boolean).join(' · ');
    return (
      '<tr><th scope="row" class="cp-c-who"><span class="cp-who">' +
      e(a.anunciante || 'Sin nombre') +
      (ultimo && S.esNuevo(a, ultimo.fecha) ? chip('nuevo', 'peach') : '') +
      '</span><span class="cp-who-sub">' +
      e([a.formato || '', a.ultimaVez ? 'visto ' + U.timeAgo(a.ultimaVez) : ''].filter(Boolean).join(' · ')) +
      '</span></th><td class="num cp-c-dias">' +
      (a.dias != null ? chip(a.dias + ' días', a.dias >= CP.GANADOR_DIAS ? 'good' : 'neutral') : '<span class="muted">—</span>') +
      '</td><td class="cp-c-meta' +
      (angulo ? '' : ' is-empty') +
      '">' +
      e(angulo || '—') +
      '</td><td class="cp-c-meta' +
      (a.oferta ? '' : ' is-empty') +
      '">' +
      e(a.oferta || '—') +
      '</td><td class="num cp-c-meta' +
      (a.precio ? '' : ' is-empty') +
      '">' +
      (a.precio ? e(U.money(a.precio)) : '—') +
      '</td><td class="cp-c-hook"><span class="cp-hook">“' +
      e(a.gancho) +
      '”</span>' +
      (a.nota ? '<span class="cp-hook-note">' + e(a.nota) + '</span>' : '') +
      '</td><td class="cp-c-mm">' +
      e(metaCel) +
      '</td><td class="cp-c-acts"><div class="cp-acts">' +
      (a.idBiblioteca
        ? '<a class="btn link sm" href="' + e(R.adUrl(a.idBiblioteca)) + '" target="_blank" rel="noopener" aria-label="Ver en la Biblioteca el anuncio de ' + e(a.anunciante || '') + '">Ver' + icon('external') + '</a>'
        : '') +
      '<button type="button" class="btn link sm cp-del" data-act="borrar" data-id="' +
      e(a.id) +
      '" aria-label="Borrar anuncio de ' +
      e(a.anunciante || '') +
      '" title="Borrar">' +
      icon('trash') +
      '</button></div></td></tr>'
    );
  }

  function renderIdeas() {
    const box = el && $('#cp-ideas', el);
    if (!box) return;
    const I = state.ideas;
    const igual = !!(I.text && ultimo && ultimo.resumen && I.text.trim() === String(ultimo.resumen).trim());
    const act = $('#cp-ideas-act', el);
    if (act)
      act.innerHTML = AI.sample
        ? I.running
          ? '<button type="button" class="btn ghost sm" data-act="ideas-stop">' + icon('stop') + 'Detener</button>'
          : '<button type="button" class="btn soft sm" data-act="ideas">' + icon('sparkles') + (I.text && !igual ? 'Nuevas ideas' : 'Ideas con Claude') + '</button>'
        : '';
    if (box.hidden) return;
    // Si las ideas son el mismo texto de "Qué encontré", no se repiten
    if (!(I.text || I.running || I.error) || (igual && !I.running && !I.error)) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<div class="cp-ideas"><div class="cp-ideas-head"><span class="cp-ideas-title">' +
      icon('sparkles') +
      'Ideas para ViaCare</span><span class="muted small">' +
      (I.running ? 'Pensando…' : I.fecha ? e(U.timeAgo(I.fecha)) : '') +
      '</span>' +
      (I.text && !I.running ? '<button type="button" class="btn link sm" data-act="ideas-copiar">' + icon('copy') + 'Copiar</button>' : '') +
      '</div><div class="cp-ideas-out">' +
      (I.text && !igual ? prosa(I.text, 'ideas') : I.running ? '<p class="muted small">Comparando los anuncios guardados…</p>' : '') +
      '</div>' +
      (I.error ? '<p class="error-text">' + e(I.error) + '</p>' : '') +
      '</div>';
  }

  async function extraer() {
    const texto = ($('#cp-texto', el) || {}).value || '';
    if (!texto.trim() && !state.imagenes.length) {
      toast('Pegá el texto de la Biblioteca o subí capturas.', 'warn');
      return;
    }
    ctl = new AbortController();
    state.running = true;
    state.error = '';
    renderInput();
    try {
      const opts = { signal: ctl.signal, cache: false };
      if (state.imagenes.length) opts.images = state.imagenes;
      const data = await AI.sample.json(CP.extractPrompt(texto, state.imagenes.length, U.todayKeyAR()), opts);
      const ads = CP.sanitizeAds(data);
      if (!ads.length) state.error = 'No encontramos anuncios en lo que pegaste. Copiá la página completa o subí capturas.';
      else {
        const existentes = adsList().map((a) => (a.anunciante + '|' + a.gancho).toLowerCase());
        let nuevos = 0;
        for (const a of ads) {
          if (existentes.includes((a.anunciante + '|' + a.gancho).toLowerCase())) continue;
          const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          a.cargado = new Date().toISOString();
          state.ads.set(id, a);
          nuevos++;
          await Store.set('competencia/' + id, a).catch(storeFail);
        }
        toast(nuevos ? plural(nuevos, 'anuncio nuevo guardado', 'anuncios nuevos guardados') + '.' : 'Ya tenías esos anuncios guardados.', 'good');
        state.texto = '';
        state.imagenes = [];
      }
    } catch (err) {
      if (err && err.code !== 'cancelled') state.error = err.code === 'images_unavailable' || err.code === 'image_rejected' ? 'No se pudieron enviar las capturas. Probá con otras o pegá el texto.' : AI.errorText(err);
      if (AI.permanent(err)) AI.sample = null;
    }
    state.running = false;
    renderInput();
    renderData();
  }

  async function ideas() {
    ctl = new AbortController();
    state.ideas = { text: '', fecha: null, running: true, error: '' };
    state.abierto.ideas = false;
    renderIdeas();
    try {
      const s = CP.summarize(adsList());
      const res = await AI.sample(CP.insightPrompt(s.ads, U.todayKeyAR(), App.datos()), {
        signal: ctl.signal,
        cache: false,
        onText: ({ text }) => {
          state.ideas.text = text;
          const out = el.querySelector('#cp-ideas .cp-ideas-out');
          if (out) out.innerHTML = prosa(text, 'ideas');
        },
      });
      state.ideas.text = res.text;
      state.ideas.fecha = new Date().toISOString();
      Store.set('ideas/competencia', { text: res.text, fecha: state.ideas.fecha }).catch(storeFail);
    } catch (err) {
      state.ideas.text = err.text || '';
      if (err.code !== 'cancelled') state.ideas.error = AI.errorText(err);
    }
    state.ideas.running = false;
    renderIdeas();
  }

  function addImages(files) {
    const lim = state.imgLimits;
    if (!lim) return;
    const ok = [...files].filter((f) => lim.mediaTypes.includes(f.type) && f.size <= lim.maxInputBytes);
    state.imagenes = state.imagenes.concat(ok).slice(0, lim.maxCount);
    if (ok.length < files.length) toast('Algunas imágenes no se pudieron usar (tipo o tamaño).', 'warn');
    renderInput();
  }

  function onPaste(ev) {
    if (!state.imgLimits || !ev.clipboardData) return;
    const files = [...ev.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      ev.preventDefault();
      addImages(files);
    }
  }

  function onChange(ev) {
    if (ev.target.id === 'cp-imgs' && ev.target.files) addImages(ev.target.files);
    const k = ev.target.dataset && ev.target.dataset.cfg;
    if (k && A) A.setCfg('competencia', { [k]: ev.target.type === 'checkbox' ? ev.target.checked : Number(ev.target.value) });
  }

  function onSubmit(ev) {
    const q = ev.target.closest('#cp-q-form');
    if (q) {
      ev.preventDefault();
      agregarBusqueda(q);
      return;
    }
    const f = ev.target.closest('#cp-form');
    if (!f) return;
    ev.preventDefault();
    const fd = new FormData(f);
    const a = CP.sanitizeAds([Object.fromEntries(fd.entries())])[0];
    if (!a) {
      toast('Escribí al menos el gancho.', 'warn');
      return;
    }
    a.cargado = new Date().toISOString();
    const id = 'a' + Date.now().toString(36);
    state.ads.set(id, a);
    Store.set('competencia/' + id, a).catch(storeFail);
    f.reset();
    renderData();
    toast('Anuncio guardado.', 'good');
  }

  function copiar(text) {
    copyText(text).then((ok) => ok && toast('Copiado.', 'good'));
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    switch (t.dataset.act) {
      case 'auto-escanear':
        escanearAhora();
        break;
      case 'auto-detener':
        if (A) A.stop();
        break;
      case 'q-quitar': {
        const qs = busquedasCfg();
        if (qs.length > 1) A.setCfg('competencia', { busquedas: qs.filter((x) => x !== t.dataset.q) });
        break;
      }
      case 'q-default':
        A.setCfg('competencia', { busquedas: CP.BUSQUEDAS.slice() });
        break;
      case 'found-copiar':
        if (ultimo && ultimo.resumen) copiar(ultimo.resumen);
        break;
      case 'plegar':
        state.abierto[t.dataset.k] = !state.abierto[t.dataset.k];
        if (t.dataset.k === 'found') renderFound();
        else renderIdeas();
        break;
      case 'abrir-manual': {
        const d = $('#cp-manual', el);
        if (d) {
          d.open = true;
          if (d.scrollIntoView) d.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        }
        break;
      }
      case 'extraer':
        extraer();
        break;
      case 'detener':
      case 'ideas-stop':
        if (ctl) ctl.abort();
        break;
      case 'quitar-imgs':
        state.imagenes = [];
        renderInput();
        break;
      case 'ideas':
        ideas();
        break;
      case 'ideas-copiar':
        copiar(state.ideas.text);
        break;
      case 'ver-todos':
        state.verTodos = !state.verTodos;
        renderData();
        break;
      case 'borrar':
        state.ads.delete(t.dataset.id);
        Store.remove('competencia/' + t.dataset.id).catch(storeFail);
        renderData();
        break;
      case 'borrar-todo':
        if (t.dataset.confirm !== '1') {
          t.dataset.confirm = '1';
          t.classList.add('is-confirm');
          t.textContent = 'Tocá de nuevo para borrar todo';
          setTimeout(() => {
            t.dataset.confirm = '';
            t.classList.remove('is-confirm');
            t.textContent = 'Borrar todos';
          }, 4000);
          return;
        }
        for (const id of [...state.ads.keys()]) Store.remove('competencia/' + id).catch(storeFail);
        state.ads = new Map();
        renderData();
        break;
    }
  }

  /* ---------- Escaneo automático: la tarea ---------- */

  function cortarSiCancelo(ctx) {
    if (ctx.signal.aborted) {
      const err = new Error('Cancelado.');
      err.code = 'cancelled';
      throw err;
    }
  }

  async function guardar(path, data) {
    try {
      await Store.set(path, data);
    } catch (err) {
      const code = err && err.code;
      throw new Error(
        code === 'invalid_argument'
          ? 'No tenés permiso para guardar cambios en este panel.'
          : code === 'quota_exceeded'
            ? 'Se llenó el espacio del panel. Borrá anuncios viejos para seguir guardando.'
            : 'No se pudo guardar lo que encontré. Revisá la conexión y probá de nuevo.'
      );
    }
  }

  function refrescarVivo() {
    if (!el) return;
    renderAutoProg();
  }

  /*
   * Recorre las búsquedas en la Biblioteca de anuncios con el navegador de Claude, extrae los anuncios con Claude,
   * los fusiona con los guardados y escribe "Qué encontré". Funciona aunque la pestaña no esté abierta.
   */
  async function escanear(ctx) {
    if (enCurso) throw new Error('Ya hay un escaneo en curso.');
    enCurso = true;
    try {
      return await escanearUnaVez(ctx);
    } finally {
      enCurso = false;
    }
  }

  async function escanearUnaVez(ctx) {
    const busquedas = busquedasCfg().slice(0, S.MAX_BUSQUEDAS);
    if (!busquedas.length) throw new Error('Agregá al menos una búsqueda para escanear.');
    const hoy = U.todayKeyAR();
    const ahora = new Date().toISOString();
    let docs = await Store.list('competencia');
    // Si la lectura vino vacía pero la pestaña ya tiene anuncios, usamos esos (para no duplicar todo)
    if (!docs.size && state.ads.size) docs = new Map(state.ads);
    const antes = [...docs.values()];
    const tocados = new Set();
    const items = busquedas.map((q) => ({ q, estado: 'espera', anuncios: 0, nuevos: 0, error: '' }));
    vivo.items = items;
    refrescarVivo();
    let nuevos = [];
    let leidas = 0;
    let aviso = '';
    const omitirResto = (i, motivo) => {
      for (const it of items.slice(i + 1)) {
        it.estado = 'omitida';
        it.error = motivo;
      }
    };

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      cortarSiCancelo(ctx);
      it.estado = 'leyendo';
      ctx.progress(S.progreso(i, items.length, it.q));
      refrescarVivo();
      let texto = '';
      try {
        texto = await Browser.read(CP.adLibraryUrl(it.q), { ready: R.adLibraryReady, tries: 6, firstWait: 3000, wait: 3000 });
      } catch (err) {
        it.estado = 'error';
        it.error = Browser.errorText(err);
        if (Browser.fatal(err)) {
          omitirResto(i, S.NO_REVISADA);
          refrescarVivo();
          throw new Error(Browser.errorText(err));
        }
        refrescarVivo();
        continue;
      }
      cortarSiCancelo(ctx);
      const pagina = S.estadoPagina(texto);
      if (pagina === 'login') {
        it.estado = 'error';
        it.error = LOGIN;
        aviso = LOGIN + '.';
        omitirResto(i, 'No se revisó: Meta pide iniciar sesión.');
        refrescarVivo();
        break;
      }
      if (pagina !== 'anuncios') {
        if (pagina === 'vacia') {
          it.estado = 'sin';
          leidas++;
        } else {
          it.estado = 'error';
          it.error =
            pagina === 'cookies'
              ? 'Facebook muestra un aviso de cookies: aceptalo una vez en el navegador de Claude.'
              : 'La página no terminó de cargar. Probá de nuevo más tarde.';
        }
        refrescarVivo();
        continue;
      }
      if (!AI.sample) throw new Error('Claude no está disponible en esta vista.');
      let ads;
      try {
        const data = await AI.sample.json(CP.extractPrompt(R.compactText(texto, 60000), 0, hoy), { signal: ctx.signal, cache: false });
        ads = S.validarIds(CP.sanitizeAds(data), R.adLibraryIds(texto)).map((a) => Object.assign(a, { busqueda: it.q }));
      } catch (err) {
        if (err && err.code === 'cancelled') throw err;
        it.estado = 'error';
        it.error = AI.errorText(err);
        if (AI.permanent(err)) {
          AI.sample = null;
          omitirResto(i, S.NO_REVISADA);
          refrescarVivo();
          throw new Error(AI.errorText(err));
        }
        refrescarVivo();
        continue;
      }
      leidas++;
      const m = S.mergeAds(docs, ads, ahora, { tocados });
      for (const w of m.escrituras) await guardar('competencia/' + w.id, w.data);
      docs = m.docs;
      nuevos = nuevos.concat(m.nuevos);
      it.estado = 'ok';
      it.anuncios = ads.length;
      it.nuevos = m.nuevos.length;
      refrescarVivo();
    }

    // Si no se pudo leer ninguna búsqueda, no pisamos el último escaneo bueno
    if (!leidas) throw new Error(aviso || (items.find((it) => it.error) || {}).error || 'No se pudo leer ninguna búsqueda.');

    const vistos = [...tocados].filter((id) => docs.has(id)).map((id) => Object.assign({ id }, docs.get(id)));
    const ganadores = S.ganadores(vistos, hoy);
    const nombresNuevos = S.anunciantesNuevos(antes, nuevos);
    const tiendas = (A.cfg.tiendas && A.cfg.tiendas.dominios) || [];
    // Las tiendas que el usuario quitó no vuelven a sumarse solas
    const quitadas = new Set((A.cfg.tiendas && A.cfg.tiendas.quitadas) || []);
    const dom = S.dominiosNuevos(vistos.filter((a) => !quitadas.has(VC.research.normalizeDomain(a.dominio))), tiendas, S.MAX_DOMINIOS);
    if (dom.agregar.length) A.setCfg('tiendas', { dominios: dom.lista });
    const porBusqueda = S.porBusqueda(items);
    const base = { fecha: ahora, porBusqueda, nuevos: nuevos.length, total: vistos.length, ganadores: ganadores.length, nombresNuevos, dominiosNuevos: dom.agregar, aviso };
    let doc = S.armarEscaneo(base);
    await guardar('escaneos/ultimo', doc);
    ultimo = doc;
    ultimoCargado = true;
    if (el) {
      renderFound();
      renderDataSoon();
    }

    if (vistos.length && AI.sample) {
      cortarSiCancelo(ctx);
      ctx.progress('Escribiendo qué encontré…');
      let resumen = '';
      let errorResumen = '';
      try {
        const res = await AI.sample(S.findingsPrompt({ nuevos, ganadores, porBusqueda, total: vistos.length, hoy, datos: App.datos(), vistos }), { signal: ctx.signal, cache: false });
        resumen = String((res && res.text) || '').trim();
      } catch (err) {
        if (err && err.code === 'cancelled') throw err;
        errorResumen = AI.errorText(err);
      }
      doc = S.armarEscaneo(Object.assign({}, base, { resumen, errorResumen }));
      await guardar('escaneos/ultimo', doc);
      ultimo = doc;
      if (resumen) {
        const fecha = new Date().toISOString();
        await guardar('ideas/competencia', { text: doc.resumen, fecha });
        if (!state.ideas.running) {
          state.ideas.text = doc.resumen;
          state.ideas.fecha = fecha;
          state.ideas.error = '';
        }
      }
      if (el) {
        renderFound();
        renderIdeas();
      }
    }

    const c = A.cfg.competencia || {};
    return {
      novedades: nuevos.length,
      nuevos: nuevos.length,
      total: vistos.length,
      ganadores: ganadores.length,
      anunciantesNuevos: nombresNuevos.length,
      tiendasNuevas: dom.agregar.length,
      resumen: S.resumenCorto(nuevos.length) + (aviso ? '. ' + LOGIN : ''),
      siguiente: c.guionesTras && nuevos.length > 0 ? 'guiones' : undefined,
      motivoSiguiente: 'competencia',
    };
  }

  if (A) A.register('competencia', { needs: ['browser', 'sample'], run: escanear });

  VC.tools = VC.tools || {};
  VC.tools.competencia = { mount, render };
})(window);
