/* 4 · Pedidor de reseñas reales */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, chip, waButton, seg, emptyState, shopStatusBanner, toast, copyText, prefGet, prefSet, storeFail, icon, bubble, pageHead, info, more, toggle } = VC.ui;

  const R_ESTADOS = {
    pedida: { label: 'Pedida', tone: 'warn' },
    recordada: { label: 'Recordatorio enviado', tone: 'warn' },
    recibida: { label: 'Recibida', tone: 'good' },
    no: { label: 'No quiere', tone: 'neutral' },
  };
  const HANDLE = 'corrector-postura-viacare';

  const state = { filtro: prefGet('res-filtro', 'pedir'), editing: null, loading: false, error: null };
  let el;

  function mount(section) {
    el = section;
    el.innerHTML =
      pageHead(
        'Reseñas',
        'Pedí su opinión a quien ya recibió su pedido.',
        '<button class="btn ghost icon-only" data-act="refrescar" aria-label="Actualizar pedidos" title="Actualizar">' + icon('refresh') + '</button>'
      ) +
      '<div id="res-status"></div><div id="res-summary"></div><div id="res-filters"></div><div id="res-list" class="order-list"></div><section class="panel" id="res-export"></section>' +
      '<div class="res-foot">' +
      more(
        'Opciones',
        '<div class="res-opts"><label class="field-inline" for="res-dias">Pedirla a los <select id="res-dias">' +
          [2, 3, 4, 5, 7, 10].map((d) => '<option value="' + d + '">' + d + ' días</option>').join('') +
          '</select> de entregado</label><button class="btn link" data-goto="ajustes">Editar el mensaje</button></div>',
        'res-opciones'
      ) +
      '</div>';
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
    if (Shop.mode === 'none') statusEl.innerHTML = shopStatusBanner({ message: 'Abrí el panel desde claude.ai para ver tus pedidos, o importá el CSV de Shopify.' });
    else statusEl.innerHTML = state.error ? shopStatusBanner(state.error) : '';

    const dias = $('#res-dias', el);
    if (dias && document.activeElement !== dias) dias.value = String(Number(App.msgs.diasResena) || 4);

    const L = lists();
    const loadingFirst = (state.loading || Shop.mode === 'pending') && !Shop.loadedAt;
    const conPermiso = L.recibidas.filter((o) => (App.resenas.get(o.key) || {}).permiso);
    const conFoto = L.recibidas.filter((o) => (App.resenas.get(o.key) || {}).foto);
    const pedidasTot = [...App.resenas.values()].filter((r) => r.estado !== 'no').length;
    $('#res-summary', el).innerHTML = loadingFirst
      ? '<div class="summary-strip is-loading">Cargando entregas…</div>'
      : '<div class="summary-strip">' +
        stat(L.pedir.length, 'para pedir', L.pedir.length ? 'warn' : '') +
        stat(L.pedidas.length, 'esperando respuesta') +
        stat(L.recibidas.length, conFoto.length ? 'recibidas · ' + conFoto.length + ' con foto' : 'recibidas', L.recibidas.length ? 'good' : '') +
        stat(pedidasTot ? U.pct(L.recibidas.length / pedidasTot) : '—', 'responden') +
        '</div>';

    $('#res-filters', el).innerHTML = seg(
      'res-filtro',
      [
        { value: 'pedir', label: 'Para pedir', count: L.pedir.length },
        { value: 'pedidas', label: 'Pedidas', count: L.pedidas.length },
        { value: 'recibidas', label: 'Recibidas', count: L.recibidas.length },
        { value: 'todas', label: 'Todas', count: L.todas.length },
      ],
      state.filtro
    );

    const list = L[state.filtro] || [];
    const listEl = $('#res-list', el);
    if (loadingFirst) listEl.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    else if (!list.length) listEl.innerHTML = emptyText(L);
    else listEl.innerHTML = list.map(card).join('');

    renderExport(conPermiso);
  }

  function stat(value, label, tone) {
    return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><span class="stat-value">' + e(value) + '</span><span class="stat-label">' + e(label) + '</span></div>';
  }

  function emptyText(L) {
    const sinEntregas = ['Sin entregas', 'No hubo entregas en los últimos 60 días.', 'box'];
    const m = {
      pedir: L.todas.length ? ['Todo al día', 'Ya les pediste reseña a todos.', 'check'] : sinEntregas,
      pedidas: ['Nadie esperando', 'No hay reseñas pedidas sin respuesta.', 'clock'],
      recibidas: ['Sin reseñas todavía', 'Cuando te respondan, tocá “Cargar reseña”.', 'star'],
      todas: sinEntregas,
    }[state.filtro] || sinEntregas;
    return emptyState(m[0], e(m[1]), '', m[2]);
  }

  function stars(n) {
    let html = '<span class="res-stars" role="img" aria-label="' + n + ' de 5 estrellas">';
    for (let i = 1; i <= 5; i++) html += icon('star', i <= n ? 'is-on' : '');
    return html + '</span>';
  }

  function card(o) {
    const r = App.resenas.get(o.key) || {};
    const vars = O.templateVars(o, App.msgs);
    const dAt = deliveredAt(o);
    const dias = Math.floor(U.hoursSince(dAt) / 24);
    const ideal = Number(App.msgs.diasResena) || 4;
    const st = R_ESTADOS[r.estado];
    const chips = [
      // "Recibida" no lleva chip: ya lo dicen la cita y el borde verde
      st ? (r.estado === 'recibida' ? '' : chip(st.label, st.tone)) : dias < ideal ? chip('Ideal en ' + (ideal - dias) + (ideal - dias === 1 ? ' día' : ' días'), 'neutral') : '',
      r.foto ? chip('Con foto', 'good') : '',
      r.estado === 'recibida' && !r.permiso ? chip('Sin permiso', 'warn') : '',
    ].join('');
    const meta = [
      o.city ? e(o.city) : '',
      o.name ? '<span class="mono">' + e(o.name) + '</span>' : '',
      o.ghost ? '' : 'entregado ' + e(U.timeAgo(dAt)),
      r.pedidaEn && r.estado !== 'recibida' ? 'pedida ' + e(U.timeAgo(r.pedidaEn)) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const msg = U.fillTemplate(App.msgs.resena, vars);
    const rec = U.fillTemplate(App.msgs.resenaRecordatorio, vars);
    const editing = state.editing === o.key;
    const k = e(o.key);
    let wa = '';
    if (r.estado !== 'recibida' && !o.ghost) {
      if (!r.estado) wa = waButton(U.waLink(o.phone.wa, msg), 'Pedir reseña', 'wa-resena', o.key, 'wa');
      else if (r.estado === 'pedida') wa = waButton(U.waLink(o.phone.wa, rec), 'Recordatorio', 'wa-recordatorio', o.key, 'wa') + waButton(U.waLink(o.phone.wa, msg), 'Volver a pedir', 'wa-resena', o.key, 'ghost');
      else wa = waButton(U.waLink(o.phone.wa, msg), 'Volver a pedir', 'wa-resena', o.key, 'ghost');
    }
    return (
      '<article class="order-card res-card' +
      (r.estado === 'recibida' ? ' is-good' : '') +
      '"><div class="oc-top"><div class="oc-who"><strong>' +
      e(o.fullName || 'Sin nombre') +
      '</strong></div><div class="chips">' +
      chips +
      '</div></div><div class="oc-meta muted small">' +
      meta +
      '</div>' +
      (r.texto && !editing
        ? '<figure class="res-quote">' +
          stars(Number(r.estrellas) || 5) +
          '<blockquote>“' +
          e(r.texto) +
          '”</blockquote><figcaption>' +
          e([r.nombre, r.ciudad].filter(Boolean).join(', ')) +
          '</figcaption></figure>'
        : '') +
      (editing
        ? form(o, r)
        : '<div class="oc-actions">' +
          (wa ? '<div class="row-actions">' + wa + '</div>' : '') +
          '<div class="row-actions decide"><button class="btn ghost sm" data-act="cargar" data-key="' +
          k +
          '">' +
          icon('star') +
          (r.estado === 'recibida' ? 'Editar reseña' : 'Cargar reseña') +
          '</button>' +
          (r.estado !== 'recibida' && r.estado !== 'no' ? '<button class="btn link" data-act="no-quiere" data-key="' + k + '">No quiere</button>' : '') +
          (r.estado ? '<button class="btn link" data-act="deshacer" data-key="' + k + '">Deshacer</button>' : '') +
          '</div></div>') +
      '</article>'
    );
  }

  function form(o, r) {
    const k = e(o.key);
    const defName = r.nombre || U.firstName(o.firstName) + (o.lastName ? ' ' + U.capitalizeName(o.lastName).charAt(0) + '.' : '');
    const actual = Number(r.estrellas) || 5;
    let picker = '<div class="rv-stars" role="radiogroup" aria-label="Estrellas">';
    // De 5 a 1: con row-reverse se ven de 1 a 5 y el "~" pinta las anteriores
    for (let n = 5; n >= 1; n--)
      picker +=
        '<input type="radio" id="rv-st-' +
        k +
        '-' +
        n +
        '" name="estrellas" value="' +
        n +
        '"' +
        (n === actual ? ' checked' : '') +
        '><label for="rv-st-' +
        k +
        '-' +
        n +
        '" title="' +
        n +
        (n === 1 ? ' estrella' : ' estrellas') +
        '">' +
        icon('star') +
        '<span class="sr-only">' +
        n +
        (n === 1 ? ' estrella' : ' estrellas') +
        '</span></label>';
    picker += '</div>';
    return (
      '<form class="res-form" data-key="' +
      k +
      '"><div class="rf-row"><span class="rf-title">Cargar reseña</span>' +
      picker +
      '</div><label class="rf-field" for="rv-texto-' +
      k +
      '">Lo que escribió<textarea id="rv-texto-' +
      k +
      '" name="texto" rows="3" required placeholder="Copialo tal cual">' +
      e(r.texto || '') +
      '</textarea></label><div class="rf-grid"><label class="rf-field" for="rv-nombre-' +
      k +
      '">Nombre a mostrar<input id="rv-nombre-' +
      k +
      '" name="nombre" value="' +
      e(defName) +
      '"></label><label class="rf-field" for="rv-ciudad-' +
      k +
      '">Ciudad<input id="rv-ciudad-' +
      k +
      '" name="ciudad" value="' +
      e(r.ciudad || o.city || '') +
      '"></label></div><div class="rf-checks">' +
      toggle('rv-foto-' + o.key, !!r.foto, 'Mandó foto', 'name="foto"') +
      toggle('rv-permiso-' + o.key, !!r.permiso, 'Puedo publicarla', 'name="permiso"') +
      '</div><div class="row-actions"><button class="btn" type="submit">Guardar</button><button class="btn link" type="button" data-act="cancelar-form">Cancelar</button></div></form>'
    );
  }

  function renderExport(list) {
    const box = $('#res-export', el);
    const head = (extra) =>
      '<div class="panel-head"><div class="panel-title">' +
      bubble('upload', 'good') +
      '<h3>Para publicar</h3>' +
      (list.length ? chip(String(list.length), 'good') : '') +
      info('Las reseñas con permiso, en CSV para importar en tu app de reseñas. Revisá que las columnas coincidan. Las fotos las bajás de WhatsApp y las subís a mano.') +
      '</div>' +
      (extra || '') +
      '</div>';
    if (!list.length) {
      box.innerHTML = head() + '<p class="note">Las reseñas con permiso aparecen acá, listas para copiar.</p>';
      delete box.dataset.csv;
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
    const prev = $('#res-csv-more', box);
    const wasOpen = !!(prev && prev.open);
    box.innerHTML =
      head('<button class="btn" data-act="copiar-csv">' + icon('copy') + '<span>Copiar CSV</span></button>') +
      more('Ver el CSV', '<pre class="code-block selectable" id="res-csv">' + e(csv) + '</pre>', 'res-csv-more');
    if (wasOpen) $('#res-csv-more', box).open = true;
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

  async function copiarCSV(btn) {
    const ok = await copyText($('#res-export', el).dataset.csv || '');
    const label = btn.querySelector('span');
    if (!ok || !label) return;
    label.textContent = 'Copiado';
    setTimeout(() => (label.textContent = 'Copiar CSV'), 1600);
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
        {
          const ta = el.querySelector('.res-form textarea');
          if (ta) ta.focus();
        }
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
        copiarCSV(t);
        break;
    }
  }

  function onSubmit(ev) {
    const f = ev.target.closest('.res-form');
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
