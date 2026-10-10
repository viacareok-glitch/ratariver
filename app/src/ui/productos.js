/* Productos: qué vender junto al corrector */
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
  const { e, $, $$, App, chip, banner, toast, storeFail, icon, bubble, pageHead, info, more, toggle } = VC.ui;
  const A = VC.auto;

  const ESCALAS = [
    ['demanda', 'Demanda'],
    ['competencia', 'Competencia (5 = mucha)'],
    ['afinidad', 'Afinidad con tu cliente'],
    ['video', 'Se luce en video'],
    ['riesgo', 'Riesgo (5 = alto)'],
  ];
  const CADA = [24, 72, 168];
  const CANCELADO = 'Cancelado.';

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
      pageHead('Productos', 'Qué vender junto al corrector.', '<button class="btn ghost" data-act="agregar">' + icon('plus') + 'Agregar producto</button>') +
      '<div id="pr-warn"></div>' +
      '<section class="panel auto-panel pr-auto" id="pr-auto" aria-labelledby="pr-auto-title"></section>' +
      '<section class="panel pr-rank"><div class="panel-head"><div class="panel-title">' +
      bubble('trending', 'good') +
      '<h3>Ranking</h3>' +
      info(
        'Puntaje de 0 a 100: margen ' +
          PR.PESOS.margen +
          ' %, demanda ' +
          PR.PESOS.demanda +
          ' %, competencia ' +
          PR.PESOS.competencia +
          ' %, afinidad ' +
          PR.PESOS.afinidad +
          ' %, video ' +
          PR.PESOS.video +
          ' % y riesgo ' +
          PR.PESOS.riesgo +
          ' %. Sin precio y costo, el margen no cuenta.<br><br>“Publicidad por pedido” es lo que calculás pagar en anuncios por cada venta del producto nuevo. Los precios de referencia salen de Mercado Libre (relevados en ' +
          e(PR.REF_FECHA) +
          ' o de tu última medición).'
      ) +
      '</div><div id="pr-params"></div></div><div id="pr-ranking"></div></section>' +
      '<section class="panel pr-ia" id="pr-ia"></section>' +
      '<div id="pr-list" class="pr-list"></div>';
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

  // ¿Estás escribiendo o eligiendo algo en este bloque? Entonces no se redibuja entero
  function editando(box) {
    const a = document.activeElement;
    return !!(a && box && box.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }

  function renderAll() {
    if (!el) return;
    renderAuto();
    $('#pr-warn', el).innerHTML = P.costsReady(App.cfg)
      ? ''
      : banner('warn', '<strong>Faltan tus costos.</strong> Sin envío y devolución no se puede calcular cuánto deja cada producto.', '<button class="btn" data-goto="ajustes">Cargar costos</button>');
    const pb = $('#pr-params', el);
    if (!editando(pb)) {
      pb.innerHTML = '<label class="pr-cpa" for="pr-cpa">Publicidad por pedido<span class="input-unit"><span class="unit">$</span><input id="pr-cpa" inputmode="numeric" value="' + e(U.int(cpa())) + '"></span></label>';
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
    $('#pr-ranking', el).innerHTML =
      '<ol class="pr-rk">' +
      list
        .map((s, i) => {
          const v = W.veredicto(s.p.vende);
          return (
            '<li><span class="pr-rk-pos">' +
            (i + 1) +
            '</span><span class="pr-rk-name"><button type="button" class="pr-rk-go" data-act="ver" data-id="' +
            e(s.p.id) +
            '">' +
            e(s.p.nombre) +
            '</button>' +
            (v ? chip(v.label, v.tone) : '') +
            (s.completo ? '' : '<span class="pr-rk-miss">sin precio</span>') +
            '</span><span class="wf-track"><span class="wf-bar ' +
            (i === 0 && s.completo ? 'pos' : 'base') +
            '" style="width:' +
            Math.max(2, s.puntaje) +
            '%"></span></span><span class="pr-rk-val">' +
            s.puntaje +
            '</span></li>'
          );
        })
        .join('') +
      '</ol>';
  }

  function refText(p) {
    return p.refMin ? 'Mercado Libre: ' + U.money(p.refMin) + ' a ' + U.money(p.refMax) : 'Sin precio de referencia';
  }

  function renderList() {
    const box = $('#pr-list', el);
    if (editando(box)) {
      // Solo actualiza los números para no perder el foco mientras escribís
      for (const s of scored()) updateNumbers(s);
      return;
    }
    // Conserva abiertos los plegables al redibujar
    const abiertos = $$('details[open]', box)
      .map((d) => d.id)
      .filter(Boolean);
    box.innerHTML = scored()
      .map((s, i) => card(s, i))
      .join('');
    for (const id of abiertos) {
      const d = box.querySelector('#' + CSS.escape(id));
      if (d) d.open = true;
    }
  }

  function card(s, i) {
    const p = s.p;
    const sug = state.ia.data && state.ia.data.find((x) => norm(x.nombre) === norm(p.nombre));
    const inv = state.inv.get(W.docId(p.id));
    return (
      '<article class="pr-card" id="pc-' +
      e(p.id) +
      '"><header class="pr-card-head"><div class="pr-card-title"><h4><span data-out="nombre">' +
      e(p.nombre) +
      '</span>' +
      (p.nota ? info(e(p.nota)) : '') +
      '</h4><p class="pr-ref" data-out="ref">' +
      e(refText(p)) +
      '</p></div><div class="pr-score" title="Puntaje de 0 a 100"><span class="pr-score-num" data-out="puntaje">' +
      s.puntaje +
      '</span><span class="pr-score-lbl">puntos</span></div></header>' +
      '<div class="pr-ml" data-out="ml" data-v="' +
      e(inv ? inv.fecha : '') +
      '"' +
      (inv || Browser.available ? '' : ' hidden') +
      '>' +
      mlInner(p) +
      '</div><div class="pr-inputs">' +
      (p.custom ? fld(i, 'nombre', 'Nombre', p.nombre, true, 'pr-name') : '') +
      fld(i, 'precio', 'Precio de venta', p.precio) +
      fld(i, 'costo', 'Costo', p.costo) +
      '</div><div class="pr-nums">' +
      num(
        'Por pedido',
        'anuncios',
        s.eco ? U.money(s.eco.conAnuncios) : '—',
        s.eco ? (s.eco.conAnuncios >= 0 ? 'pos' : 'neg') : '',
        info('<strong>Por pedido:</strong> lo que queda por cada pedido que entra por anuncios, con tus anulados y devoluciones. “A un cliente” es venderle por WhatsApp a alguien que ya te compró, sin publicidad.')
      ) +
      num('A un cliente', 'cliente', s.eco ? U.money(s.eco.aCliente) : '—') +
      num('Precio ÷ costo', 'markup', s.eco ? s.eco.markup.toFixed(1).replace('.', ',') + '×' : '—') +
      '</div>' +
      (sug ? suggestion(sug, i) : '') +
      more('Puntajes y más', masInner(p, i), 'pcm-' + p.id) +
      '</article>'
    );
  }

  function num(label, k, val, cls, extra) {
    return '<div><span class="pr-num-lbl">' + e(label) + (extra || '') + '</span><span class="pr-num mono' + (cls ? ' ' + cls : '') + '" data-out="' + k + '">' + e(val) + '</span></div>';
  }

  function masInner(p, i) {
    const q = p.busqueda || p.nombre;
    return (
      '<div class="pr-more"><div class="pr-scales">' +
      ESCALAS.map(
        ([k, label]) =>
          '<label for="pr-' +
          i +
          '-' +
          k +
          '">' +
          e(label) +
          '<select id="pr-' +
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
      fld(i, 'envioExtra', 'Envío extra', p.envioExtra) +
      '</div><div class="pr-links"><a class="btn link" href="' +
      e(PR.mlUrl(q)) +
      '" target="_blank" rel="noopener">Mercado Libre' +
      icon('external') +
      '</a><a class="btn link" href="' +
      e(PR.trendsUrl(q)) +
      '" target="_blank" rel="noopener">Google Trends' +
      icon('external') +
      '</a><a class="btn link" href="' +
      e(CP.adLibraryUrl(q)) +
      '" target="_blank" rel="noopener">Anuncios' +
      icon('external') +
      '</a>' +
      (p.custom ? '<button class="btn link pr-quitar" data-act="quitar" data-i="' + i + '">' + icon('trash') + 'Quitar</button>' : '') +
      '</div></div>'
    );
  }

  function updateNumbers(s) {
    const card = el.querySelector('#pc-' + CSS.escape(s.p.id));
    if (!card) return;
    const set = (k, v) => {
      const n = card.querySelector('[data-out="' + k + '"]');
      if (n) n.textContent = v;
      return n;
    };
    set('puntaje', s.puntaje);
    const an = set('anuncios', s.eco ? U.money(s.eco.conAnuncios) : '—');
    if (an) {
      an.classList.toggle('pos', !!s.eco && s.eco.conAnuncios >= 0);
      an.classList.toggle('neg', !!s.eco && s.eco.conAnuncios < 0);
    }
    set('cliente', s.eco ? U.money(s.eco.aCliente) : '—');
    set('markup', s.eco ? s.eco.markup.toFixed(1).replace('.', ',') + '×' : '—');
    set('nombre', s.p.nombre);
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

  /* Bloque "Mercado Libre · hace X" de una tarjeta */
  function mlInner(p) {
    const inv = state.inv.get(W.docId(p.id));
    if (!inv || !inv.senales) return Browser.available ? '<p class="pr-ml-none">' + icon('search') + 'Todavía sin medir en Mercado Libre</p>' : '';
    const s = inv.senales;
    const v = W.veredicto(s.vende);
    const facts = [];
    if (s.vendidosVisibles != null) facts.push(fact('+' + U.int(s.vendidosVisibles), 'vendidos'));
    if (s.opiniones != null) facts.push(fact(U.int(s.opiniones), 'opiniones'));
    if (s.masVendidos) facts.push(fact(s.masVendidos, '“Más vendido”'));
    if (s.resultados != null) facts.push(fact(U.int(s.resultados), s.resultados === 1 ? 'resultado' : 'resultados'));
    if (s.precioMediana != null) facts.push(fact(U.money(s.precioMediana), 'precio típico'));
    const pubs = Array.isArray(inv.publicaciones) ? inv.publicaciones : [];
    return (
      '<div class="pr-ml-head"><span class="pr-ml-src">Mercado Libre · ' +
      e(U.timeAgo(inv.fecha)) +
      '</span>' +
      (v ? chip(v.label, v.tone) : '') +
      '</div><ul class="pr-facts">' +
      facts.join('') +
      '</ul>' +
      (pubs.length
        ? more(
            'Ver publicaciones (' + pubs.length + ')',
            '<ol class="pr-pubs">' + pubs.map(pubItem).join('') + '</ol><p class="note">Los vendidos son redondeados y de toda la vida de la publicación: son una señal, no ventas exactas.</p>',
            'pcp-' + p.id
          )
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

  function fld(i, k, label, v, text, cls) {
    const id = 'pr-' + i + '-' + k;
    const input = '<input id="' + id + '" data-i="' + i + '" data-k="' + k + '"' + (text ? '' : ' inputmode="numeric" placeholder="0"') + ' value="' + e(text ? v || '' : v ? U.int(v) : '') + '">';
    return '<label class="pr-fld' + (cls ? ' ' + cls : '') + '" for="' + id + '">' + e(label) + (text ? input : '<span class="input-unit"><span class="unit">$</span>' + input + '</span>') + '</label>';
  }

  function suggestion(x, i) {
    return (
      '<div class="pr-sug"><div class="pr-sug-head"><span class="eyebrow">Claude sugiere</span><button class="btn soft sm" data-act="aplicar" data-i="' +
      i +
      '">Usar estos puntajes</button></div><p>Demanda ' +
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
      (x.angulo ? '<p><strong>Ángulo:</strong> ' + e(x.angulo) + '</p>' : '') +
      (x.combo ? '<p><strong>Combo:</strong> ' + e(x.combo) + '</p>' : '') +
      (x.dudas ? '<p class="muted">' + e(x.dudas) + '</p>' : '') +
      '</div>'
    );
  }

  function norm(s) {
    return U.stripAccents(String(s || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function renderIA() {
    const box = $('#pr-ia', el);
    const I = state.ia;
    const meta = !AI.sample ? 'Necesita Claude.' : I.running ? 'Pensando… puede tardar un minuto.' : I.data ? 'Sus puntajes están en cada producto.' : 'Estima puntajes, precio y ángulo de cada uno.';
    const accion = !AI.sample
      ? ''
      : I.running
        ? '<button class="btn ghost" data-act="ia-stop">' + icon('stop') + 'Detener</button>'
        : '<button class="btn soft" data-act="ia">' + icon('sparkles') + (I.data ? 'Preguntar de nuevo' : 'Pedir opinión') + '</button>';
    box.innerHTML =
      '<div class="pr-row">' +
      bubble('sparkles', 'source') +
      '<div class="pr-row-txt"><div class="pr-row-title"><h3>Opinión de Claude</h3>' +
      info(
        AI.sample
          ? 'Claude estima demanda, competencia y afinidad de cada producto y te sugiere precio, ángulo y combo. No entra a internet: confirmá en Mercado Libre antes de comprar stock.'
          : 'Abrí el panel desde claude.ai o la app de Claude para pedirle su opinión.'
      ) +
      '</div><p class="pr-row-meta">' +
      e(meta) +
      '</p></div>' +
      (accion ? '<div class="row-actions">' + accion + '</div>' : '') +
      '</div>' +
      (I.reco && !I.running ? '<p class="pr-reco">' + e(I.reco) + '</p>' : '') +
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
      box.innerHTML = '<div id="pr-auto-head"></div><div id="pr-auto-prog"></div><div id="pr-desc-prog"></div><div id="pr-desc-list"></div>' + (A ? more('Opciones', '<div id="pr-auto-cfg"></div>', 'pr-auto-more') : '');
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

  function nota(ic, html) {
    return '<p class="note">' + icon(ic) + html + '</p>';
  }

  function renderAutoHead() {
    const box = el && $('#pr-auto-head', el);
    if (!box) return;
    const titulo =
      '<div class="pr-row-title"><h3 id="pr-auto-title">Buscar ganadores</h3>' +
      info(
        'Abre en el navegador de Claude la búsqueda de Mercado Libre de cada producto, lee las publicaciones y anota las señales de venta: vendidos, opiniones, el sello MÁS VENDIDO y cuántos compiten. Con eso ajusta demanda, competencia y precios.<br><br>“Descubrir productos” busca productos nuevos para el mismo cliente del corrector que ya muestran ventas.'
      ) +
      '</div>';
    if (!A) {
      box.innerHTML = '<div class="pr-auto-row">' + bubble('zap', 'peach') + '<div class="pr-auto-txt">' + titulo + '<p class="pr-auto-meta">No cargó. Recargá el panel.</p></div></div>';
      return;
    }
    const c = A.cfg.productos || A.DEFAULTS.productos;
    const midiendo = A.running === 'productos';
    const buscando = A.running === 'descubrir';
    const chk = A.can('productos');
    const chkD = A.can('descubrir');
    const est = A.estado.productos || {};
    const estD = A.estado.descubrir || {};
    const ult = A.ultima('productos');
    const meta = midiendo ? 'Midiendo en Mercado Libre…' : buscando ? 'Buscando productos nuevos…' : ult ? 'Última medición ' + U.timeAgo(ult) : 'Todavía no mediste';

    let acciones = '';
    if (Browser.available) {
      acciones =
        (midiendo
          ? '<button class="btn ghost" data-act="medir-stop">' + icon('stop') + 'Detener</button>'
          : '<button class="btn" data-act="medir"' + (!chk.ok || pedido.productos ? ' disabled' : '') + '>' + icon('search') + (pedido.productos ? 'En cola…' : 'Medir en Mercado Libre') + '</button>') +
        (buscando
          ? '<button class="btn ghost" data-act="desc-stop">' + icon('stop') + 'Detener</button>'
          : '<button class="btn ghost" data-act="descubrir"' + (!chkD.ok || pedido.descubrir ? ' disabled' : '') + '>' + icon('sparkles') + (pedido.descubrir ? 'En cola…' : 'Descubrir productos') + '</button>');
    }

    const notas = [];
    if (!Browser.checked) notas.push(nota('clock', 'Revisando si el navegador de Claude está disponible…'));
    else if (!Browser.available)
      notas.push(
        nota(
          'alert',
          'Necesita la app de escritorio de Claude.' +
            info('La medición usa el navegador de Claude en tu PC: abrí este panel desde la app de escritorio de Claude, en una sesión de Cowork. Ahí abre la búsqueda de cada producto en Mercado Libre y anota las señales de venta. Mientras tanto, cargá los puntajes a mano en cada producto.')
        )
      );
    else if (!chk.ok) notas.push(nota('alert', e(chk.motivo)));
    else if (!chkD.ok) notas.push(nota('alert', e(chkD.motivo)));
    const otra = A.running && !midiendo && !buscando ? A.NOMBRES[A.running] || A.running : '';
    for (const [job, que] of [
      ['productos', 'La medición'],
      ['descubrir', 'La búsqueda'],
    ]) {
      if (pedido[job] && A.running && A.running !== job) notas.push(nota('clock', 'En cola: ' + que.toLowerCase() + ' arranca cuando termine la ' + e(A.NOMBRES[A.running] || A.running) + '.'));
    }
    if (otra && !pedido.productos && !pedido.descubrir) notas.push(nota('clock', 'Ahora corre la ' + e(otra) + '. Si tocás un botón, queda en cola.'));
    if (!midiendo && est.error === CANCELADO) notas.push(nota('stop', 'Cancelaste la última medición.'));
    else if (!midiendo && est.error) notas.push('<p class="error-text">La última medición no terminó: ' + e(est.error) + '</p>');
    else if (!midiendo && est.resultado && est.resultado.resumen) notas.push(nota('check', e(est.resultado.resumen) + '.'));
    if (!buscando && estD.error === CANCELADO) notas.push(nota('stop', 'Cancelaste la última búsqueda.'));
    else if (!buscando && estD.error) notas.push('<p class="error-text">La última búsqueda no terminó: ' + e(estD.error) + '</p>');

    box.innerHTML =
      '<div class="pr-auto-row">' +
      bubble('zap', 'peach') +
      '<div class="pr-auto-txt">' +
      titulo +
      '<p class="pr-auto-meta"><span>' +
      e(meta) +
      '</span>' +
      (c.auto ? chip('Solo cada ' + diasTxt(c.cadaHoras), 'good') : '') +
      '</p></div>' +
      (acciones ? '<div class="row-actions pr-auto-actions">' + acciones + '</div>' : '') +
      '</div>' +
      (notas.length ? '<div class="pr-auto-notes">' + notas.join('') + '</div>' : '');
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
      '<div class="pr-prog"><ul class="auto-progress">' +
      items
        .map((it) => {
          const st = ST[it.estado] || ST.espera;
          return '<li class="is-' + e(it.estado) + '"><span class="st' + (st[1] ? ' ' + st[1] : '') + '">' + e(st[0]) + '</span><span>' + e(it.q) + (it.detalle ? ' <span class="muted">· ' + e(it.detalle) + '</span>' : '') + '</span></li>';
        })
        .join('') +
      '</ul>' +
      (texto ? '<p class="note" aria-live="polite">' + e(texto) + '</p>' : '') +
      '</div>'
    );
  }

  function renderAutoProg() {
    const box = el && $('#pr-auto-prog', el);
    if (!box || !A) return;
    const corriendo = A.running === 'productos';
    const est = A.estado.productos || {};
    box.innerHTML = vivo.medir.length && (corriendo || (est.error && est.error !== CANCELADO)) ? progList(vivo.medir, corriendo ? A.progress.productos : '') : '';
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
      '<div class="pr-auto-cfg"><div class="pr-auto-when">' +
      toggle('pr-auto-solo', !!c.auto, 'Medir solo al abrir el panel', 'data-cfg="auto"' + dis) +
      '<label class="pr-cada">Cada<select data-cfg="cadaHoras" aria-label="Cada cuántos días"' +
      dis +
      '>' +
      horas.map((h) => '<option value="' + h + '"' + (Number(c.cadaHoras) === h ? ' selected' : '') + '>' + e(diasTxt(h)) + '</option>').join('') +
      '</select></label></div>' +
      nota('info', 'Los vendidos de Mercado Libre son redondeados y de toda la vida de la publicación: tomalos como señal, no como ventas exactas.') +
      '</div>';
    if (keep) {
      const opt = $('[data-cfg="' + keep + '"]', box);
      if (opt) opt.focus();
    }
  }

  function renderDesc() {
    renderDescProg();
    renderDescList();
  }

  function renderDescProg() {
    const box = el && $('#pr-desc-prog', el);
    if (!box || !A) return;
    const corriendo = A.running === 'descubrir';
    const est = A.estado.descubrir || {};
    if (corriendo && !vivo.desc.length) {
      box.innerHTML = '<p class="note" aria-live="polite">' + e(A.progress.descubrir || 'Empezando…') + '</p>';
      return;
    }
    box.innerHTML = vivo.desc.length && (corriendo || (est.error && est.error !== CANCELADO)) ? progList(vivo.desc, corriendo ? A.progress.descubrir : '') : '';
  }

  function renderDescList() {
    const box = el && $('#pr-desc-list', el);
    if (!box) return;
    const d = state.desc;
    if (!d) {
      box.innerHTML = '';
      return;
    }
    const prods = Array.isArray(d.productos) ? d.productos : [];
    box.innerHTML =
      '<div class="pr-desc"><div class="pr-desc-head"><h4>Productos nuevos</h4><span class="pr-desc-when">' +
      e(U.timeAgo(d.fecha)) +
      '</span>' +
      info(
        (d.modo === 'claude' ? 'Claude eligió qué páginas de Mercado Libre leer.' : 'Se midieron búsquedas de partida en Mercado Libre.') +
          ' Las señales salen de lo que muestran las publicaciones: no son ventas exactas.'
      ) +
      '</div>' +
      (prods.length ? '<ul class="pr-desc-list">' + prods.map(descCard).join('') + '</ul>' : '<p class="note">La última búsqueda no encontró productos nuevos con señales de venta claras.</p>') +
      '</div>';
  }

  function descCard(d, n) {
    const ya = W.yaEnLista(d.busqueda || d.nombre, state.items);
    const v = W.veredicto(d.senales ? d.senales.vende : W.vendeDesde(d));
    const facts = [];
    if (d.precioMin || d.precioMax) facts.push('<li><strong>' + e(d.precioMin && d.precioMax && d.precioMin !== d.precioMax ? U.money(d.precioMin) + ' a ' + U.money(d.precioMax) : U.money(d.precioMin || d.precioMax)) + '</strong></li>');
    if (d.vendidos != null) facts.push('<li><strong>' + e(W.fmtVendidos(d.vendidos)) + '</strong></li>');
    if (d.opiniones != null) facts.push('<li><strong>' + e(U.int(d.opiniones)) + '</strong> opiniones</li>');
    const extra = [d.evidencia ? '<strong>Evidencia:</strong> ' + e(d.evidencia) : '', d.video ? '<strong>En video:</strong> ' + e(d.video) : ''].filter(Boolean).join('<br><br>');
    return (
      '<li class="pr-desc-card"><div class="pr-desc-top"><strong class="pr-desc-name">' +
      e(d.nombre) +
      '</strong>' +
      (v ? chip(v.label, v.tone) : '') +
      '</div>' +
      (facts.length ? '<ul class="pr-facts">' + facts.join('') + '</ul>' : '') +
      (d.por_que ? '<p class="pr-desc-why">' + e(d.por_que) + '</p>' : '') +
      '<div class="pr-desc-actions">' +
      (ya ? chip('Ya está en tu lista', 'good') : '<button class="btn soft sm" data-act="desc-agregar" data-n="' + n + '">' + icon('plus') + 'Agregar</button>') +
      '<a class="btn link sm" href="' +
      e(PR.mlUrl(d.busqueda || d.nombre)) +
      '" target="_blank" rel="noopener">Mercado Libre' +
      icon('external') +
      '</a>' +
      (extra ? info(extra) : '') +
      '</div></li>'
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
      if (ev.type === 'start' || ev.type === 'done' || ev.type === 'error') renderAutoHead();
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
    A.run(job, { origen: 'manual' }).finally(() => {
      pedido[job] = false;
      if (el) renderAutoHead();
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

  function verTarjeta(id) {
    const c = el.querySelector('#pc-' + CSS.escape(id));
    if (!c) return;
    const quieto = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    c.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'center' });
    c.classList.add('is-flash');
    setTimeout(() => c.classList.remove('is-flash'), 1600);
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
      case 'agregar': {
        state.items.push({ id: 'p' + Date.now().toString(36), nombre: 'Producto nuevo', busqueda: '', custom: true, precio: null, costo: null, envioExtra: 0, demanda: 3, competencia: 3, afinidad: 3, video: 3, riesgo: 3, refMin: null, refMax: null, nota: '' });
        save();
        renderAll();
        const n = state.items.length - 1;
        verTarjeta(state.items[n].id);
        const inp = $('#pr-' + n + '-nombre', el);
        if (inp) {
          inp.focus({ preventScroll: true });
          inp.select();
        }
        break;
      }
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
      case 'ver':
        verTarjeta(t.dataset.id);
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
