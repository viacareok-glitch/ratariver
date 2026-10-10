/* Buscador del próximo producto */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const P = VC.profit;
  const PR = VC.products;
  const CP = VC.competitors;
  const { Store, Shop, AI } = VC.runtime;
  const { e, $, App, banner, toast, storeFail } = VC.ui;

  const ESCALAS = [
    ['demanda', 'Demanda', 'más es mejor'],
    ['competencia', 'Competencia', '5 = mucha'],
    ['afinidad', 'Afinidad con tu cliente', 'más es mejor'],
    ['video', 'Se luce en video', 'más es mejor'],
    ['riesgo', 'Riesgo (devoluciones, talles, fallas)', '5 = alto'],
  ];

  const state = {
    items: PR.CANDIDATOS.map((c) => Object.assign({ precio: null, costo: null }, c)),
    cpa: null,
    ia: { running: false, data: null, error: '' },
  };
  let el;
  let ctl;

  function mount(section) {
    el = section;
    el.innerHTML =
      '<header class="tool-head"><div><h2>Próximo producto</h2><p class="lede">Compará qué sumar al corrector. Cargá el precio al que lo venderías y lo que te cuesta: el panel calcula cuánto deja con tus tasas reales y lo puntúa por demanda, competencia y afinidad con tu cliente.</p></div>' +
      '<div class="tool-actions"><button class="btn ghost" data-act="agregar">Agregar producto</button></div></header>' +
      '<div id="pr-warn"></div><section class="panel" id="pr-params"></section><div id="pr-ranking"></div><section class="panel" id="pr-ia"></section><div id="pr-list" class="product-list"></div>';
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('click', onClick);
    App.on((w) => w === 'cfg' && renderAll());
    Store.get('productos/lista').then((d) => {
      if (d && Array.isArray(d.items) && d.items.length) {
        // Conserva lo que cargó el usuario y suma candidatos nuevos de la lista base
        const byId = new Map(d.items.map((x) => [x.id, x]));
        state.items = d.items.concat(PR.CANDIDATOS.filter((c) => !byId.has(c.id)).map((c) => Object.assign({ precio: null, costo: null }, c)));
        state.cpa = d.cpa == null ? null : d.cpa;
      }
      renderAll();
    });
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
    $('#pr-warn', el).innerHTML = P.costsReady(App.cfg) ? '' : banner('warn', 'Cargá en Ajustes el costo de envío y de devolución: se usan para calcular el margen de cualquier producto.', '<button class="btn ghost" data-goto="ajustes">Ir a Ajustes</button>');
    if (!$('#pr-params', el).contains(document.activeElement)) {
      $('#pr-params', el).innerHTML =
        '<div class="form-grid"><label for="pr-cpa">Costo en publicidad por pedido (estimado para el producto nuevo)<span class="input-unit"><span class="unit">$</span><input id="pr-cpa" inputmode="numeric" value="' +
        e(U.int(cpa())) +
        '"></span></label></div><p class="muted small">Precios de referencia: publicaciones de Mercado Libre Argentina (' +
        PR.REF_FECHA +
        '). Los puntajes vienen con una estimación inicial: ajustalos con lo que veas en Mercado Libre, Google Trends y la Biblioteca de anuncios.</p>';
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
        .map(
          (s, i) =>
            '<li><span class="rk-pos mono">' +
            (i + 1) +
            '</span><span class="rk-name">' +
            e(s.p.nombre) +
            (s.completo ? '' : ' <span class="muted small">(falta precio o costo)</span>') +
            '</span><span class="wf-track"><span class="wf-bar ' +
            (i === 0 && s.completo ? 'pos' : 'base') +
            '" style="width:' +
            Math.max(2, s.puntaje) +
            '%"></span></span><span class="wf-val mono">' +
            s.puntaje +
            '</span></li>'
        )
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
        return (
          '<article class="product-card" id="pc-' +
          e(p.id) +
          '"><header class="pc-head"><div><h4>' +
          e(p.nombre) +
          '</h4><p class="muted small">' +
          (p.refMin ? 'Mercado Libre: ' + e(U.money(p.refMin)) + ' a ' + e(U.money(p.refMax)) : 'Sin precio de referencia relevado') +
          '</p></div><div class="pc-score"><span class="stat-value" data-out="puntaje">' +
          s.puntaje +
          '</span><span class="stat-label">puntaje</span></div></header>' +
          (p.nota ? '<p class="small">' + e(p.nota) + '</p>' : '') +
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
      case 'quitar':
        state.items.splice(i, 1);
        save();
        renderAll();
        break;
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
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.productos = { mount, render: renderAll };
})(window);
