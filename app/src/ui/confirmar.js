/* 1 · Confirmador de pedidos por WhatsApp */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, chip, waButton, seg, emptyState, shopStatusBanner, toast, copyText, prefGet, prefSet, storeFail, icon, pageHead, info } = VC.ui;

  const WA_ESTADOS = {
    esperando: { label: 'Esperando respuesta', tone: 'warn' },
    no_responde: { label: 'No responde', tone: 'warn' },
    confirmado: { label: 'Confirmado', tone: 'good' },
    cancelado: { label: 'Canceló', tone: 'bad' },
  };
  const TAG_OK = 'WA-confirmado';
  const TAG_NO = 'WA-cancelado';

  const state = {
    filtro: prefGet('conf-filtro', 'escribir'),
    dias: prefGet('conf-dias', 7),
    loading: false,
    error: null,
  };

  let el;

  function mount(section) {
    el = section;
    el.innerHTML =
      pageHead(
        'Confirmar pedidos',
        'Escribí por WhatsApp y despachá solo los confirmados.',
        '<label class="sr-only" for="conf-dias">Período</label><select id="conf-dias">' +
          [3, 7, 14, 30].map((d) => '<option value="' + d + '"' + (d === state.dias ? ' selected' : '') + '>Últimos ' + d + ' días</option>').join('') +
          '</select><button class="btn ghost icon-only" data-act="refrescar" aria-label="Actualizar pedidos" title="Actualizar">' +
          icon('refresh') +
          '</button>'
      ) +
      '<div id="conf-status"></div><div id="conf-summary"></div><div id="conf-filters"></div><div id="conf-list" class="order-list"></div><div id="conf-dispatch"></div>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    Shop.onChange(render);
    App.on((what) => (what === 'confirm' || what === 'msgs') && render());
    load();
  }

  async function load(fresh) {
    state.loading = true;
    state.error = null;
    render();
    try {
      await Shop.ensure(U.addDays(U.todayKeyAR(), -(state.dias - 1)), { fresh });
    } catch (err) {
      state.error = err;
    }
    state.loading = false;
    render();
  }

  function waState(o) {
    const c = App.confirm.get(o.key);
    return c && c.estado;
  }

  function lists() {
    const since = U.addDays(U.todayKeyAR(), -(state.dias - 1));
    const all = Shop.orders.filter((o) => o.day >= since);
    const abiertos = all.filter((o) => o.estado === 'pendiente');
    const s = (o) => waState(o);
    return {
      all,
      escribir: abiertos.filter((o) => !s(o)),
      esperando: abiertos.filter((o) => s(o) === 'esperando' || s(o) === 'no_responde'),
      confirmados: abiertos.filter((o) => s(o) === 'confirmado'),
      cancelados: abiertos.filter((o) => s(o) === 'cancelado'),
    };
  }

  function render() {
    if (!el) return;
    const statusEl = $('#conf-status', el);
    if (Shop.mode === 'none') {
      statusEl.innerHTML = shopStatusBanner({ message: 'Abrí el panel desde claude.ai para ver tus pedidos, o importá el CSV de Shopify.' });
    } else if (state.error) {
      statusEl.innerHTML = shopStatusBanner(state.error);
    } else if (Shop.mode === 'csv') {
      statusEl.innerHTML = '<p class="note">Pedidos del CSV importado.</p>';
    } else statusEl.innerHTML = '';

    const L = lists();
    const loadingFirst = (state.loading || Shop.mode === 'pending') && !Shop.loadedAt;
    const rates = O.historicalRates(Shop.orders);
    const hoy = U.todayKeyAR();
    const hoyN = L.all.filter((o) => o.day === hoy).length;
    const decididos = L.all.filter((o) => ['confirmado', 'cancelado'].includes(waState(o)));
    const tasaWA = decididos.length ? decididos.filter((o) => waState(o) === 'confirmado').length / decididos.length : null;

    $('#conf-summary', el).innerHTML = loadingFirst
      ? '<div class="summary-strip is-loading">Cargando pedidos…</div>'
      : '<div class="summary-strip">' +
        stat(L.escribir.length, 'por escribir', L.escribir.length ? 'warn' : '') +
        stat(L.esperando.length, 'esperando respuesta') +
        stat(L.confirmados.length, 'listos para despachar', L.confirmados.length ? 'good' : '') +
        stat(
          tasaWA == null ? '—' : U.pct(tasaWA),
          'confirman',
          '',
          info(
            'De los pedidos que marcaste, cuántos confirmaron. Antes de usar el panel se despachaba el ' +
              (rates.confirmacion == null ? '—' : U.pct(rates.confirmacion)) +
              ' (' +
              rates.muestraConfirmacion +
              ' pedidos de tu historial). Hoy entraron ' +
              hoyN +
              '.'
          )
        ) +
        '</div>';

    $('#conf-filters', el).innerHTML = seg(
      'conf-filtro',
      [
        { value: 'escribir', label: 'Por escribir', count: L.escribir.length },
        { value: 'esperando', label: 'Esperando', count: L.esperando.length },
        { value: 'confirmados', label: 'Confirmados', count: L.confirmados.length },
        { value: 'cancelados', label: 'Cancelaron', count: L.cancelados.length },
        { value: 'all', label: 'Todos', count: L.all.length },
      ],
      state.filtro
    );

    const list = L[state.filtro] || L.all;
    const dup = O.duplicateIndex(L.all.filter((o) => o.estado !== 'anulado'));
    const listEl = $('#conf-list', el);
    if (loadingFirst) {
      listEl.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    } else if (!list.length) {
      listEl.innerHTML = emptyText(L);
    } else {
      listEl.innerHTML = list.map((o) => card(o, dup.get(o.id))).join('');
    }

    const disp = $('#conf-dispatch', el);
    if (L.confirmados.length && (state.filtro === 'confirmados' || state.filtro === 'escribir')) {
      const names = L.confirmados.map((o) => o.name).join(', ');
      disp.innerHTML =
        '<div class="dispatch"><div>' +
        icon('truck') +
        ' <strong>' +
        L.confirmados.length +
        ' para despachar:</strong> <span class="mono selectable">' +
        e(names) +
        '</span></div><button class="btn ghost sm" data-act="copiar-despacho" data-text="' +
        e(names) +
        '">' +
        icon('copy') +
        'Copiar</button></div>';
    } else if (L.cancelados.length && state.filtro === 'cancelados') {
      disp.innerHTML = '<p class="note">' + icon('alert') + ' Anulalos también en Shopify para que Dropi no los despache.</p>';
    } else disp.innerHTML = '';
  }

  function stat(value, label, tone, extra) {
    return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><span class="stat-value">' + e(value) + '</span><span class="stat-label">' + e(label) + (extra ? ' ' + extra : '') + '</span></div>';
  }

  function emptyText(L) {
    if (!Shop.loadedAt) return emptyState('Sin pedidos todavía', 'Cuando Shopify responda aparecen acá.', '', 'clock');
    const msgs = {
      escribir: L.all.length ? ['Todo al día', 'No hay pedidos sin escribir.', 'check'] : ['Sin pedidos', 'No entraron pedidos en estos días.', 'box'],
      esperando: ['Nadie esperando', 'Ningún cliente quedó sin responder.', 'check'],
      confirmados: ['Nada para despachar', 'Cuando alguien confirme, aparece acá.', 'truck'],
      cancelados: ['Sin cancelaciones', 'Ningún cliente canceló por WhatsApp.', 'check'],
      all: ['Sin pedidos', 'No entraron pedidos en estos días.', 'box'],
    };
    const m = msgs[state.filtro] || msgs.all;
    return emptyState(m[0], e(m[1]), '', m[2]);
  }

  function card(o, dups) {
    const vars = O.templateVars(o, App.msgs);
    const ws = waState(o);
    const c = App.confirm.get(o.key) || {};
    const st = O.ESTADOS[o.estado];
    const msg = U.fillTemplate(App.msgs.confirmacion, vars);
    const rec = U.fillTemplate(App.msgs.recordatorio, vars);
    const dir = U.fillTemplate(App.msgs.direccion, vars);
    const open = o.estado === 'pendiente';
    const chips = [
      o.estado !== 'pendiente' ? chip(st.label, st.tone) : '',
      ws ? chip(WA_ESTADOS[ws].label, WA_ESTADOS[ws].tone) : '',
      o.source !== 'organico' ? chip(O.SOURCES[o.source], 'source') : '',
      dups && dups.length ? chip('Repetido: ' + dups.join(', '), 'warn') : '',

    ].join('');
    const warn = o.warnings.length && open ? '<ul class="warnings">' + o.warnings.map((w) => '<li>' + e(w) + '</li>').join('') + '</ul>' : '';
    const contacto = c.ultimoContacto ? '<span class="muted small">' + icon('clock') + ' Escrito ' + e(U.timeAgo(c.ultimoContacto)) + (c.intentos > 1 ? ' · ' + c.intentos + ' veces' : '') + '</span>' : '';
    const showRec = ws === 'esperando' || ws === 'no_responde';
    return (
      '<article class="order-card' +
      (ws === 'confirmado' ? ' is-good' : ws === 'cancelado' ? ' is-bad' : '') +
      '">' +
      '<div class="oc-top"><div class="oc-who"><strong>' +
      e(o.fullName || 'Sin nombre') +
      '</strong></div><div class="oc-total">' +
      e(U.money(o.total)) +
      '</div></div>' +
      '<div class="oc-meta muted small">' +
      e(vars.cantidad) +
      e(vars.extras) +
      ' · <span class="mono">' +
      e(o.name) +
      '</span> · ' +
      e(U.timeAgo(o.createdAt)) +
      '</div>' +
      '<div class="oc-addr">' +
      icon('truck') +
      '<span>' +
      e([vars.direccion, o.city, o.province].filter(Boolean).join(', ')) +
      (o.zip ? ' · CP ' + e(o.zip) : '') +
      (o.courierNote && o.courierNote !== '-' ? ' · ' + e(o.courierNote) : '') +
      '</span></div>' +
      '<div class="oc-phone"><span class="mono selectable">' +
      e(o.phone.display || o.phoneRaw || 'Sin teléfono') +
      '</span>' +
      (o.phone.wa && !o.phone.ok ? chip('Revisá el número', 'warn') : '') +
      contacto +
      '</div>' +
      (chips ? '<div class="chips">' + chips + '</div>' : '') +
      warn +
      (open
        ? '<div class="oc-actions"><div class="row-actions">' +
          waButton(U.waLink(o.phone.wa, ws ? rec : msg), ws ? 'Recordatorio' : 'Pedir confirmación', ws ? 'wa-recordatorio' : 'wa-confirmar', o.key, ws ? 'ghost' : 'wa') +
          (o.warnings.length ? waButton(U.waLink(o.phone.wa, dir), 'Pedir dirección', 'wa-direccion', o.key, 'ghost') : '') +
          '</div><div class="row-actions decide" role="group" aria-label="¿Qué respondió?">' +
          decideBtn('confirmado', 'Confirmó', o, ws, 'good', 'check') +
          decideBtn('no_responde', 'No responde', o, ws, 'warn', 'clock') +
          decideBtn('cancelado', 'Canceló', o, ws, 'bad', 'x') +
          (ws ? '<button class="btn link" data-act="deshacer" data-key="' + e(o.key) + '">Deshacer</button>' : '') +
          '</div></div>'
        : '') +
      '</article>'
    );
  }

  function decideBtn(value, label, o, ws, tone, ic) {
    return '<button class="btn sm decide-btn tone-' + tone + (ws === value ? ' is-on' : '') + '" aria-pressed="' + (ws === value) + '" data-act="marcar" data-estado="' + value + '" data-key="' + e(o.key) + '">' + icon(ic) + e(label) + '</button>';
  }

  function findOrder(key) {
    return Shop.orders.find((o) => o.key === key);
  }

  async function setWA(key, patch) {
    const o = findOrder(key);
    const prev = App.confirm.get(key) || {};
    const next = Object.assign({}, prev, patch, { pedido: o ? o.name : prev.pedido, actualizado: new Date().toISOString() });
    App.confirm.set(key, next);
    App.emit('confirm');
    try {
      await Store.set('confirmaciones/' + key, next);
    } catch (err) {
      storeFail(err);
    }
    return o;
  }

  async function tagShopify(o, estado) {
    if (!App.msgs.etiquetarShopify || !o || Shop.mode !== 'live') return;
    const add = estado === 'confirmado' ? [TAG_OK] : estado === 'cancelado' ? [TAG_NO] : [];
    const remove = [TAG_OK, TAG_NO].filter((t) => !add.includes(t));
    try {
      await Shop.setTags(o, add, remove);
      render();
    } catch (err) {
      const m = err && err.code === 'approval_required' ? 'Shopify pidió tu aprobación para etiquetar el pedido. Aprobalo y volvé a marcarlo.' : 'Quedó marcado en el panel, pero no se pudo etiquetar en Shopify.';
      toast(m, 'warn');
    }
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act], [data-seg]');
    if (!t || !el.contains(t)) return;
    if (t.dataset.seg === 'conf-filtro') {
      state.filtro = t.dataset.value;
      prefSet('conf-filtro', state.filtro);
      render();
      return;
    }
    const act = t.dataset.act;
    const key = t.dataset.key;
    if (act === 'refrescar' || act === 'reintentar') load(true);
    else if (act === 'permisos') VC.runtime.managePermissions().then((ok) => !ok && toast('Abrí el menú Permisos de esta página para habilitar Shopify.', 'warn'));
    else if (act === 'wa-confirmar' || act === 'wa-recordatorio' || act === 'wa-direccion') {
      // El enlace abre WhatsApp; acá solo registramos que se abrió el chat (después del clic, para no cortar la navegación).
      const prev = App.confirm.get(key) || {};
      setTimeout(
        () =>
          setWA(key, {
            estado: prev.estado === 'confirmado' || prev.estado === 'cancelado' ? prev.estado : 'esperando',
            ultimoContacto: new Date().toISOString(),
            intentos: (prev.intentos || 0) + 1,
          }),
        60
      );
    } else if (act === 'marcar') {
      const estado = t.dataset.estado;
      setWA(key, { estado }).then((o) => tagShopify(o, estado));
      if (estado === 'confirmado') toast('Confirmado. Ya podés despacharlo.', 'good');
    } else if (act === 'deshacer') {
      const o = findOrder(key);
      App.confirm.delete(key);
      App.emit('confirm');
      Store.remove('confirmaciones/' + key).catch(storeFail);
      if (o && o.tags.some((tg) => tg === TAG_OK || tg === TAG_NO)) tagShopify(o, null);
    } else if (act === 'copiar-despacho') copyText(t.dataset.text, t);
  }

  async function onChange(ev) {
    const t = ev.target;
    if (t.id === 'conf-dias') {
      state.dias = Number(t.value);
      prefSet('conf-dias', state.dias);
      load();
    } else if (t.dataset.act === 'importar-csv' && t.files && t.files[0]) {
      try {
        Shop.importCSV(await VC.ui.readFileText(t.files[0]));
        state.error = null;
        toast('Pedidos importados del CSV.', 'good');
      } catch (err) {
        toast(err.message || 'No se pudo leer el archivo.', 'bad');
      }
      render();
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.confirmar = { mount, render, load };
})(window);
