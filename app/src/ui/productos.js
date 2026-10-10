/* Buscador del próximo producto */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const P = VC.profit;
  const PR = VC.products;
  const CP = VC.competitors;
  const R = VC.research;
  const W = VC.winners;
  const { Store, Shop, AI, Browser } = VC.runtime;
  const { e, $, App, chip, banner, toast, storeFail } = VC.ui;
  const A = VC.auto;

  const ESCALAS = [
    ['demanda', 'Demanda', 'más es mejor'],
    ['competencia', 'Competencia', '5 = mucha'],
    ['afinidad', 'Afinidad con tu cliente', 'más es mejor'],
    ['video', 'Se luce en video', 'más es mejor'],
    ['riesgo', 'Riesgo (devoluciones, talles, fallas)', '5 = alto'],
  ];
  const CADA = [24, 72, 168];

  const state = {
    items: PR.CANDIDATOS.map((c) => Object.assign({ precio: null, costo: null }, c)),
    cpa: null,
    ia: { running: false, data: null, error: '' },
    cargado: false, // ya se leyó 'productos/lista'
    inv: new Map(), // id de documento → medición en Mercado Libre ('investigacion/<id>')
    desc: null, // 'investigacion/descubrir'
  };
  let el;
  let ctl;
  // Tareas automáticas: progreso en vivo y si el usuario las dejó en cola
  const vivo = { medir: [], desc: [] };
  const pedido = { productos: false, descubrir: false };

  function mount(section) {
    el = section;
    el.innerHTML =
      '<header class="tool-head"><div><h2>Próximo producto</h2><p class="lede">Compará qué sumar al corrector. Cargá el precio al que lo venderías y lo que te cuesta: el panel calcula cuánto deja con tus tasas reales y lo puntúa por demanda, competencia y afinidad con tu cliente.</p></div>' +
      '<div class="tool-actions"><button class="btn ghost" data-act="agregar">Agregar producto</button></div></header>' +
      '<section class="panel auto-panel" id="pr-auto"></section>' +
      '<div id="pr-warn"></div><section class="panel" id="pr-params"></section><div id="pr-ranking"></div><section class="panel" id="pr-ia"></section><div id="pr-list" class="product-list"></div>';
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('click', onClick);
    App.on((w) => w === 'cfg' && renderAll());
    if (A) A.on(onAuto);
    Store.get('productos/lista')
      .catch(() => null)
      .then((d) => {
        // Conserva lo que cargó el usuario y suma candidatos nuevos de la lista base
        if (d && Array.isArray(d.items) && d.items.length) {
          state.items = W.unirLista(d, PR.CANDIDATOS);
          state.cpa = d.cpa == null ? null : d.cpa;
        }
        state.cargado = true;
        renderAll();
      });
    cargarInvestigacion();
    renderAll();
  }

  const save = VC.ui.debounce(() => Store.set('productos/lista', JSON.parse(JSON.stringify({ items: state.items, cpa: state.cpa }))).catch(storeFail), 800);

  function cpa() {
    if (state.cpa != null) return state.cpa;
    const manual = P.normalizeCfg(App.cfg).cpaMaxManual;
    return manual > 0 ? Math.round(manual * 0.7) : 15000;
  }

  function rates() {
    return O.historicalRates(Shop.orders);
  }

  function renderAll() {
    if (!el) return;
    renderAuto();
    $('#pr-warn', el).innerHTML = P.costsReady(App.cfg) ? '' : banner('warn', 'Cargá en Ajustes el costo de envío y de devolución: se usan para calcular el margen de cualquier producto.', '<button class="btn ghost" data-goto="ajustes">Ir a Ajustes</button>');
    if (!$('#pr-params', el).contains(document.activeElement)) {
      const medidos = state.items.some((p) => p.medido);
      $('#pr-params', el).innerHTML =
        '<div class="form-grid"><label for="pr-cpa">Costo en publicidad por pedido (estimado para el producto nuevo)<span class="input-unit"><span class="unit">$</span><input id="pr-cpa" inputmode="numeric" value="' +
        e(U.int(cpa())) +
        '"></span></label></div><p class="muted small">' +
        (medidos
          ? 'Precios de referencia: del 25 % al 75 % de los precios de las publicaciones medidas en Mercado Libre. Cada medición ajusta demanda y competencia; afinidad, video y riesgo quedan como los dejes.'
          : 'Precios de referencia: publicaciones de Mercado Libre Argentina (' +
            PR.REF_FECHA +
            '). Los puntajes vienen con una estimación inicial: ajustalos con lo que veas en Mercado Libre, Google Trends y la Biblioteca de anuncios.') +
        '</p>';
    }
    renderRanking();
    renderIA();
    renderList();
  }

  function scored() {
    return state.items.map((p) => Object.assign({ p }, PR.score(p, App.cfg, rates(), cpa())));
  }

  function renderRanking() {
    const list = scored().sort((a, b) => b.completo - a.completo || b.puntaje - a.puntaje);
    const box = $('#pr-ranking', el);
    box.innerHTML =
      '<section class="panel"><h3>Ranking</h3><ol class="ranking">' +
      list
        .map((s, i) => {
          const v = W.veredicto(s.p.vende);
          return (
            '<li><span class="rk-pos mono">' +
            (i + 1) +
            '</span><span class="rk-name">' +
            e(s.p.nombre) +
            (v ? ' ' + chip(v.label, v.tone) : '') +
            (s.completo ? '' : ' <span class="muted small">(falta precio o costo)</span>') +
            '</span><span class="wf-track"><span class="wf-bar ' +
            (i === 0 && s.completo ? 'pos' : 'base') +
            '" style="width:' +
            Math.max(2, s.puntaje) +
            '%"></span></span><span class="wf-val mono">' +
            s.puntaje +
            '</span></li>'
          );
        })
        .join('') +
      '</ol><p class="muted small">Puntaje de 0 a 100: margen ' +
      PR.PESOS.margen +
      '%, demanda ' +
      PR.PESOS.demanda +
      '%, competencia ' +
      PR.PESOS.competencia +
      '%, afinidad ' +
      PR.PESOS.afinidad +
      '%, video ' +
      PR.PESOS.video +
      '%, riesgo ' +
      PR.PESOS.riesgo +
      '%. Sin precio y costo, el margen no cuenta.</p></section>';
  }

  function refText(p) {
    return p.refMin ? 'Mercado Libre: ' + U.money(p.refMin) + ' a ' + U.money(p.refMax) : 'Sin precio de referencia relevado';
  }

  function renderList() {
    const box = $('#pr-list', el);
    if (box.contains(document.activeElement)) {
      // Solo actualiza los números para no perder el foco mientras escribís
      for (const s of scored()) updateNumbers(s);
      return;
    }
    box.innerHTML = scored()
      .map((s, i) => {
        const p = s.p;
        const sug = state.ia.data && state.ia.data.find((x) => norm(x.nombre) === norm(p.nombre));
        const inv = state.inv.get(W.docId(p.id));
        return (
          '<article class="product-card" id="pc-' +
          e(p.id) +
          '"><header class="pc-head"><div><h4>' +
          e(p.nombre) +
          '</h4><p class="muted small" data-out="ref">' +
          e(refText(p)) +
          '</p></div><div class="pc-score"><span class="stat-value" data-out="puntaje">' +
          s.puntaje +
          '</span><span class="stat-label">puntaje</span></div></header>' +
          (p.nota ? '<p class="small">' + e(p.nota) + '</p>' : '') +
          '<div class="pr-ml" data-out="ml" data-v="' +
          e(inv ? inv.fecha : '') +
          '"' +
          (inv || Browser.available ? '' : ' hidden') +
          '>' +
          mlInner(p) +
          '</div>' +
          '<div class="row-actions links"><a class="btn link" href="' +
          e(PR.mlUrl(p.busqueda || p.nombre)) +
          '" target="_blank" rel="noopener">Mercado Libre</a><a class="btn link" href="' +
          e(PR.trendsUrl(p.busqueda || p.nombre)) +
          '" target="_blank" rel="noopener">Google Trends</a><a class="btn link" href="' +
          e(CP.adLibraryUrl(p.busqueda || p.nombre)) +
          '" target="_blank" rel="noopener">Anuncios activos</a>' +
          (p.custom ? '<button class="btn link" data-act="quitar" data-i="' + i + '">Quitar</button>' : '') +
          '</div><div class="form-grid">' +
          (p.custom ? money(i, 'nombre', 'Nombre', p.nombre, true) : '') +
          money(i, 'precio', 'Precio de venta', p.precio) +
          money(i, 'costo', 'Costo (proveedor)', p.costo) +
          money(i, 'envioExtra', 'Envío extra vs. el corrector', p.envioExtra) +
          '</div><div class="scales">' +
          ESCALAS.map(
            ([k, label, hint]) =>
              '<label for="pr-' +
              i +
              '-' +
              k +
              '">' +
              e(label) +
              ' <span class="muted">(' +
              e(hint) +
              ')</span><select id="pr-' +
              i +
              '-' +
              k +
              '" data-i="' +
              i +
              '" data-k="' +
              k +
              '">' +
              [1, 2, 3, 4, 5].map((n) => '<option' + (Number(p[k]) === n ? ' selected' : '') + '>' + n + '</option>').join('') +
              '</select></label>'
          ).join('') +
          '</div><div class="pc-out"><div><span class="eyebrow">Por pedido con anuncios</span><span class="mono" data-out="anuncios">' +
          (s.eco ? e(U.money(s.eco.conAnuncios)) : '—') +
          '</span></div><div><span class="eyebrow">Venta a un cliente actual</span><span class="mono" data-out="cliente">' +
          (s.eco ? e(U.money(s.eco.aCliente)) : '—') +
          '</span></div><div><span class="eyebrow">Precio ÷ costo</span><span class="mono" data-out="markup">' +
          (s.eco ? e(s.eco.markup.toFixed(1).replace('.', ',')) + '×' : '—') +
          '</span></div></div>' +
          (sug ? suggestion(sug, i) : '') +
          '</article>'
        );
      })
      .join('');
  }

  function updateNumbers(s) {
    const card = el.querySelector('#pc-' + CSS.escape(s.p.id));
    if (!card) return;
    const set = (k, v) => {
      const n = card.querySelector('[data-out="' + k + '"]');
      if (n) n.textContent = v;
    };
    set('puntaje', s.puntaje);
    set('anuncios', s.eco ? U.money(s.eco.conAnuncios) : '—');
    set('cliente', s.eco ? U.money(s.eco.aCliente) : '—');
    set('markup', s.eco ? s.eco.markup.toFixed(1).replace('.', ',') + '×' : '—');
    // Lo que cambia una medición en Mercado Libre (sin tocar el campo donde estás escribiendo)
    set('ref', refText(s.p));
    const ml = card.querySelector('[data-out="ml"]');
    const inv = state.inv.get(W.docId(s.p.id));
    if (ml && ml.dataset.v !== (inv ? inv.fecha : '')) {
      ml.dataset.v = inv ? inv.fecha : '';
      ml.hidden = !inv && !Browser.available;
      ml.innerHTML = mlInner(s.p);
    }
    for (const k of ['demanda', 'competencia']) {
      const sel = card.querySelector('select[data-k="' + k + '"]');
      if (sel && sel !== document.activeElement && Number(s.p[k])) sel.value = String(s.p[k]);
    }
  }

  /* Bloque "Mercado Libre (hace X)" de una tarjeta */
  function mlInner(p) {
    const inv = state.inv.get(W.docId(p.id));
    if (!inv || !inv.senales) return Browser.available ? '<p class="muted small">Mercado Libre: todavía sin medir. Tocá “Medir en Mercado Libre ahora” arriba.</p>' : '';
    const s = inv.senales;
    const v = W.veredicto(s.vende);
    const facts = [];
    if (s.resultados != null) facts.push(fact(U.int(s.resultados), s.resultados === 1 ? 'resultado' : 'resultados'));
    if (s.vendidosVisibles != null) facts.push(fact('+' + U.int(s.vendidosVisibles), 'vendidos visibles'));
    if (s.opiniones != null) facts.push(fact(U.int(s.opiniones), 'opiniones'));
    facts.push(fact(s.masVendidos || 0, 'con “Más vendido”'));
    if (s.precioMediana != null) facts.push(fact(U.money(s.precioMediana), 'precio mediana'));
    const pubs = Array.isArray(inv.publicaciones) ? inv.publicaciones : [];
    return (
      '<div class="pr-ml-head"><span class="eyebrow">Mercado Libre (' +
      e(U.timeAgo(inv.fecha)) +
      ')</span>' +
      (v ? chip(v.label, v.tone) : '') +
      '</div><ul class="pr-facts">' +
      facts.join('') +
      '</ul>' +
      (pubs.length
        ? '<details class="pr-pubs"><summary>Publicaciones principales (' +
          pubs.length +
          ')</summary><ol>' +
          pubs.map(pubItem).join('') +
          '</ol><p class="note">Mercado Libre muestra los vendidos redondeados y por toda la vida de la publicación: son señales de demanda, no ventas exactas.</p></details>'
        : '')
    );
  }

  function fact(valor, label) {
    return '<li><strong>' + e(valor) + '</strong> ' + e(label) + '</li>';
  }

  function pubItem(l) {
    const meta = [];
    if (l.vendidos != null) meta.push(W.fmtVendidos(l.vendidos));
    if (l.opiniones != null) meta.push((l.calificacion ? String(l.calificacion).replace('.', ',') + ' ' : '') + '(' + U.int(l.opiniones) + ' opiniones)');
    if (l.masVendido) meta.push('Más vendido');
    if (l.full) meta.push('Full');
    else if (l.envioGratis) meta.push('Envío gratis');
    if (l.vendedor) meta.push(l.vendedor);
    return (
      '<li><span class="pr-pub-t">' +
      e(l.titulo || 'Sin título') +
      '</span><span class="pr-pub-p mono">' +
      (l.precio ? e(U.money(l.precio)) : '—') +
      '</span>' +
      (meta.length ? '<span class="pr-pub-m">' + e(meta.join(' · ')) + '</span>' : '') +
      '</li>'
    );
  }

  function money(i, k, label, v, text) {
    return (
      '<label for="pr-' +
      i +
      '-' +
      k +
      '">' +
      e(label) +
      (text ? '' : '<span class="input-unit"><span class="unit">$</span>') +
      '<input id="pr-' +
      i +
      '-' +
      k +
      '" data-i="' +
      i +
      '" data-k="' +
      k +
      '"' +
      (text ? '' : ' inputmode="numeric" placeholder="0"') +
      ' value="' +
      e(text ? v || '' : v ? U.int(v) : '') +
      '">' +
      (text ? '' : '</span>') +
      '</label>'
    );
  }

  function suggestion(x, i) {
    return (
      '<div class="ia-sug"><span class="eyebrow">Claude sugiere</span><p class="small">Demanda ' +
      x.demanda +
      ' · competencia ' +
      x.competencia +
      ' · afinidad ' +
      x.afinidad +
      ' · video ' +
      x.video +
      ' · riesgo ' +
      x.riesgo +
      (x.precio_sugerido ? ' · precio ' + e(U.money(U.parseMoney(x.precio_sugerido))) : '') +
      '</p>' +
      (x.angulo ? '<p class="small"><strong>Ángulo:</strong> ' + e(x.angulo) + '</p>' : '') +
      (x.combo ? '<p class="small"><strong>Combo:</strong> ' + e(x.combo) + '</p>' : '') +
      (x.dudas ? '<p class="small muted">' + e(x.dudas) + '</p>' : '') +
      '<button class="btn ghost" data-act="aplicar" data-i="' +
      i +
      '">Usar estos puntajes</button></div>'
    );
  }

  function norm(s) {
    return U.stripAccents(String(s || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function renderIA() {
    const box = $('#pr-ia', el);
    const I = state.ia;
    box.innerHTML =
      '<div class="panel-head"><h3>Opinión de Claude</h3>' +
      (AI.sample ? (I.running ? '<button class="btn ghost" data-act="ia-stop">Detener</button>' : '<button class="btn" data-act="ia">' + (I.data ? 'Volver a preguntar' : 'Pedir opinión') + '</button>') : '') +
      '</div>' +
      (AI.sample
        ? I.running
          ? '<p class="muted">Pensando… puede tardar un minuto.</p>'
          : I.reco
            ? '<p>' + e(I.reco) + '</p><p class="muted small">Estimaciones sin acceso a internet: confirmá precios y demanda en Mercado Libre antes de comprar stock.</p>'
            : '<p class="muted">Claude estima demanda, competencia y afinidad de cada candidato y te sugiere precio, ángulo y combo. Son estimaciones sin acceso a internet.</p>'
        : '<p class="muted">Abrí el panel desde claude.ai para pedir la opinión de Claude.</p>') +
      (I.error ? '<p class="error-text">' + e(I.error) + '</p>' : '');
  }

  async function askIA() {
    ctl = new AbortController();
    state.ia = { running: true, data: state.ia.data, error: '' };
    renderIA();
    try {
      const data = await AI.sample.json(PR.claudePrompt(state.items, App.tienda), { signal: ctl.signal, cache: false });
      const list = data && Array.isArray(data.productos) ? data.productos : [];
      const clamp = (n) => U.clamp(Math.round(Number(n) || 3), 1, 5);
      state.ia.data = list.map((x) => ({ nombre: String(x.nombre || ''), demanda: clamp(x.demanda), competencia: clamp(x.competencia), afinidad: clamp(x.afinidad), video: clamp(x.video), riesgo: clamp(x.riesgo), precio_sugerido: x.precio_sugerido, angulo: String(x.angulo || ''), combo: String(x.combo || ''), dudas: String(x.dudas || '') }));
      state.ia.reco = String((data && data.recomendacion) || '');
      if (!state.ia.data.length) state.ia.error = 'La respuesta vino vacía. Probá de nuevo.';
    } catch (err) {
      if (err && err.code !== 'cancelled') state.ia.error = AI.errorText(err);
      if (AI.permanent(err)) AI.sample = null;
    }
    state.ia.running = false;
    renderIA();
    renderList();
  }

  /* ---------- Buscar ganadores: interfaz ---------- */

  function renderAuto() {
    const box = el && $('#pr-auto', el);
    if (!box) return;
    if (!box.dataset.ready) {
      box.innerHTML = '<div id="pr-auto-head"></div><div id="pr-auto-prog"></div><div id="pr-auto-cfg"></div><div class="pr-desc"><div id="pr-desc-head"></div><div id="pr-desc-prog"></div><div id="pr-desc-list"></div></div>';
      box.dataset.ready = '1';
    }
    renderAutoHead();
    renderAutoProg();
    renderAutoCfg();
    renderDesc();
  }

  function diasTxt(h) {
    const n = Number(h) || 24;
    if (n % 24) return n + ' h';
    return n === 24 ? '1 día' : n / 24 + ' días';
  }

  function otraTarea(job) {
    return A && A.running && A.running !== job ? A.NOMBRES[A.running] || A.running : '';
  }

  function renderAutoHead() {
    const box = el && $('#pr-auto-head', el);
    if (!box) return;
    if (!A) {
      box.innerHTML = '<h3>Buscar ganadores</h3><p class="auto-off">La medición automática no cargó. Recargá el panel.</p>';
      return;
    }
    const c = A.cfg.productos || A.DEFAULTS.productos;
    const corriendo = A.running === 'productos';
    const otra = otraTarea('productos');
    const chk = A.can('productos');
    const est = A.estado.productos || {};
    const ult = A.ultima('productos');
    const meta = [
      ult ? 'Última medición: ' + U.timeAgo(ult) + (est.origen === 'auto' ? ' (sola, al abrir el panel)' : '') : 'Todavía no mediste',
      c.auto ? 'Automático: al abrir el panel, cada ' + diasTxt(c.cadaHoras) : 'Automático apagado',
    ];
    let accion = '';
    if (Browser.available) {
      accion = corriendo
        ? '<button class="btn ghost" data-act="medir-stop">Detener</button>'
        : '<button class="btn" data-act="medir"' + (!chk.ok || pedido.productos ? ' disabled' : '') + '>' + (pedido.productos ? 'En cola…' : 'Medir en Mercado Libre ahora') + '</button>';
    }
    let aviso = '';
    if (!Browser.checked) aviso = '<p class="auto-off">Revisando si el navegador de Claude está disponible…</p>';
    else if (!Browser.available)
      aviso =
        '<div class="auto-off"><strong>La medición usa el navegador de Claude en tu PC.</strong> Funciona cuando abrís este panel desde la app de escritorio de Claude, en una sesión de Cowork: ahí abre la búsqueda de cada producto en Mercado Libre, lee las publicaciones y anota las señales de venta. Mientras tanto, usá los links de cada tarjeta y cargá los puntajes a mano.</div>';
    else if (!chk.ok) aviso = '<p class="auto-off">' + e(chk.motivo) + '</p>';
    let estado = '';
    if (otra) estado = '<p class="small muted">' + (pedido.productos ? 'En cola: la medición arranca cuando termine la ' + e(otra) + '.' : 'Ahora está corriendo la ' + e(otra) + '. Si tocás “Medir en Mercado Libre ahora”, queda en cola.') + '</p>';
    else if (!corriendo && est.error) estado = '<p class="error-text">La última medición no terminó: ' + e(est.error) + '</p>';
    else if (!corriendo && est.resultado && est.resultado.resumen) estado = '<p class="small">' + e(est.resultado.resumen) + '.</p>';
    box.innerHTML =
      '<div class="auto-head"><div class="pr-auto-title"><h3>Buscar ganadores</h3><div class="auto-meta">' +
      meta.map((m) => '<span>' + e(m) + '</span>').join('') +
      '</div></div>' +
      (accion ? '<div class="row-actions">' + accion + '</div>' : '') +
      '</div><p class="pr-auto-lede">Abre en el navegador de Claude la búsqueda de Mercado Libre de cada producto de tu lista, lee las publicaciones principales y anota las señales de venta: “+X vendidos”, opiniones, el sello MÁS VENDIDO y cuántas publicaciones compiten. Con eso ajusta demanda, competencia y el rango de precios de cada tarjeta.</p>' +
      aviso +
      estado;
  }

  const ST = {
    espera: ['en espera', ''],
    leyendo: ['leyendo…', ''],
    ok: ['listo', 'ok'],
    error: ['error', 'err'],
    omitida: ['no se leyó', ''],
  };

  function progList(items, texto) {
    return (
      '<ul class="auto-progress">' +
      items
        .map((it) => {
          const st = ST[it.estado] || ST.espera;
          return '<li><span class="st' + (st[1] ? ' ' + st[1] : '') + '">' + e(st[0]) + '</span><span>' + e(it.q) + (it.detalle ? ' <span class="muted">· ' + e(it.detalle) + '</span>' : '') + '</span></li>';
        })
        .join('') +
      '</ul>' +
      (texto ? '<p class="muted small" aria-live="polite">' + e(texto) + '</p>' : '')
    );
  }

  function renderAutoProg() {
    const box = el && $('#pr-auto-prog', el);
    if (!box || !A) return;
    const corriendo = A.running === 'productos';
    const est = A.estado.productos || {};
    box.innerHTML = vivo.medir.length && (corriendo || est.error) ? progList(vivo.medir, corriendo ? A.progress.productos : '') : '';
  }

  function renderAutoCfg() {
    const box = el && $('#pr-auto-cfg', el);
    if (!box || !A) return;
    const c = A.cfg.productos || A.DEFAULTS.productos;
    const dis = A.loaded ? '' : ' disabled';
    const horas = CADA.includes(Number(c.cadaHoras)) ? CADA : CADA.concat(Number(c.cadaHoras) || 168).sort((a, b) => a - b);
    // Si el usuario está usando una opción, le devolvemos el foco al redibujar
    const act = document.activeElement;
    const keep = act && box.contains(act) && act.dataset ? act.dataset.cfg : '';
    box.innerHTML =
      '<div class="pr-auto-cfg"><div class="auto-toggles"><span class="pr-auto-when"><label><input type="checkbox" data-cfg="auto"' +
      (c.auto ? ' checked' : '') +
      dis +
      '> Medir solo al abrir el panel</label><label>cada <select data-cfg="cadaHoras" aria-label="Cada cuántos días"' +
      dis +
      '>' +
      horas.map((h) => '<option value="' + h + '"' + (Number(c.cadaHoras) === h ? ' selected' : '') + '>' + e(diasTxt(h)) + '</option>').join('') +
      '</select></label></span></div><p class="note">Mercado Libre no publica cuánto vende cada vendedor. “+5mil vendidos” es un número redondeado de toda la vida de la publicación, y las opiniones las deja una parte de los compradores: tomalo como señal de demanda, no como ventas exactas.</p></div>';
    if (keep) {
      const opt = $('[data-cfg="' + keep + '"]', box);
      if (opt) opt.focus();
    }
  }

  function renderDesc() {
    renderDescHead();
    renderDescProg();
    renderDescList();
  }

  function renderDescHead() {
    const box = el && $('#pr-desc-head', el);
    if (!box) return;
    const corriendo = A && A.running === 'descubrir';
    const chk = A ? A.can('descubrir') : { ok: false };
    const est = (A && A.estado.descubrir) || {};
    let accion = '';
    if (A && Browser.available) {
      accion = corriendo
        ? '<button class="btn ghost" data-act="desc-stop">Detener</button>'
        : '<button class="btn ghost" data-act="descubrir"' + (!chk.ok || pedido.descubrir ? ' disabled' : '') + '>' + (pedido.descubrir ? 'En cola…' : 'Descubrir productos nuevos') + '</button>';
    }
    const otra = otraTarea('descubrir');
    let estado = '';
    if (otra && pedido.descubrir) estado = '<p class="small muted">En cola: arranca cuando termine la ' + e(otra) + '.</p>';
    else if (!corriendo && est.error) estado = '<p class="error-text">La última búsqueda no terminó: ' + e(est.error) + '</p>';
    else if (A && Browser.available && !chk.ok) estado = '<p class="small muted">' + e(chk.motivo) + '</p>';
    box.innerHTML =
      '<div class="panel-head"><div class="pr-auto-title"><h4>Productos nuevos</h4><p class="muted small">Recorre Mercado Libre buscando productos que compraría el mismo cliente del corrector (espalda, cuello, dormir, home office) y que ya muestran señales de venta.</p></div>' +
      (accion ? '<div class="row-actions">' + accion + '</div>' : '') +
      '</div>' +
      estado;
  }

  function renderDescProg() {
    const box = el && $('#pr-desc-prog', el);
    if (!box || !A) return;
    const corriendo = A.running === 'descubrir';
    const est = A.estado.descubrir || {};
    if (corriendo && !vivo.desc.length) {
      box.innerHTML = '<p class="muted small" aria-live="polite">' + e(A.progress.descubrir || 'Empezando…') + '</p>';
      return;
    }
    box.innerHTML = vivo.desc.length && (corriendo || est.error) ? progList(vivo.desc, corriendo ? A.progress.descubrir : '') : '';
  }

  function renderDescList() {
    const box = el && $('#pr-desc-list', el);
    if (!box) return;
    const d = state.desc;
    const prods = d && Array.isArray(d.productos) ? d.productos : [];
    if (!d) {
      box.innerHTML = Browser.available
        ? '<p class="muted small">Tocá “Descubrir productos nuevos”: tarda unos minutos y te deja hasta 5 candidatos con su evidencia.</p>'
        : Browser.checked
          ? '<p class="muted small">También usa el navegador de Claude: abrí el panel desde la app de escritorio de Claude para buscarlos.</p>'
          : '';
      return;
    }
    box.innerHTML =
      (prods.length ? '<ul class="pr-desc-list">' + prods.map(descCard).join('') + '</ul>' : '<p class="muted small">La última búsqueda no encontró productos nuevos con señales de venta claras.</p>') +
      '<p class="note">Búsqueda ' +
      e(U.timeAgo(d.fecha)) +
      (d.modo === 'claude' ? ': Claude eligió qué páginas de Mercado Libre leer' : ': búsquedas de partida en Mercado Libre') +
      '. Las señales salen de lo que muestran las publicaciones, no son ventas exactas.</p>';
  }

  function descCard(d, n) {
    const ya = W.yaEnLista(d.busqueda || d.nombre, state.items);
    const v = W.veredicto(d.senales ? d.senales.vende : W.vendeDesde(d));
    const facts = [];
    if (d.precioMin || d.precioMax) facts.push('<li><strong>' + e(d.precioMin && d.precioMax && d.precioMin !== d.precioMax ? U.money(d.precioMin) + ' a ' + U.money(d.precioMax) : U.money(d.precioMin || d.precioMax)) + '</strong></li>');
    if (d.vendidos != null) facts.push('<li><strong>' + e(W.fmtVendidos(d.vendidos)) + '</strong> en una publicación</li>');
    if (d.opiniones != null) facts.push('<li><strong>' + e(U.int(d.opiniones)) + '</strong> opiniones</li>');
    return (
      '<li class="pr-desc-card"><div class="pr-desc-top"><strong class="pr-desc-name">' +
      e(d.nombre) +
      '</strong>' +
      (v ? chip(v.label, v.tone) : '') +
      '</div>' +
      (facts.length ? '<ul class="pr-facts">' + facts.join('') + '</ul>' : '') +
      (d.evidencia ? '<p class="small">' + e(d.evidencia) + '</p>' : '') +
      (d.por_que ? '<p class="small"><span class="eyebrow">Por qué</span>' + e(d.por_que) + '</p>' : '') +
      (d.video ? '<p class="small"><span class="eyebrow">En video</span>' + e(d.video) + '</p>' : '') +
      '<div class="row-actions">' +
      (ya ? '<span class="muted small">Ya está en tu lista</span>' : '<button class="btn ghost" data-act="desc-agregar" data-n="' + n + '">Agregar a mi lista</button>') +
      '<a class="btn link" href="' +
      e(PR.mlUrl(d.busqueda || d.nombre)) +
      '" target="_blank" rel="noopener">Ver en Mercado Libre</a></div></li>'
    );
  }

  function onAuto(ev) {
    if (!el) return;
    if (ev.type === 'cfg') {
      if (!ev.job || ev.job === 'productos') {
        renderAutoHead();
        renderAutoCfg();
        renderDesc();
      }
      return;
    }
    if (ev.job !== 'productos' && ev.job !== 'descubrir') {
      if (ev.type === 'start' || ev.type === 'done' || ev.type === 'error') {
        renderAutoHead();
        renderDescHead();
      }
      return;
    }
    if (ev.type === 'start') vivo[ev.job === 'productos' ? 'medir' : 'desc'] = [];
    if (ev.type === 'skip' && pedido[ev.job]) toast(ev.motivo || 'No se pudo correr acá.', 'warn');
    if (ev.type === 'progress') {
      if (ev.job === 'productos') renderAutoProg();
      else renderDescProg();
      return;
    }
    renderAutoHead();
    renderAutoProg();
    renderDesc();
    if (ev.type === 'done' || ev.type === 'error') recargar();
  }

  function correr(job) {
    if (!A || pedido[job] || A.running === job) return;
    pedido[job] = true;
    renderAutoHead();
    renderDescHead();
    A.run(job, { origen: 'manual' }).finally(() => {
      pedido[job] = false;
      if (el) {
        renderAutoHead();
        renderDescHead();
      }
    });
  }

  function cargarInvestigacion() {
    return Store.list('investigacion')
      .then((m) => {
        const inv = new Map();
        for (const [id, d] of m) if (id !== 'descubrir' && d && d.senales) inv.set(id, d);
        state.inv = inv;
        if (m.has('descubrir')) state.desc = m.get('descubrir');
        if (el) renderAll();
      })
      .catch(() => {});
  }

  // Después de una tarea: trae del Store las mediciones y los campos que tocó, sin pisar lo que estás escribiendo
  async function recargar() {
    const d = await Store.get('productos/lista').catch(() => null);
    if (d && Array.isArray(d.items) && state.cargado) {
      const by = new Map(d.items.map((x) => [x.id, x]));
      for (const p of state.items) {
        const s = by.get(p.id);
        if (s) for (const k of W.CAMPOS_MEDICION) if (s[k] !== undefined) p[k] = s[k];
      }
    }
    await cargarInvestigacion();
  }

  function agregarDescubierto(n) {
    const d = state.desc && Array.isArray(state.desc.productos) ? state.desc.productos[n] : null;
    if (!d) return;
    if (!state.cargado) {
      toast('Esperá un segundo: todavía estoy cargando tu lista.', 'warn');
      return;
    }
    if (W.yaEnLista(d.busqueda || d.nombre, state.items)) {
      toast('Ya está en tu lista.', 'warn');
      renderDescList();
      return;
    }
    const id = 'p' + Date.now().toString(36);
    const item = W.itemDesdeDescubrimiento(d, id);
    // Si se midió con las búsquedas de partida, la tarjeta arranca con su bloque de Mercado Libre
    if (d.senales && Array.isArray(d.publicaciones) && d.publicaciones.length) {
      const inv = W.investigacionDoc({ fecha: state.desc.fecha, busqueda: d.busqueda, resultados: d.resultados, publicaciones: d.publicaciones, senales: d.senales });
      Object.assign(item, W.camposMedicion(inv));
      state.inv.set(W.docId(id), inv);
      Store.set('investigacion/' + W.docId(id), inv).catch(storeFail);
    }
    state.items.push(item);
    save();
    renderAll();
    toast('Sumé “' + item.nombre + '” a tu lista. Cargá precio y costo para ver cuánto deja.', 'good');
  }

  function onInput(ev) {
    const t = ev.target;
    if (t.id === 'pr-cpa') {
      state.cpa = U.parseMoney(t.value);
      save();
      renderRanking();
      for (const s of scored()) updateNumbers(s);
      return;
    }
    if (t.dataset.i == null || !t.dataset.k) return;
    const p = state.items[Number(t.dataset.i)];
    const k = t.dataset.k;
    p[k] = k === 'nombre' ? t.value : U.parseMoney(t.value);
    save();
    renderRanking();
    for (const s of scored()) updateNumbers(s);
  }

  function onChange(ev) {
    const t = ev.target;
    const cfg = t.dataset && t.dataset.cfg;
    if (cfg) {
      if (A) A.setCfg('productos', { [cfg]: t.type === 'checkbox' ? t.checked : Number(t.value) });
      return;
    }
    if (t.tagName === 'SELECT' && t.dataset.k) {
      state.items[Number(t.dataset.i)][t.dataset.k] = Number(t.value);
      save();
      renderRanking();
      for (const s of scored()) updateNumbers(s);
    } else if (t.dataset.k && t.dataset.k !== 'nombre') {
      const v = U.parseMoney(t.value);
      t.value = v ? U.int(v) : '';
    }
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    const i = Number(t.dataset.i);
    switch (t.dataset.act) {
      case 'agregar':
        state.items.push({ id: 'p' + Date.now().toString(36), nombre: 'Producto nuevo', busqueda: '', custom: true, precio: null, costo: null, envioExtra: 0, demanda: 3, competencia: 3, afinidad: 3, video: 3, riesgo: 3, refMin: null, refMax: null, nota: '' });
        save();
        renderAll();
        break;
      case 'quitar': {
        const [fuera] = state.items.splice(i, 1);
        if (fuera && state.inv.has(W.docId(fuera.id))) {
          state.inv.delete(W.docId(fuera.id));
          Store.remove('investigacion/' + W.docId(fuera.id)).catch(() => {});
        }
        save();
        renderAll();
        break;
      }
      case 'ia':
        askIA();
        break;
      case 'ia-stop':
        if (ctl) ctl.abort();
        break;
      case 'aplicar': {
        const p = state.items[i];
        const x = state.ia.data.find((s) => norm(s.nombre) === norm(p.nombre));
        if (!x) return;
        for (const k of ['demanda', 'competencia', 'afinidad', 'video', 'riesgo']) p[k] = x[k];
        if (!p.precio && x.precio_sugerido) p.precio = U.parseMoney(x.precio_sugerido);
        save();
        renderAll();
        toast('Puntajes aplicados.', 'good');
        break;
      }
      case 'medir':
        correr('productos');
        break;
      case 'descubrir':
        correr('descubrir');
        break;
      case 'medir-stop':
      case 'desc-stop':
        if (A) A.stop();
        break;
      case 'desc-agregar':
        agregarDescubierto(Number(t.dataset.n));
        break;
    }
  }

  /* ---------- Tareas automáticas ---------- */

  function cortarSiCancelo(ctx) {
    if (ctx.signal.aborted) {
      const err = new Error('Cancelado.');
      err.code = 'cancelled';
      throw err;
    }
  }

  // Error de un paso: si es `fatal`, corta toda la tanda; si no, se anota y se sigue con el próximo
  function falla(msg, fatal) {
    const err = new Error(msg);
    err.fatal = !!fatal;
    return err;
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
            ? 'Se llenó el espacio del panel. Borrá datos viejos para seguir guardando.'
            : 'No se pudo guardar la medición. Revisá la conexión y probá de nuevo.'
      );
    }
  }

  // La lista más nueva: la de la pestaña si ya cargó (tiene lo último que tipeaste), si no la guardada
  async function listaActual() {
    if (state.cargado) return { items: state.items, cpa: state.cpa };
    const d = await Store.get('productos/lista').catch(() => null);
    return { items: W.unirLista(d, PR.CANDIDATOS), cpa: d && d.cpa != null ? d.cpa : null };
  }

  /* Lee una búsqueda de Mercado Libre con el navegador y la pasa por Claude: {publicaciones, resultados, senales} */
  async function leerBusqueda(ctx, q, nombre) {
    let texto;
    try {
      texto = await Browser.read(PR.mlUrl(q), { ready: R.mlReady, tries: 3 });
    } catch (err) {
      throw falla(Browser.errorText(err), Browser.fatal(err));
    }
    cortarSiCancelo(ctx);
    if (W.sinResultados(texto)) return { publicaciones: [], resultados: 0, senales: R.mlSignals([], 0) };
    const compacto = R.compactText(texto, 30000);
    if (!compacto) throw falla('La página de Mercado Libre vino vacía.');
    if (!AI.sample) throw falla('Claude no está disponible en esta vista.', true);
    let data;
    try {
      data = await AI.sample.json(W.mlExtractPrompt(compacto, nombre), { signal: ctx.signal, cache: false });
    } catch (err) {
      if (err && err.code === 'cancelled') throw err;
      if (AI.permanent(err)) {
        AI.sample = null;
        throw falla(AI.errorText(err), true);
      }
      throw falla(AI.errorText(err));
    }
    const L = W.sanitizeListings(data);
    const resultados = L.resultados != null ? L.resultados : R.mlResultCount(texto);
    if (!L.publicaciones.length && resultados !== 0) throw falla('No encontré publicaciones en la página: puede que Mercado Libre no haya terminado de cargar.');
    return { publicaciones: L.publicaciones, resultados, senales: R.mlSignals(L.publicaciones, resultados) };
  }

  function detalleSenales(s) {
    const v = W.veredicto(s.vende);
    return [
      v ? v.label : '',
      s.vendidosVisibles != null ? '+' + U.int(s.vendidosVisibles) + ' vendidos visibles' : s.opiniones != null ? U.int(s.opiniones) + ' opiniones' : '',
      s.resultados != null ? U.int(s.resultados) + ' resultados' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function omitirResto(items, i) {
    for (const it of items.slice(i + 1)) {
      it.estado = 'omitida';
      it.detalle = '';
    }
  }

  // Si la tanda se cortó, lo que quedaba pendiente no se leyó
  function cerrarLog(log) {
    for (const it of log) if (it.estado === 'leyendo' || it.estado === 'espera') it.estado = 'omitida';
  }

  function refrescarMedir() {
    if (el) renderAutoProg();
  }

  function refrescarDesc() {
    if (el) renderDescProg();
  }

  // Una sola escritura de 'productos/lista' con lo medido, sin tocar precio, costo ni envío extra
  async function escribirMediciones(medidos) {
    let items;
    let cpaGuardado;
    if (state.cargado) {
      items = state.items;
      cpaGuardado = state.cpa;
    } else {
      const d = await Store.get('productos/lista').catch(() => null);
      items = W.unirLista(d, PR.CANDIDATOS);
      cpaGuardado = d && d.cpa != null ? d.cpa : null;
    }
    for (const m of medidos) {
      const p = items.find((x) => x.id === m.id);
      if (p) Object.assign(p, W.camposMedicion(m.doc));
    }
    await guardar('productos/lista', JSON.parse(JSON.stringify({ items, cpa: cpaGuardado })));
  }

  /*
   * Mide en Mercado Libre los productos de la lista (hasta 10): abre cada búsqueda con el navegador de Claude,
   * extrae las publicaciones con Claude y guarda las señales de venta. Funciona aunque la pestaña no esté abierta.
   */
  async function medir(ctx) {
    const { items } = await listaActual();
    const elegidos = W.elegirParaMedir(items, W.MAX_MEDIR);
    if (!elegidos.length) throw new Error('No hay productos para medir: agregá alguno con su búsqueda.');
    const fecha = new Date().toISOString();
    const log = elegidos.map((p) => ({ q: p.nombre, estado: 'espera', detalle: '' }));
    vivo.medir = log;
    refrescarMedir();
    const medidos = [];
    let fallo = null;
    try {
      for (let i = 0; i < elegidos.length; i++) {
        const p = elegidos[i];
        const it = log[i];
        cortarSiCancelo(ctx);
        it.estado = 'leyendo';
        ctx.progress(W.progreso(i, elegidos.length, p.nombre));
        refrescarMedir();
        let r;
        try {
          r = await leerBusqueda(ctx, p.busqueda || p.nombre, p.nombre);
        } catch (err) {
          if (err && err.code === 'cancelled') throw err;
          it.estado = 'error';
          it.detalle = err.message;
          if (err.fatal) {
            omitirResto(log, i);
            refrescarMedir();
            throw new Error(err.message);
          }
          refrescarMedir();
          continue;
        }
        const doc = W.investigacionDoc({ fecha, busqueda: p.busqueda || p.nombre, resultados: r.resultados, publicaciones: r.publicaciones, senales: r.senales });
        await guardar('investigacion/' + W.docId(p.id), doc);
        state.inv.set(W.docId(p.id), doc);
        medidos.push({ id: p.id, nombre: p.nombre, senales: r.senales, doc });
        it.estado = 'ok';
        it.detalle = detalleSenales(r.senales);
        refrescarMedir();
      }
    } catch (err) {
      fallo = err;
      cerrarLog(log);
      refrescarMedir();
    }
    // Lo que se llegó a medir queda guardado aunque se corte la tanda
    if (medidos.length) {
      try {
        await escribirMediciones(medidos);
      } catch (err) {
        if (!fallo) fallo = err;
      }
    }
    if (el) renderAll();
    if (fallo) throw fallo;
    if (!medidos.length) throw new Error((log.find((x) => x.detalle) || {}).detalle || 'No se pudo medir ningún producto en Mercado Libre.');
    return {
      novedades: medidos.length,
      medidos: medidos.length,
      errores: log.filter((x) => x.estado === 'error').length,
      resumen: W.resumenMedicion(medidos),
    };
  }

  /* Claude elige qué páginas de Mercado Libre leer (con la herramienta leer_pagina). null: no se pudo, usar las búsquedas fijas. */
  async function descubrirConClaude(ctx, semillas, items) {
    const sub = new AbortController();
    const cortar = () => sub.abort();
    ctx.signal.addEventListener('abort', cortar);
    let lecturas = 0;
    let leidas = 0;
    let fatal = null;
    // Claude puede pedir varias páginas a la vez: el navegador las abre de a una
    let cola = Promise.resolve();
    const turno = (fn) => {
      const p = cola.then(fn);
      cola = p.catch(() => {});
      return p;
    };
    const herramienta = {
      name: 'leer_pagina',
      description:
        'Abre una página pública de Mercado Libre Argentina en el navegador del usuario y devuelve su texto (hasta 12.000 caracteres). Solo acepta URLs https de listado.mercadolibre.com.ar, www.mercadolibre.com.ar o articulo.mercadolibre.com.ar. Máximo ' +
        W.MAX_LECTURAS +
        ' lecturas en total.',
      inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'URL completa, por ejemplo https://listado.mercadolibre.com.ar/almohada-cervical' } }, required: ['url'] },
      execute: (input) =>
        turno(async () => {
          if (sub.signal.aborted) throw new Error('Cancelado.');
          const url = W.urlML(input && input.url);
          if (!url) throw new Error('Solo puedo abrir páginas https de listado.mercadolibre.com.ar, www.mercadolibre.com.ar o articulo.mercadolibre.com.ar.');
          if (lecturas >= W.MAX_LECTURAS) throw new Error('Sin más lecturas: ya se usaron las ' + W.MAX_LECTURAS + '. Respondé con lo que viste.');
          lecturas++;
          const it = { q: W.urlCorta(url), estado: 'leyendo', detalle: '' };
          vivo.desc.push(it);
          ctx.progress('Página ' + lecturas + ' de ' + W.MAX_LECTURAS + ' · ' + it.q);
          refrescarDesc();
          try {
            const texto = await Browser.read(url, { ready: R.mlReady, tries: 3 });
            leidas++;
            it.estado = 'ok';
            return R.compactText(texto, 12000) || '(La página vino vacía.)';
          } catch (err) {
            it.estado = 'error';
            it.detalle = Browser.errorText(err);
            if (Browser.fatal(err)) {
              fatal = err;
              sub.abort();
            }
            throw new Error(Browser.errorText(err));
          } finally {
            refrescarDesc();
          }
        }),
    };
    ctx.progress('Claude elige qué buscar en Mercado Libre…');
    let data;
    try {
      data = await AI.sample.json(W.discoverPrompt(semillas, items.map((p) => p.nombre)), { signal: sub.signal, tools: [herramienta] });
    } catch (err) {
      if (fatal) throw new Error(Browser.errorText(fatal));
      if (err && err.code === 'cancelled') throw err;
      if (err && err.code === 'tools_unavailable') return null;
      if (AI.permanent(err)) AI.sample = null;
      throw new Error(AI.errorText(err));
    } finally {
      ctx.signal.removeEventListener('abort', cortar);
    }
    // Sin páginas leídas no hay evidencia: mejor medir las búsquedas de partida
    if (!leidas) return null;
    return { modo: 'claude', paginas: leidas, productos: W.sanitizeDiscover(data, items, 5) };
  }

  /* Versión fija: mide cada búsqueda de partida que no esté en la lista y las ordena por señales de venta. */
  async function descubrirConBusquedas(ctx, semillas) {
    if (!semillas.length) throw new Error('Ya tenés en tu lista todos los productos que sé buscar. Sumá otros con “Agregar producto”.');
    const log = semillas.map((s) => ({ q: s.q, estado: 'espera', detalle: '' }));
    vivo.desc = log;
    refrescarDesc();
    const productos = [];
    let leidas = 0;
    for (let i = 0; i < semillas.length; i++) {
      const s = semillas[i];
      const it = log[i];
      cortarSiCancelo(ctx);
      it.estado = 'leyendo';
      ctx.progress(W.progreso(i, semillas.length, s.q));
      refrescarDesc();
      let r;
      try {
        r = await leerBusqueda(ctx, s.q, s.q);
      } catch (err) {
        if (err && err.code === 'cancelled') throw err;
        it.estado = 'error';
        it.detalle = err.message;
        if (err.fatal) {
          omitirResto(log, i);
          refrescarDesc();
          throw new Error(err.message);
        }
        refrescarDesc();
        continue;
      }
      leidas++;
      it.estado = 'ok';
      if (r.publicaciones.length) {
        productos.push(W.descubrimientoDesdeBusqueda(s, r.publicaciones, r.resultados, r.senales));
        it.detalle = detalleSenales(r.senales);
      } else it.detalle = 'sin publicaciones';
      refrescarDesc();
    }
    if (!leidas) throw new Error(log[0].detalle || 'No se pudo leer ninguna búsqueda.');
    return { modo: 'busquedas', paginas: leidas, productos: W.ordenarDescubrimientos(productos) };
  }

  async function descubrir(ctx) {
    const { items } = await listaActual();
    const semillas = W.semillasLibres(W.SEMILLAS, items);
    vivo.desc = [];
    refrescarDesc();
    let lim = null;
    try {
      lim = AI.sample && typeof AI.sample.limits === 'function' ? await AI.sample.limits() : null;
    } catch (err) {
      lim = null;
    }
    cortarSiCancelo(ctx);
    let res = lim && lim.tools ? await descubrirConClaude(ctx, semillas, items) : null;
    try {
      if (!res) {
        vivo.desc = [];
        res = await descubrirConBusquedas(ctx, semillas);
      }
    } catch (err) {
      cerrarLog(vivo.desc);
      refrescarDesc();
      throw err;
    }
    const doc = { fecha: new Date().toISOString(), modo: res.modo, productos: res.productos };
    await guardar('investigacion/descubrir', doc);
    state.desc = doc;
    if (el) renderDescList();
    return {
      novedades: res.productos.length,
      encontrados: res.productos.length,
      paginas: res.paginas,
      resumen: W.resumenDescubrir(res.productos),
    };
  }

  if (A) {
    A.NOMBRES.descubrir = 'búsqueda de productos nuevos';
    A.register('productos', { needs: ['browser', 'sample'], run: medir });
    A.register('descubrir', { needs: ['browser', 'sample'], run: descubrir });
  }

  VC.tools = VC.tools || {};
  VC.tools.productos = { mount, render: renderAll };
})(window);
