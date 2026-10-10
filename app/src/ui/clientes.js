/* Reactivador de clientes que ya pagaron */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const C = VC.customers;
  const OF = VC.offers;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, chip, waButton, emptyState, shopStatusBanner, toast, prefGet, prefSet, storeFail, icon, pageHead, info, more, seg } = VC.ui;

  const R_ESTADOS = {
    enviado: { label: 'Oferta enviada', tone: 'warn' },
    respondio: { label: 'Respondió', tone: 'info' },
    compro: { label: 'Compró', tone: 'good' },
    no: { label: 'No le interesa', tone: 'neutral' },
  };

  const state = {
    filtro: prefGet('cli-filtro', 'escribir'),
    cfg: Object.assign({}, C.DEFAULT_CFG),
    contactos: new Map(),
    elegida: {}, // wa → oferta elegida a mano
    verMsg: new Set(), // wa con el mensaje desplegado
    loading: false,
    error: null,
    codigo: { pct: 15, running: false, msg: '' },
  };
  let el;

  function mount(section) {
    el = section;
    el.innerHTML =
      pageHead(
        'Clientes',
        'Volvé a venderle a quien ya te compró.',
        '<button class="btn ghost icon-only" data-act="refrescar" aria-label="Actualizar pedidos" title="Actualizar">' + icon('refresh') + '</button>'
      ) +
      '<div id="cli-status"></div><div id="cli-summary"></div>' +
      '<section class="panel cli-ofertas-panel">' +
      more('Ofertas y mensajes', '<div id="cli-ofertas"></div>', 'cli-ofertas-more') +
      '</section><div id="cli-filters"></div><div id="cli-list" class="order-list"></div>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    // "toggle" no burbujea: se escucha en captura para recordar qué mensajes están abiertos
    el.addEventListener(
      'toggle',
      (ev) => {
        const d = ev.target;
        if (!d.classList || !d.classList.contains('cli-msg')) return;
        if (d.open) state.verMsg.add(d.dataset.wa);
        else state.verMsg.delete(d.dataset.wa);
      },
      true
    );
    Shop.onChange(render);
    App.on((w) => {
      if (w === 'cfg' || w === 'tienda') renderOfertas();
      if (w === 'resenas' || w === 'cfg' || w === 'msgs' || w === 'tienda') render();
    });
    Store.get('config/reactivar').then((d) => {
      if (d) state.cfg = Object.assign({}, C.DEFAULT_CFG, d, { mensajes: Object.assign({}, d.mensajes || {}) });
      renderOfertas();
      render();
    });
    Store.watch('reactivacion', (m) => {
      state.contactos = m;
      render();
    });
    renderOfertas();
    load();
  }

  async function load(fresh) {
    state.loading = true;
    state.error = null;
    render();
    try {
      await Shop.ensure(U.addDays(U.todayKeyAR(), -365), { fresh });
    } catch (err) {
      state.error = err;
    }
    state.loading = false;
    render();
  }

  const saveCfg = VC.ui.debounce(() => Store.set('config/reactivar', JSON.parse(JSON.stringify(state.cfg))).catch(storeFail), 700);

  function ofertaDe(c) {
    const ct = state.contactos.get(c.wa);
    return state.elegida[c.wa] || (ct && ct.oferta) || C.suggestOffer(c);
  }

  function lists() {
    const all = C.buildCustomers(Shop.orders, { minDias: Number(state.cfg.minDias) || 20, resenas: App.resenas });
    const now = Date.now();
    const pausa = (Number(state.cfg.pausaDias) || 30) * 24;
    for (const c of all) {
      const ct = state.contactos.get(c.wa);
      c.contacto = ct || null;
      c.volvio = ct ? C.reordered(c, ct.enviadoEn) : null;
      c.enPausa = ct && ct.enviadoEn && U.hoursSince(ct.enviadoEn, now) < pausa;
    }
    return {
      all,
      escribir: all.filter((c) => c.listo && !c.contacto),
      escritos: all.filter((c) => c.contacto && !c.volvio && c.contacto.estado !== 'compro'),
      volvieron: all.filter((c) => c.volvio || (c.contacto && c.contacto.estado === 'compro')),
    };
  }

  function render() {
    if (!el) return;
    const st = $('#cli-status', el);
    if (Shop.mode === 'none') st.innerHTML = shopStatusBanner({ message: 'Abrí el panel desde claude.ai para ver tus pedidos, o importá el CSV de Shopify.' });
    else st.innerHTML = state.error ? shopStatusBanner(state.error) : '';

    const L = lists();
    const loadingFirst = (state.loading || Shop.mode === 'pending') && !Shop.loadedAt;
    const recuperado = U.sum(L.volvieron, (c) => (c.volvio ? c.volvio.total : 0));
    const respondieron = L.all.filter((c) => c.contacto && ['respondio', 'compro'].includes(c.contacto.estado)).length;
    const escritos = L.escritos.length + L.volvieron.length;
    $('#cli-summary', el).innerHTML = loadingFirst
      ? '<div class="summary-strip is-loading">Cargando clientes…</div>'
      : '<div class="summary-strip">' +
        stat(L.escribir.length, 'para escribir', L.escribir.length ? 'warn' : '') +
        stat(escritos, respondieron ? 'escritos · ' + respondieron + (respondieron === 1 ? ' respondió' : ' respondieron') : 'escritos') +
        stat(L.volvieron.length, 'volvieron a comprar', L.volvieron.length ? 'good' : '') +
        stat(recuperado ? U.moneyShort(recuperado) : '—', 'vendido de nuevo') +
        '</div>';

    $('#cli-filters', el).innerHTML = seg(
      'cli-filtro',
      [
        { value: 'escribir', label: 'Para escribir', count: L.escribir.length },
        { value: 'escritos', label: 'Escritos', count: L.escritos.length },
        { value: 'volvieron', label: 'Volvieron', count: L.volvieron.length },
        { value: 'all', label: 'Todos', count: L.all.length },
      ],
      state.filtro
    );

    const list = L[state.filtro] || L.all;
    const box = $('#cli-list', el);
    if (loadingFirst) box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    else if (!list.length) box.innerHTML = emptyText(L);
    else box.innerHTML = list.map(card).join('');
  }

  function stat(v, label, tone) {
    return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><span class="stat-value">' + e(v) + '</span><span class="stat-label">' + e(label) + '</span></div>';
  }

  function emptyText(L) {
    const sinClientes = ['Sin clientes todavía', 'Aparecen cuando un pedido se entrega y se cobra.', 'users'];
    const m = {
      escribir: L.all.length ? ['Todo al día', 'Cada cliente aparece ' + (Number(state.cfg.minDias) || 20) + ' días después de su compra.', 'check'] : sinClientes,
      escritos: ['Sin ofertas enviadas', 'Todavía no le escribiste a ningún cliente.', 'send'],
      volvieron: ['Nadie volvió todavía', 'Cuando alguien vuelva a comprar, aparece acá solo.', 'gift'],
      all: sinClientes,
    }[state.filtro] || sinClientes;
    return emptyState(m[0], e(m[1]), '', m[2]);
  }

  function ofertaPills(c, actual) {
    const sugerida = C.suggestOffer(c);
    return (
      '<div class="seg cli-of" role="group" aria-label="Oferta para ' +
      e(c.nombre || 'el cliente') +
      '">' +
      Object.entries(C.OFERTAS)
        .map(
          ([k, o]) =>
            '<button type="button" class="seg-btn' +
            (k === actual ? ' is-on' : '') +
            '" aria-pressed="' +
            (k === actual) +
            '" data-act="elegir-oferta" data-key="' +
            e(c.wa) +
            '" data-value="' +
            k +
            '" title="' +
            e(o.label) +
            (k === sugerida ? ' (sugerida)' : '') +
            '">' +
            (k === sugerida ? icon('sparkles') : '') +
            e(o.corto || o.label) +
            (k === sugerida ? '<span class="sr-only"> (sugerida)</span>' : '') +
            '</button>'
        )
        .join('') +
      '</div>'
    );
  }

  function faltan(c) {
    const n = Math.max(1, (Number(state.cfg.minDias) || 20) - c.dias);
    return 'Escribile en ' + n + (n === 1 ? ' día' : ' días');
  }

  function card(c) {
    const of = ofertaDe(c);
    const ct = c.contacto;
    const msg = C.message(c, of, state.cfg, App.datos());
    const chips = [
      c.volvio ? chip('Volvió a comprar: ' + c.volvio.name, 'good') : ct && R_ESTADOS[ct.estado] ? chip(R_ESTADOS[ct.estado].label, R_ESTADOS[ct.estado].tone) : '',
      c.abierto ? chip('Pedido abierto', 'neutral') : '',
      !c.listo && !c.abierto && !ct ? chip(faltan(c), 'neutral') : '',
      c.resena ? chip('Reseña ' + (Number(c.resena.estrellas) || 5) + '/5', 'good') : '',
      c.compras > 1 ? chip(c.compras + ' compras', 'source') : '',
    ].join('');
    const meta = [c.ciudad, c.unidades + (c.unidades === 1 ? ' unidad' : ' unidades'), 'compró ' + U.timeAgo(c.ultimaCompra), ct && ct.enviadoEn ? 'escrito ' + U.timeAgo(ct.enviadoEn) : '']
      .filter(Boolean)
      .map(e)
      .join(' · ');
    const w = e(c.wa);
    return (
      '<article class="order-card cli-card' +
      (c.volvio ? ' is-good' : '') +
      (ct && !c.volvio ? ' has-decide' : '') +
      '"><div class="oc-top"><div class="oc-who"><strong>' +
      e(c.nombre || 'Sin nombre') +
      '</strong>' +
      (chips ? '<span class="chips">' + chips + '</span>' : '') +
      '</div><div class="oc-total" title="Total que te compró">' +
      e(U.money(c.gastado)) +
      '</div></div><div class="oc-meta muted small">' +
      meta +
      '</div>' +
      (!c.volvio
        ? '<div class="cli-offer"><span class="cli-offer-label">Oferta</span>' +
          ofertaPills(c, of) +
          '</div><details class="cli-msg" data-wa="' +
          w +
          '"' +
          (state.verMsg.has(c.wa) ? ' open' : '') +
          '><summary>' +
          icon('chevronRight') +
          'Ver mensaje</summary><p class="preview selectable">' +
          e(msg) +
          '</p></details>' +
          '<div class="oc-actions"><div class="row-actions">' +
          waButton(U.waLink(c.phone.wa, msg), ct ? 'Volver a escribir' : 'Enviar oferta', 'wa-oferta', c.wa, ct ? 'ghost' : 'wa') +
          '</div>' +
          (ct
            ? '<div class="row-actions decide" role="group" aria-label="¿Qué respondió?">' +
              decide('respondio', 'Respondió', c, 'warn', 'message') +
              decide('compro', 'Compró', c, 'good', 'check') +
              decide('no', 'No le interesa', c, 'bad', 'x') +
              '<button class="btn link" data-act="deshacer" data-key="' +
              w +
              '">Deshacer</button></div>'
            : '') +
          '</div>'
        : '') +
      '</article>'
    );
  }

  function decide(v, label, c, tone, ic) {
    const on = c.contacto && c.contacto.estado === v;
    return '<button class="btn sm decide-btn tone-' + tone + (on ? ' is-on' : '') + '" aria-pressed="' + !!on + '" data-act="marcar" data-estado="' + v + '" data-key="' + e(c.wa) + '">' + icon(ic) + e(label) + '</button>';
  }

  function renderOfertas() {
    const box = $('#cli-ofertas', el);
    if (!box) return;
    const f = state.cfg;
    box.innerHTML =
      '<div class="cli-of-body"><div class="form-grid">' +
      field('precioOferta', 'Precio de la 2ª unidad', U.int(f.precioOferta), 'numeric') +
      field('minDias', 'Escribir a los (días)', f.minDias, 'numeric') +
      field('beneficioAmigo', 'Beneficio para el amigo', f.beneficioAmigo) +
      field('premio', 'Premio por recomendar', f.premio) +
      field('ofertaLibre', 'Oferta de recompra', f.ofertaLibre) +
      field('codigo', 'Código de descuento', f.codigo) +
      '</div><p class="note" id="cli-deja">' +
      dejaHtml() +
      '</p>' +
      (Shop.mode === 'live'
        ? '<div class="cli-code"><label class="field-inline" for="cli-pct">Crear el código en Shopify con <span class="input-unit inline"><input id="cli-pct" class="num-input short" inputmode="numeric" value="' +
          e(state.codigo.pct) +
          '"><span class="unit">%</span></span></label><button class="btn ghost sm" data-act="crear-codigo"' +
          (state.codigo.running ? ' disabled' : '') +
          '>' +
          (state.codigo.running ? 'Creando…' : 'Crear código') +
          '</button>' +
          info('Usa el código de arriba. Revisá que tu formulario de pago contra entrega acepte cupones; si no, aplicá el precio a mano cuando el cliente confirme.') +
          '</div>' +
          (state.codigo.msg ? '<p class="note"><strong>' + e(state.codigo.msg) + '</strong></p>' : '')
        : '') +
      '<div class="cli-tpl-head"><h4>Mensajes</h4>' +
      info('Podés usar: <span class="mono">{nombre} {tienda} {precio} {precio_oferta} {beneficio_amigo} {premio} {oferta_libre} {codigo_txt}</span>') +
      '</div><div class="templates">' +
      Object.entries(C.OFERTAS)
        .map(
          ([k, o]) =>
            '<div class="template"><label for="cli-msg-' +
            k +
            '">' +
            e(o.label) +
            '<textarea id="cli-msg-' +
            k +
            '" data-msg="' +
            k +
            '" rows="6">' +
            e((f.mensajes && f.mensajes[k]) || o.mensaje) +
            '</textarea></label></div>'
        )
        .join('') +
      '</div></div>';
  }

  // Lo que deja la segunda unidad al precio de oferta
  function dejaHtml() {
    const f = state.cfg;
    if (!VC.profit.costsReady(App.cfg)) return icon('wallet') + ' Cargá tus costos en Ajustes para ver cuánto te deja cada oferta.';
    const rates = O.historicalRates(Shop.orders);
    // Un cliente que responde la oferta ya confirmó: tasa de confirmación 100%
    const ev = OF.evaluate({ unidades: 1, precio: Number(f.precioOferta) || 0 }, Object.assign({}, App.cfg, { tasaConfirmacion: 100 }), rates, 0, 0);
    return icon('wallet') + ' Cada 2ª unidad a <strong>' + e(U.money(f.precioOferta)) + '</strong> te deja <strong>' + e(U.money(ev.esperado)) + '</strong> en promedio, sin anuncios.';
  }

  function field(k, label, v, mode) {
    return '<label for="cli-' + k + '">' + e(label) + '<input id="cli-' + k + '" data-cfg="' + k + '"' + (mode ? ' inputmode="' + mode + '"' : '') + ' value="' + e(v == null ? '' : v) + '"></label>';
  }

  async function setC(wa, patch) {
    const prev = state.contactos.get(wa) || {};
    const next = Object.assign({}, prev, patch, { actualizado: new Date().toISOString() });
    state.contactos.set(wa, next);
    render();
    try {
      await Store.set('reactivacion/' + wa, next);
    } catch (err) {
      storeFail(err);
    }
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act], [data-seg]');
    if (!t || !el.contains(t)) return;
    if (t.dataset.seg === 'cli-filtro') {
      state.filtro = t.dataset.value;
      prefSet('cli-filtro', state.filtro);
      render();
      return;
    }
    const wa = t.dataset.key;
    switch (t.dataset.act) {
      case 'refrescar':
      case 'reintentar':
        load(true);
        break;
      case 'permisos':
        VC.runtime.managePermissions();
        break;
      case 'elegir-oferta':
        state.elegida[wa] = t.dataset.value;
        render();
        break;
      case 'wa-oferta': {
        const c = lists().all.find((x) => x.wa === wa);
        const of = c ? ofertaDe(c) : 'familia';
        setTimeout(() => setC(wa, { estado: 'enviado', oferta: of, enviadoEn: new Date().toISOString(), nombre: c ? c.nombre : '' }), 60);
        break;
      }
      case 'marcar':
        setC(wa, { estado: t.dataset.estado });
        break;
      case 'deshacer':
        state.contactos.delete(wa);
        render();
        Store.remove('reactivacion/' + wa).catch(storeFail);
        break;
      case 'crear-codigo':
        crearCodigo();
        break;
    }
  }

  async function crearCodigo() {
    const code = String(state.cfg.codigo || '').trim().toUpperCase();
    const pct = Number(U.parseNum($('#cli-pct', el).value));
    if (!code || !/^[A-Z0-9_-]{3,30}$/.test(code)) {
      toast('Escribí un código de 3 a 30 letras o números, sin espacios (ej.: VUELVE15).', 'warn');
      return;
    }
    if (!(pct >= 1 && pct <= 90)) {
      toast('El descuento tiene que ser entre 1 y 90%.', 'warn');
      return;
    }
    state.codigo = { pct, running: true, msg: '' };
    renderOfertas();
    try {
      const res = await Shop.createDiscount({ code, percentage: pct, title: 'Reactivación clientes ' + code });
      state.codigo.msg = /error|invalid|taken|ya existe|already/i.test(res) ? 'Shopify respondió: ' + res.slice(0, 160) : 'Código ' + code + ' creado (' + pct + '%).';
      if (!/error|invalid|taken|already/i.test(res)) {
        state.cfg.codigo = code;
        saveCfg();
      }
    } catch (err) {
      state.codigo.msg = err && err.code === 'approval_required' ? 'Shopify pidió tu aprobación. Aprobala y probá de nuevo.' : err && err.code === 'not_in_manifest' ? 'No diste permiso para crear descuentos desde esta página.' : 'No se pudo crear: ' + ((err && err.message) || 'error de Shopify');
    }
    state.codigo.running = false;
    renderOfertas();
  }

  function onInput(ev) {
    const t = ev.target;
    if (t.dataset.cfg) {
      const k = t.dataset.cfg;
      state.cfg[k] = ['precioOferta', 'minDias'].includes(k) ? U.parseMoney(t.value) || 0 : t.value;
      saveCfg();
      render();
    } else if (t.dataset.msg) {
      state.cfg.mensajes = Object.assign({}, state.cfg.mensajes, { [t.dataset.msg]: t.value });
      saveCfg();
      render();
    }
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.dataset.cfg === 'precioOferta') {
      const d = $('#cli-deja', el);
      if (d) d.innerHTML = dejaHtml();
    } else if (t.dataset.act === 'importar-csv' && t.files && t.files[0]) {
      VC.ui
        .readFileText(t.files[0])
        .then((txt) => {
          Shop.importCSV(txt);
          state.error = null;
          render();
        })
        .catch((err) => toast(err.message || 'No se pudo leer el archivo.', 'bad'));
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.clientes = { mount, render: () => (renderOfertas(), render()), load };
})(window);
