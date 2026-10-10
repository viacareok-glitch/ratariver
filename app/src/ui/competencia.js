/* Espía de anuncios de la competencia */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const CP = VC.competitors;
  const R = VC.research;
  const S = VC.scan;
  const { Store, AI, Browser } = VC.runtime;
  const { e, $, App, chip, emptyState, toast, copyText, storeFail } = VC.ui;
  const A = VC.auto;

  const LOGIN = 'Meta pide iniciar sesión en el navegador de Claude: entrá una vez a facebook.com en ese navegador';
  const HORAS = [12, 24, 48, 72];

  const state = {
    ads: new Map(),
    texto: '',
    imagenes: [],
    imgLimits: null,
    running: false,
    error: '',
    ideas: { text: '', fecha: null, running: false, error: '' },
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
      '<header class="tool-head"><div><h2>Anuncios de la competencia</h2><p class="lede">Un corrector que lleva semanas activo en la Biblioteca de anuncios de Meta es señal de que le rinde: nadie sostiene un anuncio que pierde plata. Escaneá la Biblioteca sola desde tu PC o pegá lo que ves, y te resume ganchos, ángulos, ofertas y precios.</p></div></header>' +
      '<section class="panel auto-panel" id="cp-auto"></section><section class="panel" id="cp-found"></section><div id="cp-tiendas"></div>' +
      '<section class="panel" id="cp-links"></section><section class="panel" id="cp-input"></section><div id="cp-summary"></div><section class="panel" id="cp-ideas"></section><section class="panel" id="cp-table"></section>';
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
    renderData();
  }

  function render() {
    renderAuto();
    renderFound();
    if (VC.tools.tiendas && VC.tools.tiendas.render) VC.tools.tiendas.render();
    renderInput();
    renderData();
  }

  /* ---------- Escaneo automático: interfaz ---------- */

  function renderAuto() {
    const box = el && $('#cp-auto', el);
    if (!box) return;
    if (!box.dataset.ready) {
      box.innerHTML = '<div id="cp-auto-head"></div><div id="cp-auto-prog"></div><div id="cp-auto-cfg"></div>';
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
    const meta = [
      ult ? 'Último escaneo: ' + U.timeAgo(ult) + (est.origen === 'auto' ? ' (solo, al abrir el panel)' : '') : 'Todavía no escaneaste',
      c.auto ? 'Automático: al abrir el panel, cada ' + c.cadaHoras + ' h' : 'Automático apagado',
    ];
    let accion = '';
    if (Browser.available) {
      accion = corriendo
        ? '<button class="btn ghost" data-act="auto-detener">Detener</button>'
        : '<button class="btn" data-act="auto-escanear"' + (!chk.ok || pedido ? ' disabled' : '') + '>' + (pedido ? 'En cola…' : 'Escanear ahora') + '</button>';
    }
    let aviso = '';
    if (!Browser.checked) aviso = '<p class="auto-off">Revisando si el navegador de Claude está disponible…</p>';
    else if (!Browser.available)
      aviso =
        '<div class="auto-off"><strong>El escaneo automático usa el navegador de Claude en tu PC.</strong> Funciona cuando abrís este panel desde la app de escritorio de Claude, en una sesión de Cowork: ahí abre la Biblioteca de anuncios con tus búsquedas, guarda los anuncios nuevos y te cuenta qué encontró. Igual podés dejar configurado qué buscar, y la búsqueda a mano de más abajo funciona en cualquier lado.</div>';
    else if (!chk.ok) aviso = '<p class="auto-off">' + e(chk.motivo) + '</p>';
    let estado = '';
    if (otra) estado = '<p class="small muted">' + (pedido ? 'En cola: el escaneo arranca cuando termine la ' + e(otra) + '.' : 'Ahora está corriendo la ' + e(otra) + '. Si tocás “Escanear ahora”, queda en cola.') + '</p>';
    else if (!corriendo && est.error) estado = '<p class="error-text">El último escaneo no terminó: ' + e(est.error) + '</p>';
    else if (!corriendo && est.resultado && est.resultado.resumen) estado = '<p class="small">' + e(est.resultado.resumen) + '.</p>';
    box.innerHTML =
      '<div class="auto-head"><div class="cp-auto-title"><h3>Escaneo automático</h3><div class="auto-meta">' +
      meta.map((m) => '<span>' + e(m) + '</span>').join('') +
      '</div></div>' +
      (accion ? '<div class="row-actions">' + accion + '</div>' : '') +
      '</div><p class="cp-auto-lede">Abre la Biblioteca de anuncios de Meta en el navegador de Claude con cada búsqueda, guarda los anuncios nuevos, suma las tiendas que aparecen para revisarlas y te resume qué les funciona a tus competidores.</p>' +
      aviso +
      estado;
  }

  const ST = {
    espera: ['en espera', ''],
    leyendo: ['leyendo…', ''],
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
    if (!vivo.items.length || (!corriendo && !est.error)) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<ul class="auto-progress">' +
      vivo.items
        .map((it) => {
          const st = ST[it.estado] || ST.espera;
          const det = it.error ? it.error : it.estado === 'ok' ? plural(it.anuncios, 'anuncio', 'anuncios') + ' · ' + plural(it.nuevos, 'nuevo', 'nuevos') : '';
          return '<li><span class="st' + (st[1] ? ' ' + st[1] : '') + '">' + e(st[0]) + '</span><span>' + e(it.q) + (det ? ' <span class="muted">· ' + e(det) + '</span>' : '') + '</span></li>';
        })
        .join('') +
      '</ul>' +
      (corriendo && A.progress.competencia ? '<p class="muted small" aria-live="polite">' + e(A.progress.competencia) + '</p>' : '');
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
      '<div class="cp-auto-cfg"><div class="auto-toggles"><span class="cp-auto-when"><label><input type="checkbox" data-cfg="auto"' +
      (c.auto ? ' checked' : '') +
      dis +
      '> Escanear solo al abrir el panel</label><label>si pasaron <select data-cfg="cadaHoras" aria-label="Cada cuántas horas"' +
      dis +
      '>' +
      horas.map((h) => '<option value="' + h + '"' + (Number(c.cadaHoras) === h ? ' selected' : '') + '>' + h + '</option>').join('') +
      '</select> horas</label></span><label><input type="checkbox" data-cfg="guionesTras"' +
      (c.guionesTras ? ' checked' : '') +
      dis +
      '> Después del escaneo, escribir guiones nuevos con lo que encontré</label></div>' +
      '<div class="cp-qs"><div class="cp-qs-head"><span class="eyebrow">Búsquedas · ' +
      qs.length +
      ' de ' +
      S.MAX_BUSQUEDAS +
      '</span>' +
      (igualDefault ? '' : '<button type="button" class="btn link" data-act="q-default"' + dis + '>Volver a las de siempre</button>') +
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
            '>×</button></span>'
        )
        .join('') +
      '</div><form id="cp-q-form" class="cp-q-form"><label for="cp-q-nueva" class="sr-only">Agregar una búsqueda</label><input id="cp-q-nueva" maxlength="60" autocomplete="off" placeholder="' +
      (lleno ? 'Quitá una para agregar otra' : 'Agregar búsqueda, ej. faja lumbar') +
      '"' +
      (lleno ? ' disabled' : '') +
      dis +
      '><button class="btn ghost" type="submit"' +
      (lleno ? ' disabled' : '') +
      dis +
      '>Agregar</button></form></div></div>';
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

  function renderFound() {
    const box = el && $('#cp-found', el);
    if (!box) return;
    if (!ultimoCargado) {
      box.innerHTML = '<h3>Qué encontré</h3><p class="muted small">Cargando el último escaneo…</p>';
      return;
    }
    const u = ultimo;
    if (!u) {
      box.innerHTML =
        '<h3>Qué encontré</h3>' +
        emptyState(
          'Todavía no hay escaneos',
          'Cuando escanees, acá vas a ver los anuncios nuevos de la competencia, los que llevan ' +
            CP.GANADOR_DIAS +
            ' días o más activos (señal de que les rinden), sus precios contra los tuyos y qué probar en ViaCare.'
        );
      return;
    }
    const pb = Array.isArray(u.porBusqueda) ? u.porBusqueda : [];
    box.innerHTML =
      '<div class="panel-head"><h3>Qué encontré</h3><div class="row-actions"><span class="muted small">Escaneado ' +
      e(U.timeAgo(u.fecha)) +
      '</span>' +
      (u.resumen ? '<button class="btn ghost" data-act="found-copiar">Copiar</button>' : '') +
      '</div></div><div class="chips">' +
      chip(plural(u.nuevos || 0, 'anuncio nuevo', 'anuncios nuevos'), u.nuevos ? 'info' : 'neutral') +
      chip((u.ganadores || 0) + ' activos ' + CP.GANADOR_DIAS + '+ días', u.ganadores ? 'good' : 'neutral') +
      chip(plural(u.anunciantesNuevos || 0, 'anunciante nuevo', 'anunciantes nuevos'), u.anunciantesNuevos ? 'source' : 'neutral') +
      chip(plural(u.total || 0, 'anuncio visto', 'anuncios vistos'), 'neutral') +
      '</div>' +
      (u.nombresNuevos && u.nombresNuevos.length ? '<p class="small"><span class="eyebrow">Anunciantes nuevos</span>' + e(u.nombresNuevos.join(', ')) + '</p>' : '') +
      (u.dominiosNuevos && u.dominiosNuevos.length ? '<p class="small"><span class="eyebrow">Tiendas sumadas para revisar</span>' + e(u.dominiosNuevos.join(', ')) + '</p>' : '') +
      (u.aviso ? '<p class="error-text">' + e(u.aviso) + '</p>' : '') +
      (pb.length
        ? '<ul class="auto-progress cp-found-q">' +
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
        : '') +
      (u.resumen
        ? '<div class="findings">' + e(u.resumen) + '</div>'
        : '<p class="muted small">' +
          (!u.total ? 'No apareció ningún anuncio activo con estas búsquedas.' : u.errorResumen ? 'No se pudo escribir el resumen: ' + e(u.errorResumen) : A && A.running === 'competencia' ? 'Escribiendo el resumen…' : 'Sin resumen en este escaneo.') +
          '</p>') +
      '<p class="note">Meta no publica cuánto vende cada anuncio. Que siga activo ' + CP.GANADOR_DIAS + ' días o más es una señal de que le rinde, no un dato de ventas.</p>';
  }

  function plural(n, uno, varios) {
    return (n || 0) + ' ' + (n === 1 ? uno : varios);
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

  function renderLinks() {
    $('#cp-links', el).innerHTML =
      '<h3>1. Buscá en la Biblioteca de anuncios</h3><p class="muted small">Se abre filtrada por Argentina y anuncios activos. Mirá la fecha “Comenzó a circular el…”: los que llevan ' +
      CP.GANADOR_DIAS +
      ' días o más son los que les rinden.</p><div class="row-actions">' +
      CP.BUSQUEDAS.map((q) => '<a class="btn ghost" href="' + e(CP.adLibraryUrl(q)) + '" target="_blank" rel="noopener">' + e(q) + '</a>').join('') +
      '<a class="btn ghost" href="' +
      e(CP.tiktokTopAdsUrl()) +
      '" target="_blank" rel="noopener">TikTok Creative Center</a></div>';
  }

  function renderInput() {
    const box = $('#cp-input', el);
    if (!box) return;
    const canImg = !!state.imgLimits;
    box.innerHTML =
      '<h3>2. Traé lo que encontraste</h3>' +
      (AI.sample
        ? '<p class="muted small">En la página de resultados seleccioná todo (Ctrl+A o Cmd+A), copiá y pegalo acá. ' +
          (canImg ? 'También podés pegar o subir capturas de pantalla (hasta ' + state.imgLimits.maxCount + ').' : '') +
          '</p><label for="cp-texto" class="sr-only">Texto copiado de la Biblioteca de anuncios</label><textarea id="cp-texto" rows="6" placeholder="Pegá acá el texto de la Biblioteca de anuncios…">' +
          e(state.texto) +
          '</textarea>' +
          (canImg
            ? '<div class="row-actions"><label class="btn ghost file-btn">Subir capturas<input type="file" id="cp-imgs" accept="' +
              e(state.imgLimits.mediaTypes.join(',')) +
              '" multiple hidden></label>' +
              (state.imagenes.length ? '<span class="muted small">' + state.imagenes.length + ' captura(s) lista(s)</span><button class="btn link" data-act="quitar-imgs">Quitar</button>' : '') +
              '</div>'
            : '') +
          '<div class="row-actions">' +
          (state.running
            ? '<button class="btn ghost" data-act="detener">Detener</button><span class="muted">Leyendo los anuncios… puede tardar un minuto.</span>'
            : '<button class="btn" data-act="extraer">Extraer anuncios</button>') +
          '</div>' +
          (state.error ? '<p class="error-text">' + e(state.error) + '</p>' : '')
        : '<p class="muted small">Abrí el panel desde claude.ai para que Claude lea el texto o las capturas. Mientras tanto, cargalos a mano.</p>') +
      '<details class="manual"><summary>Cargar un anuncio a mano</summary><form id="cp-form" class="review-form"><div class="form-grid">' +
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
      '<label for="cp-f-gancho">Gancho (primera frase)<input id="cp-f-gancho" name="gancho" required></label><label for="cp-f-nota">Nota<input id="cp-f-nota" name="nota"></label><div class="row-actions"><button class="btn" type="submit">Guardar anuncio</button></div></form></details>';
  }

  function inp(k, label, type) {
    return '<label for="cp-f-' + k + '">' + e(label) + '<input id="cp-f-' + k + '" name="' + k + '"' + (type ? ' type="' + type + '"' : '') + '></label>';
  }

  function adsList() {
    return [...state.ads.entries()].map(([id, a]) => Object.assign({ id }, a));
  }

  function renderData() {
    const s = CP.summarize(adsList());
    const sum = $('#cp-summary', el);
    const table = $('#cp-table', el);
    if (!s.total) {
      sum.innerHTML = '';
      $('#cp-ideas', el).hidden = true;
      table.innerHTML = '<h3>Anuncios guardados</h3>' + emptyState('Todavía no hay anuncios', 'Buscá en la Biblioteca, pegá lo que encontraste y tocá “Extraer anuncios”. Quedan guardados acá para comparar.');
      return;
    }
    $('#cp-ideas', el).hidden = false;
    const top = (arr) => arr.slice(0, 4).map(([k, n]) => chip((CP.ANGULOS[k] || k) + ' · ' + n, 'source')).join('');
    sum.innerHTML =
      '<div class="summary-strip">' +
      stat(s.total, 'anuncios guardados') +
      stat(s.anunciantes, 'anunciantes') +
      stat(s.ganadores, 'activos hace ' + CP.GANADOR_DIAS + '+ días', s.ganadores ? 'good' : '') +
      '</div><div class="panel"><div class="kv"><span class="eyebrow">Ángulos</span><div class="chips">' +
      (top(s.angulos) || '<span class="muted small">—</span>') +
      '</div></div><div class="kv"><span class="eyebrow">Ofertas</span><div class="chips">' +
      (s.ofertas.length ? s.ofertas.slice(0, 6).map(([k, n]) => chip(k + ' · ' + n, 'neutral')).join('') : '<span class="muted small">—</span>') +
      '</div></div></div>';
    table.innerHTML =
      '<div class="panel-head"><h3>Anuncios guardados</h3><button class="btn link" data-act="borrar-todo">Borrar todos</button></div><div class="table-wrap"><table class="table comp"><thead><tr><th>Anunciante</th><th class="num">Días</th><th>Ángulo</th><th>Oferta</th><th class="num">Precio</th><th>Gancho</th><th></th></tr></thead><tbody>' +
      s.ads
        .map(
          (a) =>
            '<tr><th scope="row">' +
            e(a.anunciante || '—') +
            (ultimo && S.esNuevo(a, ultimo.fecha) ? ' ' + chip('nuevo', 'info') : '') +
            '<div class="muted small">' +
            e([a.formato || '', a.ultimaVez ? 'visto ' + U.timeAgo(a.ultimaVez) : ''].filter(Boolean).join(' · ')) +
            '</div></th><td class="num">' +
            (a.dias != null ? chip(a.dias + ' d', a.dias >= CP.GANADOR_DIAS ? 'good' : 'neutral') : '—') +
            '</td><td>' +
            e(CP.ANGULOS[a.angulo] || a.angulo || '') +
            '</td><td>' +
            e(a.oferta || '—') +
            '</td><td class="num">' +
            (a.precio ? e(U.money(a.precio)) : '—') +
            '</td><td class="hook-cell">“' +
            e(a.gancho) +
            '”' +
            (a.nota ? '<div class="muted small">' + e(a.nota) + '</div>' : '') +
            '</td><td><div class="cp-acts">' +
            (a.idBiblioteca
              ? '<a class="btn link" href="' + e(R.adUrl(a.idBiblioteca)) + '" target="_blank" rel="noopener" aria-label="Ver en la Biblioteca el anuncio de ' + e(a.anunciante || '') + '">Ver</a>'
              : '') +
            '<button class="btn link" data-act="borrar" data-id="' +
            e(a.id) +
            '" aria-label="Borrar anuncio de ' +
            e(a.anunciante || '') +
            '">Borrar</button></div></td></tr>'
        )
        .join('') +
      '</tbody></table></div>';
    renderIdeas();
  }

  function stat(v, label, tone) {
    return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><span class="stat-value">' + e(v) + '</span><span class="stat-label">' + e(label) + '</span></div>';
  }

  function renderIdeas() {
    const box = $('#cp-ideas', el);
    if (!box || box.hidden) return;
    const I = state.ideas;
    box.innerHTML =
      '<div class="panel-head"><h3>Qué aprender y qué probar</h3>' +
      (AI.sample
        ? '<div class="row-actions">' +
          (I.running ? '<button class="btn ghost" data-act="ideas-stop">Detener</button>' : '<button class="btn" data-act="ideas">' + (I.text ? 'Actualizar' : 'Pedir resumen e ideas') + '</button>') +
          (I.text && !I.running ? '<button class="btn ghost" data-act="ideas-copiar">Copiar</button>' : '') +
          '</div>'
        : '') +
      '</div>' +
      (I.text || I.running
        ? '<div class="ia-out' + (I.running && !I.text ? ' is-thinking' : '') + '">' + (I.text ? e(I.text) : 'Pensando…') + '</div>' + (I.fecha && !I.running ? '<p class="muted small">Generado ' + e(U.timeAgo(I.fecha)) + '</p>' : '')
        : '<p class="muted">' + (AI.sample ? 'Claude compara los anuncios guardados y te propone 5 creativos para ViaCare.' : 'Abrí el panel desde claude.ai para pedir el resumen.') + '</p>') +
      (I.error ? '<p class="error-text">' + e(I.error) + '</p>' : '');
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
      if (!ads.length) state.error = 'No encontramos anuncios en lo que pegaste. Copiá la página de resultados completa o subí capturas.';
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
        toast(nuevos + ' anuncio(s) nuevo(s) guardado(s).', 'good');
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
    renderIdeas();
    try {
      const s = CP.summarize(adsList());
      const res = await AI.sample(CP.insightPrompt(s.ads, U.todayKeyAR(), App.datos()), {
        signal: ctl.signal,
        cache: false,
        onText: ({ text }) => {
          state.ideas.text = text;
          const out = el.querySelector('#cp-ideas .ia-out');
          if (out) {
            out.classList.remove('is-thinking');
            out.textContent = text;
          }
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
        if (ultimo && ultimo.resumen) copyText(ultimo.resumen, t);
        break;
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
        copyText(state.ideas.text, t);
        break;
      case 'borrar':
        state.ads.delete(t.dataset.id);
        Store.remove('competencia/' + t.dataset.id).catch(storeFail);
        renderData();
        break;
      case 'borrar-todo':
        if (t.dataset.confirm !== '1') {
          t.dataset.confirm = '1';
          t.textContent = 'Tocá de nuevo para borrar todo';
          setTimeout(() => {
            t.dataset.confirm = '';
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
