/* Calculadora de ofertas */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const P = VC.profit;
  const OF = VC.offers;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, chip, banner, storeFail } = VC.ui;

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
      '<header class="tool-head"><div><h2>Calculadora de ofertas</h2><p class="lede">Compará cuánto te deja cada promo con tus costos reales, los pedidos que se anulan y lo que pagás por cada venta en publicidad.</p></div></header>' +
      '<div id="of-warn"></div><section class="panel" id="of-params"></section><section class="panel" id="of-rows"></section><section class="panel" id="of-results"></section><section class="panel" id="of-sens"></section>';
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
    const warn = $('#of-warn', el);
    warn.innerHTML = P.costsReady(App.cfg) ? '' : banner('warn', '<strong>Faltan tus costos.</strong> Sin el costo del corrector y del envío la comparación no sirve.', '<button class="btn" data-goto="ajustes">Cargar costos</button>');
    renderParams();
    renderRows();
    renderResults();
  }

  function renderParams() {
    const box = $('#of-params', el);
    if (!box || box.contains(document.activeElement)) return;
    const c = cpaActual();
    const cfg = P.normalizeCfg(App.cfg);
    const origen =
      c.origen === 'real'
        ? 'Real de los últimos 7 días: ' + U.money(c.detalle.ads) + ' en anuncios ÷ ' + c.detalle.pedidos + ' pedidos.'
        : c.origen === 'manual'
          ? 'Cargado a mano.'
          : 'Supuesto: cargá el gasto diario en Ganancia o escribí tu costo por pedido.';
    box.innerHTML =
      '<div class="form-grid"><label for="of-cpa">Costo en publicidad por pedido<span class="input-unit"><span class="unit">$</span><input id="of-cpa" inputmode="numeric" value="' +
      e(U.int(c.valor)) +
      '"></span></label><label for="of-envio">Envío extra por cada unidad adicional<span class="input-unit"><span class="unit">$</span><input id="of-envio" inputmode="numeric" value="' +
      e(state.envioExtra ? U.int(state.envioExtra) : '') +
      '" placeholder="0"></span></label></div><p class="muted small">' +
      e(origen) +
      (c.origen === 'manual' ? ' <button class="btn link" data-act="cpa-real">Usar el real</button>' : '') +
      '</p><p class="muted small">Costos de Ajustes: corrector ' +
      e(U.money(cfg.costoUnidad)) +
      ' · envío ' +
      e(U.money(cfg.costoEnvio)) +
      ' · devolución ' +
      e(U.money(cfg.costoDevolucion)) +
      (cfg.comisionCobro ? ' · comisión ' + e(String(cfg.comisionCobro).replace('.', ',')) + '%' : '') +
      '.</p>';
  }

  function renderRows() {
    const box = $('#of-rows', el);
    box.innerHTML =
      '<div class="panel-head"><h3>Ofertas a comparar</h3><button class="btn ghost" data-act="agregar">Agregar oferta</button></div><div class="table-wrap"><table class="table offers-edit"><thead><tr><th>Oferta</th><th class="num">Unidades</th><th class="num">Cobrás en total</th><th class="num">Regalo / extra</th><th class="num">Conversión vs. la 1ª</th><th></th></tr></thead><tbody>' +
      state.items
        .map(
          (o, i) =>
            '<tr><td><label class="sr-only" for="of-n-' +
            i +
            '">Nombre</label><input id="of-n-' +
            i +
            '" data-i="' +
            i +
            '" data-k="nombre" value="' +
            e(o.nombre) +
            '"></td><td><label class="sr-only" for="of-u-' +
            i +
            '">Unidades</label><input id="of-u-' +
            i +
            '" class="num-input short" data-i="' +
            i +
            '" data-k="unidades" inputmode="numeric" value="' +
            e(o.unidades) +
            '"></td><td><label class="sr-only" for="of-p-' +
            i +
            '">Precio</label><input id="of-p-' +
            i +
            '" class="num-input" data-i="' +
            i +
            '" data-k="precio" inputmode="numeric" value="' +
            e(U.int(o.precio)) +
            '"></td><td><label class="sr-only" for="of-x-' +
            i +
            '">Costo del regalo</label><input id="of-x-' +
            i +
            '" class="num-input" data-i="' +
            i +
            '" data-k="extra" inputmode="numeric" value="' +
            e(o.extra ? U.int(o.extra) : '') +
            '" placeholder="0"></td><td><label class="sr-only" for="of-l-' +
            i +
            '">Cambio de conversión</label><span class="input-unit inline"><input id="of-l-' +
            i +
            '" class="num-input short" data-i="' +
            i +
            '" data-k="lift" inputmode="decimal" value="' +
            e(o.lift ? String(o.lift).replace('.', ',') : '') +
            '" placeholder="0"' +
            (i === 0 ? ' disabled' : '') +
            '><span class="unit">%</span></span></td><td>' +
            (state.items.length > 2 ? '<button class="btn link" data-act="quitar" data-i="' + i + '">Quitar</button>' : '') +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table></div><p class="muted small">“Conversión vs. la 1ª”: si creés que la promo va a traer más pedidos por el mismo gasto (ej. +25%), cargalo y tu costo por pedido baja en esa proporción. La primera fila es la base de comparación.</p>';
  }

  function computed() {
    const rates = O.historicalRates(Shop.orders);
    return OF.compare(state.items, App.cfg, rates, cpaActual().valor, state.envioExtra);
  }

  function renderResults() {
    const box = $('#of-results', el);
    if (!box) return;
    const { evs } = computed();
    const max = Math.max(1, ...evs.map((x) => Math.abs(x.ganancia)));
    const mix = OF.unitMix(Shop.orders);
    const best = evs.find((x) => x.mejor);
    box.innerHTML =
      '<h3>Resultado</h3>' +
      (best ? '<p><strong>' + e(best.oferta.nombre) + '</strong> es la que más deja por pedido: ' + e(U.money(best.ganancia)) + (best !== evs[0] ? ', ' + e(U.money(best.vsBase)) + ' más que ' + e(evs[0].oferta.nombre) + '.' : '.') + '</p>' : '') +
      '<ul class="offer-bars">' +
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
            '%"></span></span><span class="wf-val mono ' +
            (x.ganancia >= 0 ? 'pos' : 'neg') +
            '">' +
            e(U.money(x.ganancia)) +
            '</span></li>'
        )
        .join('') +
      '</ul><p class="muted small">Ganancia promedio por cada pedido que entra, después de anuncios, anulados y devoluciones.</p>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Oferta</th><th class="num">Precio por unidad</th><th class="num">Deja si se entrega</th><th class="num">Por pedido que entra</th><th class="num">vs. ' +
      e(evs[0].oferta.nombre) +
      '</th><th>Para empatar necesita</th></tr></thead><tbody>' +
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
      (mix.n ? '<p class="note">En tu historial, ' + U.pct(mix.dos) + ' de los pedidos entregados llevó 2 unidades' + (mix.tresOMas ? ' y ' + U.pct(mix.tresOMas) + ' llevó 3 o más' : '') + ' (' + mix.n + ' pedidos).</p>' : '');
    renderSens();
  }

  function liftText(x) {
    if (x.liftNecesario == null) return '<span class="neg">No empata ni con publicidad gratis</span>';
    if (x.liftNecesario <= 0) return '<span class="pos">Gana aunque convierta ' + e(U.pct(-x.liftNecesario)) + ' menos</span>';
    return e(U.pct(x.liftNecesario)) + ' más pedidos por el mismo gasto';
  }

  function renderSens() {
    const box = $('#of-sens', el);
    const base = cpaActual().valor;
    const niveles = [0.5, 0.75, 1, 1.25, 1.5].map((f) => Math.round((base * f) / 500) * 500);
    const rates = O.historicalRates(Shop.orders);
    const filas = state.items.map((o) => niveles.map((cpa) => OF.evaluate(o, App.cfg, rates, cpa, state.envioExtra).ganancia));
    const bestCol = niveles.map((_, j) => filas.reduce((bi, f, i) => (f[j] > filas[bi][j] ? i : bi), 0));
    box.innerHTML =
      '<h3>¿Y si la publicidad sube o baja?</h3><p class="muted small">Ganancia por pedido según lo que te cueste cada pedido en anuncios.</p><div class="table-wrap"><table class="table"><thead><tr><th>Oferta</th>' +
      niveles.map((n) => '<th class="num">' + e(U.moneyShort(n)) + '</th>').join('') +
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
      '</tbody></table></div><p class="muted small">Resaltada: la mejor oferta para cada costo por pedido.</p>';
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
    } else if (t.dataset.act === 'quitar') {
      state.items.splice(Number(t.dataset.i), 1);
      save();
      renderRows();
      renderResults();
    } else if (t.dataset.act === 'cpa-real') {
      state.cpa = null;
      save();
      renderParams();
      renderResults();
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.ofertas = { mount, render: renderAll };
})(window);
