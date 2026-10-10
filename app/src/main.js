/* Arranque del panel: menú, conexiones y datos compartidos. */
(function (root) {
  'use strict';
  const VC = root.VC;
  const { Store, Shop, AI, Browser } = VC.runtime;
  const { App, DEFAULT_MSGS, $, e, icon, prefGet, prefSet } = VC.ui;

  const TABS = [
    { id: 'inicio', label: 'Inicio', icon: 'home', grupo: '' },
    { id: 'confirmar', label: 'Confirmar', icon: 'check', grupo: 'Pedidos' },
    { id: 'ganancia', label: 'Ganancia', icon: 'wallet', grupo: 'Pedidos' },
    { id: 'resenas', label: 'Reseñas', icon: 'star', grupo: 'Pedidos' },
    { id: 'clientes', label: 'Clientes', icon: 'users', grupo: 'Pedidos' },
    { id: 'creativos', label: 'Creativos', icon: 'chart', grupo: 'Anuncios' },
    { id: 'competencia', label: 'Competencia', icon: 'eye', grupo: 'Anuncios' },
    { id: 'comentarios', label: 'Comentarios', icon: 'message', grupo: 'Anuncios' },
    { id: 'guiones', label: 'Guiones', icon: 'video', grupo: 'Anuncios' },
    { id: 'ofertas', label: 'Ofertas', icon: 'tag', grupo: 'Negocio' },
    { id: 'productos', label: 'Productos', icon: 'box', grupo: 'Negocio' },
    { id: 'ajustes', label: 'Ajustes', icon: 'sliders', grupo: 'Negocio' },
  ];
  // Barra inferior del celular: las más usadas + "Más"
  const BOTTOM = ['inicio', 'confirmar', 'ganancia', 'guiones'];

  const mounted = new Set();
  const badges = {}; // id → texto
  let ready = false;
  let current = null;

  function initialTab() {
    const h = (location.hash || '').replace('#', '');
    if (TABS.some((t) => t.id === h)) return h;
    const p = prefGet('tab', 'inicio');
    return TABS.some((t) => t.id === p) ? p : 'inicio';
  }

  function badgeHtml(id) {
    const b = badges[id];
    return b ? '<span class="tab-badge' + (b === 'nuevo' ? ' is-new' : '') + '" id="badge-' + id + '">' + e(b) + '</span>' : '';
  }

  function renderNav() {
    let html = '';
    let grupo = null;
    for (const t of TABS) {
      if (t.grupo !== grupo) {
        grupo = t.grupo;
        if (grupo) html += '<div class="nav-group" aria-hidden="true">' + e(grupo) + '</div>';
      }
      const on = t.id === current;
      html +=
        '<button type="button" role="tab" id="nav-' +
        t.id +
        '" aria-controls="panel-' +
        t.id +
        '" aria-selected="' +
        on +
        '" tabindex="' +
        (on ? 0 : -1) +
        '" class="nav-item' +
        (on ? ' is-on' : '') +
        '" data-tab="' +
        t.id +
        '">' +
        icon(t.icon) +
        '<span class="nav-label">' +
        e(t.label) +
        '</span>' +
        badgeHtml(t.id) +
        '</button>';
    }
    $('#nav').innerHTML = html;

    const enBarra = BOTTOM.includes(current);
    $('#bottom-nav').innerHTML =
      BOTTOM.map((id) => {
        const t = TABS.find((x) => x.id === id);
        return '<button type="button" class="bn-item' + (id === current ? ' is-on' : '') + '" data-tab="' + id + '">' + icon(t.icon) + '<span>' + e(t.label) + '</span>' + badgeHtml(id) + '</button>';
      }).join('') +
      '<button type="button" class="bn-item' +
      (enBarra ? '' : ' is-on') +
      '" data-act="mas" aria-haspopup="dialog">' +
      icon('grid') +
      '<span>' +
      e(enBarra ? 'Más' : (TABS.find((t) => t.id === current) || {}).label || 'Más') +
      '</span>' +
      (TABS.some((t) => !BOTTOM.includes(t.id) && badges[t.id]) ? '<span class="tab-badge is-new">•</span>' : '') +
      '</button>';
  }

  function openSheet() {
    const sh = $('#sheet');
    sh.innerHTML =
      '<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Todas las herramientas"><div class="sheet-head"><h3>Herramientas</h3><button type="button" class="btn ghost icon-only" data-act="cerrar-mas" aria-label="Cerrar">' +
      icon('x') +
      '</button></div><div class="sheet-grid">' +
      TABS.map((t) => '<button type="button" class="sheet-item' + (t.id === current ? ' is-on' : '') + '" data-tab="' + t.id + '">' + icon(t.icon) + e(t.label) + (badges[t.id] ? ' <span class="badge">' + e(badges[t.id]) + '</span>' : '') + '</button>').join('') +
      '</div></div>';
    sh.hidden = false;
  }

  function closeSheet() {
    $('#sheet').hidden = true;
  }

  function select(id, focus) {
    current = id;
    prefSet('tab', id);
    try {
      history.replaceState(null, '', '#' + id);
    } catch (err) {
      /* sin historial en esta vista */
    }
    if (badges[id] === 'nuevo') delete badges[id];
    closeSheet();
    renderNav();
    for (const t of TABS) $('#panel-' + t.id).hidden = t.id !== id;
    if (id === 'confirmar') updateBadges();
    if (focus) $('#nav-' + id).focus();
    if (ready && !mounted.has(id)) {
      mounted.add(id);
      VC.tools[id].mount($('#panel-' + id));
    } else if (mounted.has(id) && VC.tools[id].render) VC.tools[id].render();
    root.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderConn() {
    const shop =
      Shop.mode === 'live'
        ? Shop.error
          ? ['Shopify con error', 'bad']
          : Shop.loading
            ? ['Shopify: cargando…', 'info']
            : ['Shopify conectado', 'good']
        : Shop.mode === 'csv'
          ? ['Pedidos desde CSV', 'warn']
          : Shop.mode === 'pending'
            ? ['Conectando…', 'neutral']
            : ['Shopify sin conexión', 'bad'];
    const items = [shop];
    if (Browser.checked) items.push(Browser.available ? ['Navegador de tu PC', 'good'] : ['Sin navegador (app de escritorio)', 'neutral']);
    if (Store.mode === 'db') items.push(['Datos en tu cuenta', 'good']);
    else if (Store.mode === 'local') items.push(['Datos en este navegador', 'warn']);
    const html = items.map(([t, tone]) => '<span class="conn tone-' + tone + '" title="' + e(t) + '"><span class="dot"></span>' + e(t) + '</span>').join('');
    $('#conn').innerHTML = html;
    $('#conn-m').innerHTML = html;

    const A = VC.auto;
    $('#auto-strip').innerHTML =
      A && A.running
        ? '<div class="auto-strip" role="status"><span class="dot"></span><span>' +
          e(cap(A.NOMBRES[A.running] || A.running)) +
          '</span><span class="txt">' +
          e(A.progress[A.running] || '') +
          '</span><button type="button" data-act="auto-stop">Detener</button></div>'
        : '';
  }

  function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // Pestaña donde se ven los resultados de cada tarea automática
  const TAB_DE = { competencia: 'competencia', tiendas: 'competencia', productos: 'productos', descubrir: 'productos', guiones: 'guiones' };

  function markNew(tab) {
    if (!tab || tab === current) return;
    badges[tab] = 'nuevo';
    renderNav();
  }

  function updateBadges() {
    const open = Shop.orders.filter((o) => o.estado === 'pendiente' && !App.confirm.get(o.key) && o.day >= VC.util.addDays(VC.util.todayKeyAR(), -6));
    const before = badges.confirmar;
    if (open.length) badges.confirmar = String(open.length);
    else delete badges.confirmar;
    if (before !== badges.confirmar) renderNav();
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

    // Tareas automáticas: necesitan saber si hay navegador (app de escritorio) y Claude
    await Browser.init();
    renderConn();
    VC.auto.on((ev) => {
      renderConn();
      if (ev.type === 'done' && ev.resultado && ev.resultado.novedades > 0) markNew(TAB_DE[ev.job]);
      if (ev.type === 'done' && ev.origen !== 'manual' && ev.resultado && ev.resultado.resumen) VC.ui.toast(ev.resultado.resumen, 'good');
    });
    await VC.auto.load();
    App.emit('auto');
    VC.auto.boot().catch((err) => console.error(err));
    // Inicio se arma con los pedidos de Shopify: cargarlos aunque no se abra otra pestaña
    Shop.ensure(VC.util.addDays(VC.util.todayKeyAR(), -60)).catch(() => {});
  }

  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act="auto-stop"]')) {
      VC.auto.stop();
      return;
    }
    if (ev.target.closest('[data-act="mas"]')) {
      openSheet();
      return;
    }
    if (ev.target.closest('[data-act="cerrar-mas"]') || ev.target.id === 'sheet') {
      closeSheet();
      return;
    }
    const tab = ev.target.closest('[data-tab]');
    if (tab) {
      select(tab.dataset.tab);
      return;
    }
    const go = ev.target.closest('[data-goto]');
    if (go) {
      ev.preventDefault();
      select(go.dataset.goto);
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('#sheet').hidden) {
      closeSheet();
      return;
    }
    const tab = ev.target.closest && ev.target.closest('.nav [role="tab"]');
    if (!tab || (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp')) return;
    ev.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab.dataset.tab);
    const next = TABS[(i + (ev.key === 'ArrowDown' ? 1 : TABS.length - 1)) % TABS.length];
    select(next.id, true);
  });

  VC.nav = { select, TABS };
  current = initialTab();
  boot().catch((err) => {
    console.error(err);
    $('#conn').innerHTML = '<span class="conn tone-bad"><span class="dot"></span>Error al iniciar: ' + e(err && err.message ? err.message : String(err)) + '</span>';
  });
})(window);
