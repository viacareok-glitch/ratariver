/* Ofertas: qué promo deja más plata por pedido */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const P = VC.profit;
  const OF = VC.offers;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, chip, banner, storeFail, icon, bubble, pageHead, info, more } = VC.ui;

  const state = {
    items: OF.DEFAULT_OFERTAS.map((o) => Object.assign({}, o)),
    cpa: null, // null = usar el real de los últimos 7 días
    envioExtra: 0,
    gastos: {},
  };
  let el;

  function mount(section) {
    el = section;
    el.innerHTML =
      pageHead('Ofertas', '¿Qué promo te deja más plata?') +
      '<div id="of-warn"></div><div id="of-best"></div>' +
      '<section class="panel of-params" id="of-params"></section>' +
      '<section class="panel of-edit" id="of-rows"></section>' +
      '<section class="panel of-res"><div class="panel-head"><div class="panel-title">' +
      bubble('chart') +
      '<h3>Cuánto deja cada una</h3>' +
      info('Ganancia promedio por cada pedido que entra, después de publicidad, pedidos anulados y devoluciones.') +
      '</div></div><div id="of-results"></div>' +
      more('Ver el detalle', '<div id="of-detail"></div>', 'of-more-detalle') +
      more('¿Y si la publicidad sube o baja?', '<div id="of-sens"></div>', 'of-more-sens') +
      '</section>';
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('click', onClick);
    App.on((w) => (w === 'cfg' || w === 'tienda') && renderAll());
    Shop.onChange(() => renderResults());
    Store.watch('gastos', (m) => {
      state.gastos = Object.fromEntries(m);
      renderParams();
      renderResults();
    });
    Store.get('config/ofertas').then((d) => {
      if (d && Array.isArray(d.items) && d.items.length) {
        state.items = d.items;
        state.cpa = d.cpa == null ? null : d.cpa;
        state.envioExtra = d.envioExtra || 0;
      } else {
        // Precios de la tienda como punto de partida
        const p1 = Number(App.tienda.precio1) || 68990;
        const p2 = Number(App.tienda.precio2) || 72990;
        state.items = OF.DEFAULT_OFERTAS.map((o) => Object.assign({}, o, { precio: o.id === 'dos' ? p2 : o.id === '3x2' ? p1 * 2 : p1 }));
      }
      renderAll();
    });
    Shop.ensure(U.addDays(U.todayKeyAR(), -7)).catch(() => {});
    renderAll();
  }

  const save = VC.ui.debounce(() => Store.set('config/ofertas', JSON.parse(JSON.stringify({ items: state.items, cpa: state.cpa, envioExtra: state.envioExtra }))).catch(storeFail), 800);

  /* CPA real: gasto en anuncios de los últimos 7 días ÷ pedidos que entraron en esos días. */
  function cpaReal() {
    const hoy = U.todayKeyAR();
    const desde = U.addDays(hoy, -6);
    let ads = 0;
    for (const d of U.dayRange(desde, hoy)) ads += P.spendOf(state.gastos[d]).total;
    const pedidos = Shop.orders.filter((o) => o.day >= desde && o.day <= hoy).length;
    return ads > 0 && pedidos ? { cpa: ads / pedidos, ads, pedidos } : null;
  }

  function cpaActual() {
    if (state.cpa != null) return { valor: state.cpa, origen: 'manual' };
    const r = cpaReal();
    if (r) return { valor: r.cpa, origen: 'real', detalle: r };
    return { valor: 15000, origen: 'supuesto' };
  }

  function renderAll() {
    if (!el) return;
    $('#of-warn', el).innerHTML = P.costsReady(App.cfg) ? '' : banner('warn', '<strong>Faltan tus costos.</strong> Sin el costo del corrector y del envío, la cuenta no sirve.', '<button class="btn" data-goto="ajustes">Cargar costos</button>');
    renderParams();
    renderRows();
    renderResults();
  }

  function moneyField(id, label, value, help, extra) {
    return (
      '<div class="of-field"><div class="of-flabel"><label for="' +
      id +
      '">' +
      e(label) +
      '</label>' +
      (help ? info(help) : '') +
      '</div><span class="input-unit"><span class="unit">$</span><input id="' +
      id +
      '" inputmode="numeric" value="' +
      e(value) +
      '" placeholder="0"></span>' +
      (extra || '') +
      '</div>'
    );
  }

  function renderParams(force) {
    const box = $('#of-params', el);
    if (!box || (!force && box.contains(document.activeElement))) return;
    const c = cpaActual();
    const cfg = P.normalizeCfg(App.cfg);
    const origen =
      c.origen === 'real'
        ? chip('Real · 7 días', 'good') + info('Gastaste ' + e(U.money(c.detalle.ads)) + ' en anuncios y entraron ' + c.detalle.pedidos + ' pedidos en los últimos 7 días.')
        : c.origen === 'manual'
          ? chip('A mano', 'info') + ' <button class="btn link sm" data-act="cpa-real">Usar el real</button>'
          : chip('Supuesto', 'warn') + info('Cargá el gasto diario en Ganancia para usar el real, o escribí acá lo que te cuesta cada pedido.');
    const costos = ['Corrector ' + U.money(cfg.costoUnidad), 'envío ' + U.money(cfg.costoEnvio), 'devolución ' + U.money(cfg.costoDevolucion)];
    if (cfg.comisionCobro) costos.push('comisión ' + String(cfg.comisionCobro).replace('.', ',') + '%');
    box.innerHTML =
      '<div class="of-params-row">' +
      moneyField('of-cpa', 'Publicidad por pedido', U.int(c.valor), '', '<div class="of-origen">' + origen + '</div>') +
      moneyField('of-envio', 'Envío extra', state.envioExtra ? U.int(state.envioExtra) : '', 'Lo que suma el envío por cada unidad de más en el mismo paquete.') +
      '<div class="of-field of-costos"><span class="of-flabel">Tus costos</span><p class="of-costos-txt">' +
      e(costos.join(' · ')) +
      '</p><button class="btn link sm" data-goto="ajustes">Editar en Ajustes' +
      icon('arrowRight') +
      '</button></div></div>';
  }

  function renderRows() {
    const box = $('#of-rows', el);
    if (!box) return;
    const quitar = state.items.length > 2;
    box.innerHTML =
      '<div class="panel-head"><div class="panel-title">' +
      bubble('tag', 'peach') +
      '<h3>Tus ofertas</h3>' +
      info('<strong>Más pedidos:</strong> si creés que la promo trae más pedidos con la misma plata en publicidad (por ejemplo +25 %), cargalo y el costo por pedido baja en esa proporción. La primera oferta es la base.') +
      '</div><button class="btn soft sm" data-act="agregar">' +
      icon('plus') +
      'Agregar oferta</button></div>' +
      '<div class="of-table"><div class="of-row of-head" aria-hidden="true"><span>Oferta</span><span>Unidades</span><span>Cobrás en total</span><span>Costo regalo</span><span>Más pedidos</span><span></span></div>' +
      state.items
        .map(
          (o, i) =>
            '<div class="of-row">' +
            field(i, 'n', 'nombre', 'Oferta', '<input id="of-n-' + i + '" data-i="' + i + '" data-k="nombre" value="' + e(o.nombre) + '">') +
            field(i, 'u', 'unidades', 'Unidades', '<input id="of-u-' + i + '" class="num-input" data-i="' + i + '" data-k="unidades" inputmode="numeric" value="' + e(o.unidades) + '">') +
            field(i, 'p', 'precio', 'Cobrás en total', '<span class="input-unit"><span class="unit">$</span><input id="of-p-' + i + '" data-i="' + i + '" data-k="precio" inputmode="numeric" value="' + e(U.int(o.precio)) + '"></span>') +
            field(i, 'x', 'extra', 'Costo regalo', '<span class="input-unit"><span class="unit">$</span><input id="of-x-' + i + '" data-i="' + i + '" data-k="extra" inputmode="numeric" value="' + e(o.extra ? U.int(o.extra) : '') + '" placeholder="0"></span>') +
            (i === 0
              ? '<div class="of-f of-f-l"><span class="of-lbl">Más pedidos</span><span class="of-base">Base</span></div>'
              : field(i, 'l', 'lift', 'Más pedidos', '<span class="input-unit"><input id="of-l-' + i + '" data-i="' + i + '" data-k="lift" inputmode="decimal" value="' + e(o.lift ? String(o.lift).replace('.', ',') : '') + '" placeholder="0"><span class="unit is-after">%</span></span>')) +
            '<div class="of-del">' +
            (quitar ? '<button class="btn ghost icon-only sm" data-act="quitar" data-i="' + i + '" aria-label="Quitar ' + e(o.nombre) + '" title="Quitar">' + icon('trash') + '</button>' : '') +
            '</div></div>'
        )
        .join('') +
      '</div>';
  }

  function field(i, code, k, label, control) {
    return '<label class="of-f of-f-' + code + '" for="of-' + code + '-' + i + '"><span class="of-lbl">' + e(label) + '</span>' + control + '</label>';
  }

  function computed() {
    const rates = O.historicalRates(Shop.orders);
    return OF.compare(state.items, App.cfg, rates, cpaActual().valor, state.envioExtra);
  }

  function renderBest(evs) {
    const box = $('#of-best', el);
    if (!box) return;
    const best = evs.find((x) => x.mejor);
    if (!best) {
      box.innerHTML = '';
      return;
    }
    const cpa = 'Con ' + U.money(cpaActual().valor) + ' de publicidad por pedido';
    if (best.ganancia <= 0) {
      box.innerHTML =
        '<section class="of-hero tone-bad">' +
        bubble('alert', 'bad') +
        '<div class="of-hero-main"><span class="of-hero-eyebrow">Ninguna deja ganancia</span><strong class="of-hero-name">Todas pierden plata</strong><span class="of-hero-sub">' +
        e(cpa) +
        '. Probá subir el precio o bajar costos.</span></div><div class="of-hero-num"><span class="of-hero-value">' +
        e(U.money(best.ganancia)) +
        '</span><span class="of-hero-label">la menos mala</span></div></section>';
      return;
    }
    const base = evs[0];
    const sub = best === base ? 'Es tu oferta base. ' + cpa + '.' : U.money(best.vsBase) + ' más por pedido que ' + base.oferta.nombre + '.';
    box.innerHTML =
      '<section class="of-hero">' +
      bubble('trending', 'good') +
      '<div class="of-hero-main"><span class="of-hero-eyebrow">La que más deja</span><strong class="of-hero-name">' +
      e(best.oferta.nombre) +
      '</strong><span class="of-hero-sub">' +
      e(sub) +
      '</span></div><div class="of-hero-num"><span class="of-hero-value">' +
      e(U.money(best.ganancia)) +
      '</span><span class="of-hero-label">por pedido</span></div></section>';
  }

  function renderResults() {
    const box = $('#of-results', el);
    if (!box) return;
    const { evs } = computed();
    renderBest(evs);
    const max = Math.max(1, ...evs.map((x) => Math.abs(x.ganancia)));
    box.innerHTML =
      '<ul class="of-bars">' +
      evs
        .map(
          (x) =>
            '<li' +
            (x.mejor ? ' class="is-best"' : '') +
            '><span class="ob-name">' +
            e(x.oferta.nombre) +
            (x.mejor ? ' ' + chip('Mejor', 'good') : '') +
            '</span><span class="wf-track"><span class="wf-bar ' +
            (x.ganancia >= 0 ? 'pos' : 'neg') +
            '" style="width:' +
            Math.max(1, (Math.abs(x.ganancia) / max) * 100).toFixed(1) +
            '%"></span></span><span class="ob-val mono ' +
            (x.ganancia >= 0 ? 'pos' : 'neg') +
            '">' +
            e(U.money(x.ganancia)) +
            '</span></li>'
        )
        .join('') +
      '</ul>';
    renderDetail(evs);
    renderSens();
  }

  function renderDetail(evs) {
    const box = $('#of-detail', el);
    if (!box) return;
    const mix = OF.unitMix(Shop.orders);
    box.innerHTML =
      '<div class="table-wrap"><table class="table of-detail"><thead><tr><th>Oferta</th><th class="num">Por unidad</th><th class="num">Si se entrega</th><th class="num">Por pedido</th><th class="num">vs. ' +
      e(evs[0].oferta.nombre) +
      '</th><th>Para empatar</th></tr></thead><tbody>' +
      evs
        .map(
          (x, i) =>
            '<tr' +
            (x.mejor ? ' class="is-winner"' : '') +
            '><th scope="row">' +
            e(x.oferta.nombre) +
            '</th><td class="num">' +
            e(U.money(x.precioUnidad)) +
            '</td><td class="num">' +
            e(U.money(x.margenEntrega)) +
            '</td><td class="num ' +
            (x.ganancia >= 0 ? 'pos' : 'neg') +
            '">' +
            e(U.money(x.ganancia)) +
            '</td><td class="num">' +
            (i === 0 ? '—' : e((x.vsBase >= 0 ? '+' : '') + U.money(x.vsBase))) +
            '</td><td class="small">' +
            (i === 0 ? '<span class="muted">Base</span>' : liftText(x)) +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table></div>' +
      (mix.n ? '<p class="note">' + icon('box') + ' En tu historial, ' + U.pct(mix.dos) + ' de los entregados llevó 2 unidades' + (mix.tresOMas ? ' y ' + U.pct(mix.tresOMas) + ' llevó 3 o más' : '') + ' (' + mix.n + ' pedidos).</p>' : '');
  }

  function liftText(x) {
    if (x.liftNecesario == null) return '<span class="neg">No empata ni con publicidad gratis</span>';
    if (x.liftNecesario <= 0) return '<span class="pos">Gana aunque venda ' + e(U.pct(-x.liftNecesario)) + ' menos</span>';
    return e(U.pct(x.liftNecesario)) + ' más pedidos';
  }

  function renderSens() {
    const box = $('#of-sens', el);
    if (!box) return;
    const base = cpaActual().valor;
    const niveles = [0.5, 0.75, 1, 1.25, 1.5].map((f) => Math.round((base * f) / 500) * 500);
    const rates = O.historicalRates(Shop.orders);
    const filas = state.items.map((o) => niveles.map((cpa) => OF.evaluate(o, App.cfg, rates, cpa, state.envioExtra).ganancia));
    const bestCol = niveles.map((_, j) => filas.reduce((bi, f, i) => (f[j] > filas[bi][j] ? i : bi), 0));
    box.innerHTML =
      '<p class="note">Ganancia por pedido según cuánto te cueste cada pedido en publicidad. En verde, la mejor en cada caso.</p><div class="table-wrap"><table class="table of-sens"><thead><tr><th>Oferta</th>' +
      niveles.map((n, j) => '<th class="num' + (j === 2 ? ' is-now' : '') + '">' + e(U.moneyShort(n)) + '</th>').join('') +
      '</tr></thead><tbody>' +
      filas
        .map(
          (f, i) =>
            '<tr><th scope="row">' +
            e(state.items[i].nombre) +
            '</th>' +
            f.map((v, j) => '<td class="num ' + (v >= 0 ? '' : 'neg') + (bestCol[j] === i ? ' is-best-cell' : '') + '">' + e(U.moneyShort(v)) + '</td>').join('') +
            '</tr>'
        )
        .join('') +
      '</tbody></table></div>';
  }

  function onInput(ev) {
    const t = ev.target;
    if (t.id === 'of-cpa') {
      const v = U.parseMoney(t.value);
      state.cpa = v != null ? v : null;
      save();
      renderResults();
    } else if (t.id === 'of-envio') {
      state.envioExtra = U.parseMoney(t.value) || 0;
      save();
      renderResults();
    } else if (t.dataset.i != null && t.dataset.k) {
      const o = state.items[Number(t.dataset.i)];
      const k = t.dataset.k;
      o[k] = k === 'nombre' ? t.value : k === 'lift' ? U.parseNum(t.value) || 0 : k === 'unidades' ? Math.max(1, Math.round(U.parseMoney(t.value) || 1)) : U.parseMoney(t.value) || 0;
      save();
      renderResults();
    }
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.dataset.k === 'precio' || t.dataset.k === 'extra') {
      const v = U.parseMoney(t.value);
      t.value = v ? U.int(v) : '';
    } else if (t.id === 'of-cpa') renderParams();
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    if (t.dataset.act === 'agregar') {
      state.items.push({ id: 'o' + Date.now().toString(36), nombre: 'Nueva oferta', unidades: 1, precio: Number(App.tienda.precio1) || 68990, extra: 0, lift: 0 });
      save();
      renderRows();
      renderResults();
      const n = $('#of-n-' + (state.items.length - 1), el);
      if (n) n.focus();
    } else if (t.dataset.act === 'quitar') {
      state.items.splice(Number(t.dataset.i), 1);
      save();
      renderRows();
      renderResults();
    } else if (t.dataset.act === 'cpa-real') {
      state.cpa = null;
      save();
      renderParams(true);
      renderResults();
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.ofertas = { mount, render: renderAll };
})(window);
