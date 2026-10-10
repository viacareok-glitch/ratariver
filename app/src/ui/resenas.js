/* 4 · Pedidor de reseñas reales */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, chip, waButton, seg, emptyState, shopStatusBanner, toast, copyText, prefGet, prefSet, storeFail } = VC.ui;

  const R_ESTADOS = {
    pedida: { label: 'Reseña pedida', tone: 'warn' },
    recordada: { label: 'Recordatorio enviado', tone: 'warn' },
    recibida: { label: 'Reseña recibida', tone: 'good' },
    no: { label: 'No quiere', tone: 'neutral' },
  };
  const HANDLE = 'corrector-postura-viacare';

  const state = { filtro: prefGet('res-filtro', 'pedir'), editing: null, loading: false, error: null };
  let el;

  function mount(section) {
    el = section;
    el.innerHTML =
      '<header class="tool-head"><div><h2>Reseñas reales</h2><p class="lede">Cuando un pedido se entrega, escribile al cliente para pedirle su opinión y una foto usando el corrector. Guardá lo que te manda y publicalo con su permiso.</p></div>' +
      '<div class="tool-actions"><button class="btn ghost" data-act="refrescar">Actualizar</button></div></header>' +
      '<div id="res-status"></div><div id="res-summary"></div><div id="res-filters"></div><div id="res-list" class="order-list"></div><section class="panel" id="res-export"></section>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('submit', onSubmit);
    Shop.onChange(render);
    App.on((w) => (w === 'resenas' || w === 'msgs') && render());
    load();
  }

  async function load(fresh) {
    state.loading = true;
    state.error = null;
    render();
    try {
      await Shop.ensure(U.addDays(U.todayKeyAR(), -60), { fresh });
    } catch (err) {
      state.error = err;
    }
    state.loading = false;
    render();
  }

  function deliveredAt(o) {
    return o.deliveredAt || o.closedAt || o.shippedAt || o.createdAt;
  }

  function lists() {
    const since = U.addDays(U.todayKeyAR(), -60);
    const entregados = Shop.orders.filter((o) => o.estado === 'entregado' && o.day >= since).sort((a, b) => (deliveredAt(a) < deliveredAt(b) ? 1 : -1));
    const st = (o) => (App.resenas.get(o.key) || {}).estado;
    return {
      pedir: entregados.filter((o) => !st(o)),
      pedidas: entregados.filter((o) => st(o) === 'pedida' || st(o) === 'recordada'),
      recibidas: [...App.resenas.entries()].filter(([, r]) => r.estado === 'recibida').map(([k, r]) => Shop.orders.find((o) => o.key === k) || ghost(k, r)),
      todas: entregados,
    };
  }

  // Reseña guardada de un pedido que ya no está en la lista cargada
  function ghost(key, r) {
    return { key, name: r.pedido || '', fullName: r.cliente || '', firstName: r.cliente || '', city: r.ciudad || '', phone: { wa: '', display: '' }, units: 1, extras: [], total: 0, createdAt: r.pedidaEn || r.actualizado, estado: 'entregado', ghost: true };
  }

  function render() {
    if (!el) return;
    const statusEl = $('#res-status', el);
    if (Shop.mode === 'none') statusEl.innerHTML = shopStatusBanner({ message: 'Esta vista no puede conectarse a Shopify. Abrí el panel desde claude.ai o importá el CSV de pedidos.' });
    else statusEl.innerHTML = state.error ? shopStatusBanner(state.error) : '';

    const L = lists();
    const loadingFirst = (state.loading || Shop.mode === 'pending') && !Shop.loadedAt;
    const conPermiso = L.recibidas.filter((o) => (App.resenas.get(o.key) || {}).permiso);
    const conFoto = L.recibidas.filter((o) => (App.resenas.get(o.key) || {}).foto);
    const pedidasTot = [...App.resenas.values()].filter((r) => r.estado !== 'no').length;
    $('#res-summary', el).innerHTML = loadingFirst
      ? '<div class="summary-strip is-loading">Cargando pedidos entregados…</div>'
      : '<div class="summary-strip">' +
        stat(L.pedir.length, 'entregados sin pedir', L.pedir.length ? 'warn' : '') +
        stat(L.pedidas.length, 'esperando respuesta') +
        stat(L.recibidas.length, 'reseñas recibidas', L.recibidas.length ? 'good' : '') +
        stat(conFoto.length, 'con foto') +
        stat(pedidasTot ? U.pct(L.recibidas.length / pedidasTot) : '—', 'responden') +
        '</div>';

    $('#res-filters', el).innerHTML =
      '<div class="toolbar">' +
      seg(
        'res-filtro',
        [
          { value: 'pedir', label: 'Para pedir', count: L.pedir.length },
          { value: 'pedidas', label: 'Pedidas', count: L.pedidas.length },
          { value: 'recibidas', label: 'Recibidas', count: L.recibidas.length },
          { value: 'todas', label: 'Todos los entregados', count: L.todas.length },
        ],
        state.filtro
      ) +
      '<label class="field-inline" for="res-dias">Pedir a los <select id="res-dias">' +
      [2, 3, 4, 5, 7, 10].map((d) => '<option value="' + d + '"' + (d === Number(App.msgs.diasResena) ? ' selected' : '') + '>' + d + ' días</option>').join('') +
      '</select> de entregado</label></div>';

    const list = L[state.filtro] || [];
    const listEl = $('#res-list', el);
    if (loadingFirst) listEl.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    else if (!list.length)
      listEl.innerHTML = emptyState(
        'Nada por acá',
        e(
          {
            pedir: 'No hay pedidos entregados sin pedirles reseña en los últimos 60 días.',
            pedidas: 'No hay reseñas pedidas esperando respuesta.',
            recibidas: 'Todavía no cargaste reseñas. Cuando un cliente te responda, tocá “Cargar reseña” en su pedido.',
            todas: 'No hay pedidos entregados en los últimos 60 días.',
          }[state.filtro]
        )
      );
    else listEl.innerHTML = list.map(card).join('');

    renderExport(conPermiso);
  }

  function stat(value, label, tone) {
    return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><span class="stat-value">' + e(value) + '</span><span class="stat-label">' + e(label) + '</span></div>';
  }

  function card(o) {
    const r = App.resenas.get(o.key) || {};
    const vars = O.templateVars(o, App.msgs);
    const dAt = deliveredAt(o);
    const dias = Math.floor(U.hoursSince(dAt) / 24);
    const ideal = Number(App.msgs.diasResena) || 4;
    const st = R_ESTADOS[r.estado];
    const chips = [
      st ? chip(st.label, st.tone) : dias < ideal ? chip('Ideal en ' + (ideal - dias) + (ideal - dias === 1 ? ' día' : ' días'), 'neutral') : chip('Listo para pedir', 'info'),
      r.foto ? chip('Con foto', 'good') : '',
      r.estado === 'recibida' && !r.permiso ? chip('Sin permiso para publicar', 'warn') : '',
    ].join('');
    const msg = U.fillTemplate(App.msgs.resena, vars);
    const rec = U.fillTemplate(App.msgs.resenaRecordatorio, vars);
    const editing = state.editing === o.key;
    return (
      '<article class="order-card' +
      (r.estado === 'recibida' ? ' is-good' : '') +
      '"><div class="oc-top"><div class="oc-id"><span class="mono">' +
      e(o.name) +
      '</span><span class="muted">' +
      (o.ghost ? '' : 'Entregado ' + e(U.timeAgo(dAt))) +
      '</span></div>' +
      (r.estrellas ? '<div class="stars" aria-label="' + r.estrellas + ' estrellas">' + '★'.repeat(r.estrellas) + '<span class="muted">' + '★'.repeat(5 - r.estrellas) + '</span></div>' : '') +
      '</div><div class="oc-who"><strong>' +
      e(o.fullName || 'Sin nombre') +
      '</strong>' +
      (o.city ? ' · ' + e(o.city) : '') +
      (o.ghost ? '' : ' · ' + e(vars.cantidad)) +
      '</div>' +
      (o.phone.display ? '<div class="oc-phone"><span class="mono selectable">' + e(o.phone.display) + '</span>' + (r.pedidaEn ? '<span class="muted">Pedida ' + e(U.timeAgo(r.pedidaEn)) + '</span>' : '') + '</div>' : '') +
      '<div class="chips">' +
      chips +
      '</div>' +
      (r.texto && !editing ? '<blockquote class="review">“' + e(r.texto) + '”<footer>— ' + e(r.nombre || '') + (r.ciudad ? ', ' + e(r.ciudad) : '') + '</footer></blockquote>' : '') +
      (editing
        ? form(o, r)
        : '<div class="oc-actions"><div class="row-actions">' +
          (r.estado !== 'recibida' && !o.ghost
            ? waButton(U.waLink(o.phone.wa, msg), r.estado ? 'Volver a pedir' : 'Pedir reseña', 'wa-resena', o.key, r.estado ? 'ghost' : 'wa') +
              (r.estado === 'pedida' ? waButton(U.waLink(o.phone.wa, rec), 'Recordatorio', 'wa-recordatorio', o.key, 'ghost') : '')
            : '') +
          '</div><div class="row-actions decide"><button class="btn ghost" data-act="cargar" data-key="' +
          e(o.key) +
          '">' +
          (r.estado === 'recibida' ? 'Editar reseña' : 'Cargar reseña') +
          '</button>' +
          (r.estado !== 'recibida' && r.estado !== 'no' ? '<button class="btn link" data-act="no-quiere" data-key="' + e(o.key) + '">No quiere</button>' : '') +
          (r.estado ? '<button class="btn link" data-act="deshacer" data-key="' + e(o.key) + '">Deshacer</button>' : '') +
          '</div></div>') +
      '</article>'
    );
  }

  function form(o, r) {
    const k = e(o.key);
    const defName = r.nombre || (U.firstName(o.firstName) + (o.lastName ? ' ' + U.capitalizeName(o.lastName).charAt(0) + '.' : ''));
    return (
      '<form class="review-form" data-key="' +
      k +
      '"><div class="form-grid"><label for="rv-estrellas-' +
      k +
      '">Estrellas<select id="rv-estrellas-' +
      k +
      '" name="estrellas">' +
      [5, 4, 3, 2, 1].map((n) => '<option value="' + n + '"' + (Number(r.estrellas || 5) === n ? ' selected' : '') + '>' + n + '</option>').join('') +
      '</select></label><label for="rv-nombre-' +
      k +
      '">Nombre a mostrar<input id="rv-nombre-' +
      k +
      '" name="nombre" value="' +
      e(defName) +
      '"></label><label for="rv-ciudad-' +
      k +
      '">Ciudad<input id="rv-ciudad-' +
      k +
      '" name="ciudad" value="' +
      e(r.ciudad || o.city || '') +
      '"></label></div><label for="rv-texto-' +
      k +
      '">Lo que escribió (copialo tal cual)<textarea id="rv-texto-' +
      k +
      '" name="texto" rows="3" required>' +
      e(r.texto || '') +
      '</textarea></label><div class="checks"><label for="rv-foto-' +
      k +
      '"><input type="checkbox" id="rv-foto-' +
      k +
      '" name="foto"' +
      (r.foto ? ' checked' : '') +
      '> Mandó foto</label><label for="rv-permiso-' +
      k +
      '"><input type="checkbox" id="rv-permiso-' +
      k +
      '" name="permiso"' +
      (r.permiso ? ' checked' : '') +
      '> Dio permiso para publicarla</label></div><div class="row-actions"><button class="btn" type="submit">Guardar reseña</button><button class="btn link" type="button" data-act="cancelar-form">Cancelar</button></div></form>'
    );
  }

  function renderExport(list) {
    const box = $('#res-export', el);
    if (!list.length) {
      box.innerHTML =
        '<h3>Para publicar</h3><p class="muted">Las reseñas con permiso aparecen acá para copiarlas a tu app de reseñas. Las fotos las guardás desde WhatsApp y las subís a mano.</p>';
      return;
    }
    const rows = list.map((o) => {
      const r = App.resenas.get(o.key);
      const words = String(r.texto || '').split(/\s+/);
      return {
        product_handle: HANDLE,
        rating: r.estrellas || 5,
        title: words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : ''),
        body: r.texto || '',
        reviewer_name: r.nombre || '',
        reviewer_location: r.ciudad || '',
        review_date: (r.actualizado || '').slice(0, 10),
        foto: r.foto ? 'sí' : 'no',
        pedido: r.pedido || o.name,
      };
    });
    const headers = ['product_handle', 'rating', 'title', 'body', 'reviewer_name', 'reviewer_location', 'review_date', 'foto', 'pedido'];
    const csv = U.toCSV(headers, rows);
    box.innerHTML =
      '<div class="panel-head"><h3>Para publicar (' +
      list.length +
      ')</h3><button class="btn" data-act="copiar-csv">Copiar CSV</button></div><p class="muted small">Reseñas con permiso. Revisá que las columnas coincidan con las que pide tu app de reseñas antes de importarlas.</p><pre class="code-block selectable" id="res-csv">' +
      e(csv) +
      '</pre>';
    box.dataset.csv = csv;
  }

  async function setR(key, patch) {
    const o = Shop.orders.find((x) => x.key === key);
    const prev = App.resenas.get(key) || {};
    const next = Object.assign({}, prev, patch, { actualizado: new Date().toISOString() });
    if (o) {
      next.pedido = o.name;
      next.cliente = o.fullName;
    }
    App.resenas.set(key, next);
    App.emit('resenas');
    try {
      await Store.set('resenas/' + key, next);
    } catch (err) {
      storeFail(err);
    }
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act], [data-seg]');
    if (!t || !el.contains(t)) return;
    if (t.dataset.seg === 'res-filtro') {
      state.filtro = t.dataset.value;
      prefSet('res-filtro', state.filtro);
      render();
      return;
    }
    const key = t.dataset.key;
    switch (t.dataset.act) {
      case 'refrescar':
      case 'reintentar':
        load(true);
        break;
      case 'permisos':
        VC.runtime.managePermissions();
        break;
      case 'wa-resena': {
        const prev = App.resenas.get(key) || {};
        setTimeout(() => setR(key, { estado: prev.estado === 'recibida' ? 'recibida' : 'pedida', pedidaEn: new Date().toISOString() }), 60);
        break;
      }
      case 'wa-recordatorio':
        setTimeout(() => setR(key, { estado: 'recordada', recordadaEn: new Date().toISOString() }), 60);
        break;
      case 'cargar':
        state.editing = key;
        render();
        break;
      case 'cancelar-form':
        state.editing = null;
        render();
        break;
      case 'no-quiere':
        setR(key, { estado: 'no' });
        break;
      case 'deshacer':
        App.resenas.delete(key);
        App.emit('resenas');
        Store.remove('resenas/' + key).catch(storeFail);
        break;
      case 'copiar-csv':
        copyText($('#res-export', el).dataset.csv || '', t);
        break;
    }
  }

  function onSubmit(ev) {
    const f = ev.target.closest('.review-form');
    if (!f) return;
    ev.preventDefault();
    const fd = new FormData(f);
    const texto = String(fd.get('texto') || '').trim();
    if (!texto) {
      toast('Escribí lo que te mandó el cliente.', 'warn');
      return;
    }
    setR(f.dataset.key, {
      estado: 'recibida',
      estrellas: Number(fd.get('estrellas')) || 5,
      nombre: String(fd.get('nombre') || '').trim(),
      ciudad: String(fd.get('ciudad') || '').trim(),
      texto,
      foto: fd.get('foto') === 'on',
      permiso: fd.get('permiso') === 'on',
    });
    state.editing = null;
    toast('Reseña guardada.', 'good');
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.id === 'res-dias') {
      App.msgs.diasResena = Number(t.value);
      App.saveMsgs();
      render();
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
  VC.tools.resenas = { mount, render, load };
})(window);
