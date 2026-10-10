/* Arranque del panel: pestañas, conexiones y datos compartidos. */
(function (root) {
  'use strict';
  const VC = root.VC;
  const { Store, Shop, AI } = VC.runtime;
  const { App, DEFAULT_MSGS, $, $$, e, prefGet, prefSet } = VC.ui;

  const TABS = [
    { id: 'confirmar', label: 'Confirmar', grupo: 'pedidos' },
    { id: 'ganancia', label: 'Ganancia', grupo: 'pedidos' },
    { id: 'resenas', label: 'Reseñas', grupo: 'pedidos' },
    { id: 'clientes', label: 'Clientes', grupo: 'pedidos' },
    { id: 'creativos', label: 'Creativos', grupo: 'anuncios' },
    { id: 'competencia', label: 'Competencia', grupo: 'anuncios' },
    { id: 'comentarios', label: 'Comentarios', grupo: 'anuncios' },
    { id: 'guiones', label: 'Guiones', grupo: 'anuncios' },
    { id: 'ofertas', label: 'Ofertas', grupo: 'negocio' },
    { id: 'productos', label: 'Productos', grupo: 'negocio' },
    { id: 'ajustes', label: 'Ajustes', grupo: 'ajustes' },
  ];
  const mounted = new Set();
  let ready = false;
  let current = null;

  function initialTab() {
    const h = (location.hash || '').replace('#', '');
    if (TABS.some((t) => t.id === h)) return h;
    const p = prefGet('tab', 'confirmar');
    return TABS.some((t) => t.id === p) ? p : 'confirmar';
  }

  function renderNav() {
    $('#tabs').innerHTML = TABS.map(
      (t, i) =>
        (i && TABS[i - 1].grupo !== t.grupo ? '<span class="tab-sep" aria-hidden="true"></span>' : '') +
        '<button type="button" role="tab" id="tab-' +
        t.id +
        '" aria-controls="panel-' +
        t.id +
        '" aria-selected="' +
        (t.id === current) +
        '" tabindex="' +
        (t.id === current ? 0 : -1) +
        '" class="tab' +
        (t.id === current ? ' is-on' : '') +
        '" data-tab="' +
        t.id +
        '">' +
        e(t.label) +
        '<span class="tab-badge" id="badge-' +
        t.id +
        '" hidden></span></button>'
    ).join('');
  }

  function select(id, focus) {
    current = id;
    prefSet('tab', id);
    try {
      history.replaceState(null, '', '#' + id);
    } catch (err) {
      /* sin historial en esta vista */
    }
    renderNav();
    for (const t of TABS) $('#panel-' + t.id).hidden = t.id !== id;
    if (focus) $('#tab-' + id).focus();
    if (ready && !mounted.has(id)) {
      mounted.add(id);
      VC.tools[id].mount($('#panel-' + id));
    } else if (mounted.has(id) && VC.tools[id].render) VC.tools[id].render();
  }

  function renderConn() {
    const shop =
      Shop.mode === 'live'
        ? Shop.error
          ? ['Shopify con error', 'bad']
          : Shop.loading
            ? ['Shopify: cargando', 'info']
            : ['Shopify conectado', 'good']
        : Shop.mode === 'csv'
          ? ['Pedidos desde CSV', 'warn']
          : Shop.mode === 'pending'
            ? ['Conectando…', 'neutral']
            : ['Shopify sin conexión', 'bad'];
    const data = Store.mode === 'db' ? ['Datos en tu cuenta', 'neutral'] : Store.mode === 'local' ? ['Datos en este navegador', 'warn'] : ['', 'neutral'];
    $('#conn').innerHTML =
      '<span class="conn tone-' + shop[1] + '"><span class="dot"></span>' + e(shop[0]) + '</span>' + (data[0] ? '<span class="conn tone-' + data[1] + '"><span class="dot"></span>' + e(data[0]) + '</span>' : '');
  }

  function updateBadges() {
    const open = Shop.orders.filter((o) => o.estado === 'pendiente' && !App.confirm.get(o.key) && o.day >= VC.util.addDays(VC.util.todayKeyAR(), -6));
    const b = $('#badge-confirmar');
    if (b) {
      b.hidden = !open.length;
      b.textContent = open.length;
    }
  }

  async function boot() {
    renderNav();
    for (const t of TABS) $('#panel-' + t.id).hidden = t.id !== current;
    renderConn();

    await Promise.all([Store.init(), Shop.init(), AI.init()]);
    renderConn();

    const [cfg, msgs, ultimo, tienda] = await Promise.all([Store.get('config/negocio'), Store.get('config/mensajes'), Store.get('creativos/ultimo'), Store.get('config/tienda')]);
    if (cfg) Object.assign(App.cfg, cfg);
    if (msgs) Object.assign(App.msgs, DEFAULT_MSGS, msgs);
    if (tienda) Object.assign(App.tienda, tienda);
    if (ultimo) App.ultimoAnalisis = ultimo;

    Store.watch('confirmaciones', (m) => {
      App.confirm = m;
      App.emit('confirm');
      updateBadges();
    });
    Store.watch('resenas', (m) => {
      App.resenas = m;
      App.emit('resenas');
    });
    Shop.onChange(() => {
      renderConn();
      updateBadges();
    });

    ready = true;
    mounted.add(current);
    VC.tools[current].mount($('#panel-' + current));
  }

  document.addEventListener('click', (ev) => {
    const tab = ev.target.closest('[data-tab]');
    if (tab) {
      select(tab.dataset.tab);
      return;
    }
    const go = ev.target.closest('[data-goto]');
    if (go) {
      ev.preventDefault();
      select(go.dataset.goto);
      root.scrollTo({ top: 0, behavior: 'auto' });
    }
  });

  document.addEventListener('keydown', (ev) => {
    const tab = ev.target.closest && ev.target.closest('[role="tab"]');
    if (!tab || (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')) return;
    const i = TABS.findIndex((t) => t.id === tab.dataset.tab);
    const next = TABS[(i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    select(next.id, true);
  });

  current = initialTab();
  boot().catch((err) => {
    console.error(err);
    $('#conn').innerHTML = '<span class="conn tone-bad"><span class="dot"></span>Error al iniciar: ' + e(err && err.message ? err.message : String(err)) + '</span>';
  });
})(window);
