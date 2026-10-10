/* Inicio: lo que hay que hacer hoy, en tarjetas, y el estado de las tareas automáticas */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const P = VC.profit;
  const O = VC.orders;
  const { Store, Shop, Browser } = VC.runtime;
  const { e, $, App, icon, bubble, toggle } = VC.ui;

  const state = { gastosHoy: null, contactos: new Map(), escaneo: null, guiones: null, investigacion: new Map() };
  let el;

  function mount(section) {
    el = section;
    el.addEventListener('change', onChange);
    Shop.onChange(render);
    App.on(render);
    VC.auto.on((ev) => (ev.type === 'done' || ev.type === 'cfg' || ev.type === 'start' || ev.type === 'error') && reload());
    reload();
  }

  async function reload() {
    const hoy = U.todayKeyAR();
    const [g, contactos, escaneo, guiones, inv] = await Promise.all([Store.get('gastos/' + hoy), Store.list('reactivacion'), Store.get('escaneos/ultimo'), Store.get('guiones/auto'), Store.list('investigacion')]);
    state.gastosHoy = g;
    state.contactos = contactos;
    state.escaneo = escaneo;
    state.guiones = guiones;
    state.investigacion = inv;
    render();
  }

  function saludo() {
    const h = new Date(Date.now() - U.AR_OFFSET_MS).getUTCHours();
    return h < 12 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  }

  function card(tab, iconName, tone, value, label, cta, quiet) {
    return (
      '<button type="button" class="home-card' +
      (quiet ? ' is-quiet' : '') +
      '" data-goto="' +
      tab +
      '">' +
      bubble(iconName, tone) +
      '<span class="hc-value">' +
      e(value) +
      '</span><span class="hc-label">' +
      e(label) +
      '</span><span class="hc-cta">' +
      e(cta) +
      icon('arrowRight') +
      '</span></button>'
    );
  }

  function render() {
    if (!el) return;
    const hoy = U.todayKeyAR();
    const cargando = !Shop.loadedAt && Shop.mode !== 'none';
    const orders = Shop.orders;

    // Pedidos para confirmar (últimos 7 días, sin escribir)
    const desde7 = U.addDays(hoy, -6);
    const porConfirmar = orders.filter((o) => o.estado === 'pendiente' && o.day >= desde7 && !App.confirm.get(o.key)).length;
    const listos = orders.filter((o) => o.estado === 'pendiente' && (App.confirm.get(o.key) || {}).estado === 'confirmado').length;

    // Ganancia de hoy
    let ganancia = null;
    if (P.costsReady(App.cfg) && Shop.loadedAt) {
      const r = P.computeProfit({ orders, gastos: state.gastosHoy ? { [hoy]: state.gastosHoy } : {}, cfg: App.cfg, rates: O.historicalRates(orders), confirm: App.confirmStates(), from: hoy, to: hoy });
      ganancia = r.total;
    }
    const pedidosHoy = orders.filter((o) => o.day === hoy).length;

    // Clientes para reactivar
    const clientes = VC.customers.buildCustomers(orders, { minDias: 20, resenas: App.resenas }).filter((c) => c.listo && !state.contactos.has(c.wa)).length;

    // Reseñas para pedir
    const dias = Number(App.msgs.diasResena) || 4;
    const resenas = orders.filter((o) => o.estado === 'entregado' && !App.resenas.get(o.key) && U.hoursSince(o.deliveredAt || o.closedAt || o.createdAt) / 24 >= dias && o.day >= U.addDays(hoy, -60)).length;

    // Competencia y guiones
    const esc = state.escaneo;
    const gui = state.guiones;
    const nGuiones = gui && Array.isArray(gui.guiones) ? gui.guiones.length : 0;

    // Productos: el que más se vende según la última medición
    let mejor = null;
    for (const [id, inv] of state.investigacion) {
      if (id === 'descubrir' || !inv || !inv.senales) continue;
      const v = inv.senales.vendidosVisibles || (inv.senales.opiniones || 0) * 10;
      if (!mejor || v > mejor.v) mejor = { v, nombre: inv.busqueda || id, vende: inv.senales.vende };
    }

    const cards = [
      card('confirmar', 'check', porConfirmar ? 'warn' : 'good', cargando ? '…' : porConfirmar ? String(porConfirmar) : 'Al día', porConfirmar ? (porConfirmar === 1 ? 'pedido para confirmar' : 'pedidos para confirmar') : listos ? listos + ' listos para despachar' : 'no hay pedidos sin escribir', porConfirmar ? 'Confirmar por WhatsApp' : 'Ver pedidos', !porConfirmar),
      card(
        P.costsReady(App.cfg) ? 'ganancia' : 'ajustes',
        'wallet',
        ganancia && ganancia.ganancia < 0 ? 'bad' : 'good',
        ganancia ? U.money(ganancia.ganancia) : P.costsReady(App.cfg) ? '…' : 'Sin costos',
        ganancia ? 'ganancia estimada hoy · ' + pedidosHoy + (pedidosHoy === 1 ? ' pedido' : ' pedidos') : 'cargá tus costos para verla',
        ganancia ? 'Ver ganancia' : 'Cargar costos',
        !ganancia
      ),
      card('clientes', 'users', 'source', cargando ? '…' : String(clientes), clientes === 1 ? 'cliente para volver a venderle' : 'clientes para volver a venderles', 'Mandar ofertas', !clientes),
      card('resenas', 'star', 'peach', cargando ? '…' : String(resenas), resenas === 1 ? 'entregado para pedir reseña' : 'entregados para pedir reseña', 'Pedir reseñas', !resenas),
      card(
        'competencia',
        'eye',
        '',
        esc ? String(esc.nuevos || 0) : 'Sin escanear',
        esc ? 'anuncios nuevos de la competencia · ' + U.timeAgo(esc.fecha) : 'anuncios de la competencia',
        esc ? 'Ver qué encontré' : 'Escanear',
        !esc || !esc.nuevos
      ),
      card('guiones', 'video', 'source', nGuiones ? String(nGuiones) : 'Sin guiones', nGuiones ? 'guiones listos · ' + U.timeAgo(gui.fecha) : 'guiones para tus videos', nGuiones ? 'Ver guiones' : 'Generar guiones', !nGuiones),
      card('productos', 'box', 'good', mejor ? mejor.nombre : 'Sin medir', mejor ? (mejor.vende === 'si' ? 'es el que más se vende en Mercado Libre' : 'el mejor medido hasta ahora') : 'próximo producto para vender', mejor ? 'Ver productos' : 'Buscar ganadores', !mejor),
    ];

    el.innerHTML =
      '<header class="tool-head home-hello"><div><h2>' +
      e(saludo()) +
      '</h2><p class="lede">' +
      e(U.fmtDay(hoy, true)) +
      (Shop.mode === 'none' ? ' · abrí el panel desde claude.ai para ver tus pedidos' : '') +
      '</p></div></header>' +
      '<div class="home-grid">' +
      cards.join('') +
      '</div>' +
      autoPanel();
  }

  function autoPanel() {
    const A = VC.auto;
    if (!A || !A.loaded) return '';
    const filas = [
      ['competencia', 'eye', 'Escanear la competencia'],
      ['tiendas', 'store', 'Revisar tiendas de la competencia'],
      ['productos', 'box', 'Medir productos en Mercado Libre'],
      ['guiones', 'video', 'Escribir guiones nuevos'],
    ];
    return (
      '<section class="panel home-auto"><div class="panel-head"><div class="panel-title">' +
      bubble('zap', 'peach') +
      '<div><h3>Automático</h3><p class="small muted">Se hace solo cada vez que abrís el panel, si ya pasó el tiempo.</p></div></div></div>' +
      filas
        .map(([k, ic, label]) => {
          const c = A.cfg[k] || {};
          const u = A.ultima(k);
          const can = A.can(k);
          const corriendo = A.running === k;
          const meta = corriendo ? 'Trabajando…' : !can.ok ? (k === 'guiones' ? 'Necesita Claude' : 'Necesita la app de escritorio de Claude') : u ? 'Última vez ' + U.timeAgo(u) : 'Nunca se hizo';
          return '<div class="auto-row">' + icon(ic) + '<span class="ar-name">' + e(label) + '<br><span class="ar-meta">' + e(meta) + '</span></span>' + toggle('auto-' + k, !!c.auto, '', 'data-auto="' + k + '" aria-label="' + e(label) + ' solo"') + '</div>';
        })
        .join('') +
      (!Browser.available ? '<p class="small muted">Para leer la competencia y Mercado Libre, abrí este panel desde la app de escritorio de Claude.</p>' : '') +
      '</section>'
    );
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.dataset.auto) VC.auto.setCfg(t.dataset.auto, { auto: t.checked });
  }

  VC.tools = VC.tools || {};
  VC.tools.inicio = { mount, render: () => reload() };
})(window);
