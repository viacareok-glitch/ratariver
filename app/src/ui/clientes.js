/* Reactivador de clientes que ya pagaron */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const C = VC.customers;
  const OF = VC.offers;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, chip, waButton, seg, emptyState, shopStatusBanner, toast, prefGet, prefSet, storeFail } = VC.ui;

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
    loading: false,
    error: null,
    codigo: { pct: 15, running: false, msg: '' },
  };
  let el;

  function mount(section) {
    el = section;
    el.innerHTML =
      '<header class="tool-head"><div><h2>Clientes para reactivar</h2><p class="lede">Gente que ya te compró y pagó. Escribiles con una oferta: venderle de nuevo a alguien que confía en vos cuesta mucho menos que conseguir un cliente nuevo.</p></div>' +
      '<div class="tool-actions"><button class="btn ghost" data-act="refrescar">Actualizar</button></div></header>' +
      '<div id="cli-status"></div><div id="cli-summary"></div><details class="panel" id="cli-ofertas"></details><div id="cli-filters"></div><div id="cli-list" class="order-list"></div>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    Shop.onChange(render);
    App.on((w) => (w === 'resenas' || w === 'cfg' || w === 'msgs' || w === 'tienda') && render());
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
    if (Shop.mode === 'none') st.innerHTML = shopStatusBanner({ message: 'Esta vista no puede conectarse a Shopify. Abrí el panel desde claude.ai o importá el CSV de pedidos.' });
    else st.innerHTML = state.error ? shopStatusBanner(state.error) : '';

    const L = lists();
    const loadingFirst = (state.loading || Shop.mode === 'pending') && !Shop.loadedAt;
    const recuperado = U.sum(L.volvieron, (c) => (c.volvio ? c.volvio.total : 0));
    const respondieron = L.all.filter((c) => c.contacto && ['respondio', 'compro'].includes(c.contacto.estado)).length;
    $('#cli-summary', el).innerHTML = loadingFirst
      ? '<div class="summary-strip is-loading">Cargando clientes…</div>'
      : '<div class="summary-strip">' +
        stat(L.all.length, 'clientes que pagaron') +
        stat(L.escribir.length, 'listos para escribir', L.escribir.length ? 'warn' : '') +
        stat(L.escritos.length + L.volvieron.length, 'ya escritos') +
        stat(respondieron, 'respondieron') +
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
    else if (!list.length)
      box.innerHTML = emptyState(
        'Nada por acá',
        e(
          {
            escribir: L.all.length ? 'Ya les escribiste a todos los clientes listos. Los que compraron hace menos de ' + state.cfg.minDias + ' días aparecen cuando pase ese tiempo.' : 'Todavía no hay clientes con pedidos entregados y cobrados.',
            escritos: 'Todavía no le mandaste ninguna oferta a un cliente.',
            volvieron: 'Cuando un cliente al que le escribiste haga un pedido nuevo, aparece acá solo.',
            all: 'Todavía no hay clientes con pedidos entregados y cobrados.',
          }[state.filtro]
        )
      );
    else box.innerHTML = list.map(card).join('');
  }

  function stat(v, label, tone) {
    return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><span class="stat-value">' + e(v) + '</span><span class="stat-label">' + e(label) + '</span></div>';
  }

  function card(c) {
    const of = ofertaDe(c);
    const ct = c.contacto;
    const msg = C.message(c, of, state.cfg, App.datos());
    const chips = [
      c.volvio ? chip('Volvió a comprar: ' + c.volvio.name, 'good') : ct && R_ESTADOS[ct.estado] ? chip(R_ESTADOS[ct.estado].label, R_ESTADOS[ct.estado].tone) : c.listo ? chip('Listo para escribir', 'info') : '',
      c.abierto ? chip('Tiene un pedido abierto', 'neutral') : '',
      !c.listo && !c.abierto && !ct ? chip('Compró hace ' + c.dias + ' días', 'neutral') : '',
      c.resena ? chip('Reseña ' + '★'.repeat(Number(c.resena.estrellas) || 5), 'good') : '',
      c.compras > 1 ? chip(c.compras + ' compras', 'source') : '',
    ].join('');
    const ofSel =
      '<label class="field-inline small" for="of-' +
      e(c.wa) +
      '">Oferta <select id="of-' +
      e(c.wa) +
      '" data-oferta="' +
      e(c.wa) +
      '">' +
      Object.entries(C.OFERTAS)
        .map(([k, o]) => '<option value="' + k + '"' + (k === of ? ' selected' : '') + '>' + e(o.label) + (k === C.suggestOffer(c) ? ' (sugerida)' : '') + '</option>')
        .join('') +
      '</select></label>';
    return (
      '<article class="order-card' +
      (c.volvio ? ' is-good' : '') +
      '"><div class="oc-top"><div class="oc-id"><strong>' +
      e(c.nombre || 'Sin nombre') +
      '</strong><span class="muted">' +
      e([c.ciudad, c.provincia].filter(Boolean).join(', ')) +
      '</span></div><div class="oc-total mono">' +
      e(U.money(c.gastado)) +
      '</div></div><div class="oc-addr">' +
      e(c.unidades + (c.unidades === 1 ? ' unidad' : ' unidades') + ' · última compra ' + U.timeAgo(c.ultimaCompra) + ' · ' + c.ultimoPedido) +
      (ct && ct.enviadoEn ? ' · oferta enviada ' + e(U.timeAgo(ct.enviadoEn)) : '') +
      '</div><div class="oc-phone"><span class="mono selectable">' +
      e(c.phone.display) +
      '</span></div><div class="chips">' +
      chips +
      '</div>' +
      (!c.volvio ? '<div class="msg-row">' + ofSel + '<details class="msg-preview"><summary>Ver mensaje</summary><p class="preview">' + e(msg) + '</p></details></div>' : '') +
      (!c.volvio
        ? '<div class="oc-actions"><div class="row-actions">' +
          waButton(U.waLink(c.phone.wa, msg), ct ? 'Volver a escribir' : 'Enviar oferta', 'wa-oferta', c.wa, ct ? 'ghost' : 'wa') +
          '</div><div class="row-actions decide">' +
          (ct
            ? decide('respondio', 'Respondió', c, 'warn') + decide('compro', 'Compró', c, 'good') + decide('no', 'No le interesa', c, 'bad') + '<button class="btn link" data-act="deshacer" data-key="' + e(c.wa) + '">Deshacer</button>'
            : '') +
          '</div></div>'
        : '') +
      '</article>'
    );
  }

  function decide(v, label, c, tone) {
    const on = c.contacto && c.contacto.estado === v;
    return '<button class="btn decide-btn tone-' + tone + (on ? ' is-on' : '') + '" aria-pressed="' + !!on + '" data-act="marcar" data-estado="' + v + '" data-key="' + e(c.wa) + '">' + e(label) + '</button>';
  }

  function renderOfertas() {
    const box = $('#cli-ofertas', el);
    if (!box) return;
    const wasOpen = box.open;
    const f = state.cfg;
    const rates = O.historicalRates(Shop.orders);
    // Un cliente que responde la oferta ya confirmó: tasa de confirmación 100%
    const ev = OF.evaluate({ unidades: 1, precio: Number(f.precioOferta) || 0 }, Object.assign({}, App.cfg, { tasaConfirmacion: 100 }), rates, 0, 0);
    const deja = VC.profit.costsReady(App.cfg) ? 'Con tus costos, cada segunda unidad a ' + U.money(f.precioOferta) + ' te deja ' + U.money(ev.esperado) + ' en promedio (sin publicidad).' : 'Cargá tus costos en Ajustes para ver cuánto te deja cada oferta.';
    box.innerHTML =
      '<summary>Ofertas y mensajes</summary><div class="form-grid">' +
      field('precioOferta', 'Precio de la segunda unidad (familia)', U.int(f.precioOferta), 'numeric') +
      field('beneficioAmigo', 'Beneficio para el amigo', f.beneficioAmigo) +
      field('premio', 'Premio para el cliente que recomienda', f.premio) +
      field('ofertaLibre', 'Oferta de recompra', f.ofertaLibre) +
      field('codigo', 'Código de descuento (opcional)', f.codigo) +
      field('minDias', 'Escribir a partir de (días de la compra)', f.minDias, 'numeric') +
      '</div><p class="muted small">' +
      e(deja) +
      '</p>' +
      (Shop.mode === 'live'
        ? '<div class="row-actions code-row"><label class="field-inline" for="cli-pct">Crear el código en Shopify con <input id="cli-pct" class="num-input short" inputmode="numeric" value="' +
          e(state.codigo.pct) +
          '"> % de descuento</label><button class="btn ghost" data-act="crear-codigo"' +
          (state.codigo.running ? ' disabled' : '') +
          '>' +
          (state.codigo.running ? 'Creando…' : 'Crear código') +
          '</button></div><p class="muted small">Revisá que tu formulario de pago contra entrega acepte cupones. Si no, aplicá el precio a mano cuando el cliente confirme.' +
          (state.codigo.msg ? ' <strong>' + e(state.codigo.msg) + '</strong>' : '') +
          '</p>'
        : '') +
      '<div class="templates">' +
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
      '</div><p class="muted small">Variables: <span class="mono">{nombre} {tienda} {precio} {precio_oferta} {beneficio_amigo} {premio} {oferta_libre} {codigo_txt}</span></p>';
    box.open = wasOpen;
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
    if (t.dataset.oferta) {
      state.elegida[t.dataset.oferta] = t.value;
      render();
    } else if (t.dataset.cfg === 'precioOferta') {
      renderOfertas();
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
