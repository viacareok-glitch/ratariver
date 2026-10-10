/* 2 · Panel de ganancia real */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const P = VC.profit;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, kpi, seg, banner, shopStatusBanner, prefGet, prefSet, toast, storeFail } = VC.ui;

  const state = {
    rango: prefGet('gan-rango', 'hoy'),
    desde: null,
    hasta: null,
    gastos: {},
    loading: false,
    error: null,
  };

  let el;

  function range() {
    const hoy = U.todayKeyAR();
    switch (state.rango) {
      case 'ayer':
        return [U.addDays(hoy, -1), U.addDays(hoy, -1)];
      case '7d':
        return [U.addDays(hoy, -6), hoy];
      case 'mes':
        return [hoy.slice(0, 8) + '01', hoy];
      case 'custom':
        return [state.desde || U.addDays(hoy, -6), state.hasta || hoy];
      default:
        return [hoy, hoy];
    }
  }

  function mount(section) {
    el = section;
    el.innerHTML =
      '<header class="tool-head"><div><h2>Ganancia real</h2><p class="lede">Ventas de Shopify menos producto, envíos, devoluciones, comisiones y anuncios. Los pedidos que todavía no se entregaron se proyectan con tus tasas reales.</p></div>' +
      '<div class="tool-actions"><button class="btn ghost" data-act="refrescar">Actualizar</button></div></header>' +
      '<div id="gan-range"></div><div id="gan-status"></div><div id="gan-kpis"></div>' +
      '<div class="grid-2"><section class="panel" id="gan-spend"></section><section class="panel" id="gan-break"></section></div>' +
      '<section class="panel" id="gan-chart"></section><section class="panel" id="gan-sources"></section><p class="note" id="gan-rates"></p>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    Shop.onChange(renderAll);
    App.on((w) => (w === 'cfg' || w === 'confirm') && renderAll());
    Store.watch(
      'gastos',
      (m) => {
        const g = {};
        for (const [k, v] of m) g[k] = v;
        state.gastos = g;
        renderAll(true);
      },
      () => {}
    );
    load();
  }

  async function load(fresh) {
    const [from] = range();
    state.loading = true;
    state.error = null;
    renderAll();
    try {
      await Shop.ensure(from, { fresh });
    } catch (err) {
      state.error = err;
    }
    state.loading = false;
    renderAll();
  }

  function renderAll(keepInputs) {
    if (!el) return;
    const [from, to] = range();
    $('#gan-range', el).innerHTML =
      '<div class="toolbar">' +
      seg(
        'gan-rango',
        [
          { value: 'hoy', label: 'Hoy' },
          { value: 'ayer', label: 'Ayer' },
          { value: '7d', label: '7 días' },
          { value: 'mes', label: 'Este mes' },
          { value: 'custom', label: 'Elegir fechas' },
        ],
        state.rango
      ) +
      (state.rango === 'custom'
        ? '<div class="dates"><label for="gan-desde">Desde <input type="date" id="gan-desde" value="' + from + '"></label><label for="gan-hasta">Hasta <input type="date" id="gan-hasta" value="' + to + '"></label></div>'
        : '<span class="muted">' + e(from === to ? U.fmtDay(from, true) : U.fmtDay(from) + ' al ' + U.fmtDay(to)) + '</span>') +
      '</div>';

    const statusEl = $('#gan-status', el);
    const notes = [];
    if (Shop.mode === 'none') notes.push(shopStatusBanner({ message: 'Esta vista no puede conectarse a Shopify. Abrí el panel desde claude.ai o importá el CSV de pedidos.' }));
    else if (state.error) notes.push(shopStatusBanner(state.error));
    if (!P.costsReady(App.cfg)) notes.push(banner('warn', '<strong>Falta el costo del producto.</strong> Cargá cuánto te cuesta cada corrector, el envío y la devolución para ver la ganancia de verdad.', '<button class="btn" data-goto="ajustes">Cargar costos</button>'));
    statusEl.innerHTML = notes.join('');

    const rates = O.historicalRates(Shop.orders);
    const res = P.computeProfit({ orders: Shop.orders, gastos: state.gastos, cfg: App.cfg, rates, confirm: App.confirmStates(), from, to });
    const be = P.breakEven(App.cfg, rates);
    const t = res.total;
    const loadingFirst = (state.loading || Shop.mode === 'pending') && !Shop.loadedAt;

    $('#gan-kpis', el).innerHTML = loadingFirst
      ? '<div class="kpis"><div class="skeleton kpi-sk"></div><div class="skeleton kpi-sk"></div><div class="skeleton kpi-sk"></div><div class="skeleton kpi-sk"></div></div>'
      : '<div class="kpis">' +
        kpi(
          'Ganancia estimada',
          '<span class="' + (t.ganancia >= 0 ? 'pos' : 'neg') + '">' + e(U.money(t.ganancia)) + '</span>',
          'Ya cobrado menos gastos: <span class="mono nowrap">' + e(U.money(t.asegurado.ganancia)) + '</span>',
          t.ganancia >= 0 ? 'good' : 'bad'
        ) +
        kpi('Gasto en anuncios', e(U.money(t.ads)), t.roas != null ? 'ROAS real ' + e(t.roas.toFixed(2).replace('.', ',')) + ' · ' + e(U.money(t.cpaPedido)) + ' por pedido' : t.pedidos ? 'Cargá el gasto del día abajo' : 'Sin gasto cargado') +
        kpi('Pedidos', e(U.int(t.pedidos)), e(t.anulados) + ' anulados · ' + e(t.entregados) + ' entregados · ' + e(t.abiertos) + ' abiertos' + (t.devueltos ? ' · ' + e(t.devueltos) + ' devueltos' : '')) +
        kpi(
          'Costo por entrega',
          t.cpaEntrega != null ? e(U.money(t.cpaEntrega)) : '—',
          be && be.cpaEntregaEquilibrio > 0 ? 'Equilibrio: ' + e(U.money(be.cpaEntregaEquilibrio)) + ' por entrega' : 'Anuncios ÷ entregas esperadas',
          t.cpaEntrega != null && be && be.cpaEntregaEquilibrio > 0 ? (t.cpaEntrega <= be.cpaEntregaEquilibrio ? 'good' : 'bad') : ''
        ) +
        '</div>';

    if (!keepInputs || !el.querySelector('#gan-spend input:focus')) renderSpend(res, from, to);
    renderBreak(res, be);
    renderChart(res);
    renderSources(res);
    const r = res.rates;
    const origen = (o) => (o === 'historico' ? 'tu historial' : o === 'manual' ? 'cargada a mano' : 'supuesta, sin historial');
    $('#gan-rates', el).textContent =
      'Proyección: de cada 100 pedidos se despachan ' +
      Math.round(r.confirmacion * 100) +
      ' (' +
      origen(r.origenConfirmacion) +
      (r.origenConfirmacion === 'historico' ? ', ' + rates.muestraConfirmacion + ' pedidos' : '') +
      ') y de cada 100 despachados se entregan ' +
      Math.round(r.entrega * 100) +
      ' (' +
      origen(r.origenEntrega) +
      (r.origenEntrega === 'historico' ? ', ' + rates.muestraEntrega + ' envíos' : '') +
      '). Los pedidos confirmados por WhatsApp cuentan como despachados. Podés cambiar las tasas en Ajustes.';
  }

  function renderSpend(res, from, to) {
    const days = res.days.slice().reverse();
    const many = days.length > 31;
    const rows = (many ? days.slice(0, 31) : days)
      .map((d) => {
        const g = state.gastos[d.day] || {};
        const inp = (k) =>
          '<input type="text" inputmode="numeric" class="num-input" id="gasto-' +
          d.day +
          '-' +
          k +
          '" data-day="' +
          d.day +
          '" data-k="' +
          k +
          '" value="' +
          (g[k] ? e(U.int(g[k])) : '') +
          '" placeholder="0" aria-label="Gasto en ' +
          k +
          ' el ' +
          e(U.fmtDay(d.day)) +
          '">';
        return (
          '<tr><th scope="row">' +
          e(U.fmtDay(d.day, true)) +
          '</th><td>' +
          inp('tiktok') +
          '</td><td>' +
          inp('meta') +
          '</td><td>' +
          inp('otros') +
          '</td><td class="num ' +
          (d.ganancia >= 0 ? 'pos' : 'neg') +
          '">' +
          e(U.moneyShort(d.ganancia)) +
          '</td></tr>'
        );
      })
      .join('');
    $('#gan-spend', el).innerHTML =
      '<h3>Gasto en anuncios</h3><p class="muted small">Copiá el gasto de cada plataforma (en pesos). Se guarda solo.</p>' +
      '<div class="table-wrap"><table class="table spend"><thead><tr><th>Día</th><th>TikTok</th><th>Meta</th><th>Otros</th><th class="num">Ganancia</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div>' +
      (many ? '<p class="muted small">Se muestran los últimos 31 días del rango.</p>' : '');
  }

  function renderBreak(res, be) {
    const t = res.total;
    const items = [
      ['Ventas esperadas', t.ventas, 'base'],
      ['Costo del producto', -t.producto],
      ['Envíos', -t.envios],
      ['Devoluciones', -t.devoluciones],
      ['Comisión de cobro', -t.comisiones],
      ['Otros por pedido', -t.otros],
      ['Costos fijos', -t.fijos],
      ['Anuncios', -t.ads],
    ].filter((x) => x[2] === 'base' || Math.round(x[1]) !== 0);
    const max = Math.max(1, t.ventas, Math.abs(t.ganancia));
    const bar = (v, cls) => '<span class="wf-bar ' + cls + '" style="width:' + Math.max(1, (Math.abs(v) / max) * 100).toFixed(1) + '%"></span>';
    const list = items
      .map((x) => '<li><span class="wf-label">' + e(x[0]) + '</span><span class="wf-track">' + bar(x[1], x[2] === 'base' ? 'base' : 'cost') + '</span><span class="wf-val mono">' + e(U.money(x[1])) + '</span></li>')
      .join('');
    const g = '<li class="wf-total"><span class="wf-label">Ganancia</span><span class="wf-track">' + bar(t.ganancia, t.ganancia >= 0 ? 'pos' : 'neg') + '</span><span class="wf-val mono ' + (t.ganancia >= 0 ? 'pos' : 'neg') + '">' + e(U.money(t.ganancia)) + '</span></li>';
    let beHtml = '';
    if (be && P.costsReady(App.cfg)) {
      beHtml =
        be.cpaEquilibrio > 0
          ? '<div class="be"><div><span class="be-num mono">' +
            e(U.money(be.cpaEquilibrio)) +
            '</span><span class="be-txt">es lo máximo que podés pagar por pedido en TikTok o Meta sin perder plata.</span></div><div><span class="be-num mono">' +
            e(U.money(be.cpaObjetivo)) +
            '</span><span class="be-txt">es el costo por pedido para quedarte con el 30% de margen.</span></div><p class="muted small">Con ticket promedio de ' +
            e(U.money(be.ticket)) +
            ' y ' +
            e(be.unidades.toFixed(1).replace('.', ',')) +
            ' unidades por pedido entregado: cada entrega te deja ' +
            e(U.money(be.margenEntrega)) +
            ' antes de anuncios.</p></div>'
          : banner('bad', 'Con estos costos cada pedido pierde plata aun sin anuncios. Revisá el precio o los costos en Ajustes.')
    } else if (!be) beHtml = '<p class="muted small">Cuando tengas pedidos entregados vamos a calcular cuánto podés pagar por pedido.</p>';
    $('#gan-break', el).innerHTML = '<h3>De dónde sale la ganancia</h3><ul class="waterfall">' + list + g + '</ul>' + beHtml;
  }

  function renderChart(res) {
    const box = $('#gan-chart', el);
    if (res.days.length < 2) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const vals = res.days.map((d) => d.ganancia);
    const maxAbs = Math.max(1, ...vals.map(Math.abs));
    const hasNeg = vals.some((v) => v < 0);
    const W = Math.max(300, Math.floor(box.clientWidth) - 34, res.days.length * 28);
    const H = 190;
    const pad = { t: 18, b: hasNeg ? 42 : 26, l: 8, r: 8 };
    const hasPos = vals.some((v) => v > 0);
    const zeroY = hasNeg && hasPos ? pad.t + ((H - pad.t - pad.b) * maxPos(vals)) / (maxPos(vals) + maxNeg(vals)) : hasNeg ? pad.t : H - pad.b;
    const scale = (H - pad.t - pad.b) / (hasNeg && hasPos ? maxPos(vals) + maxNeg(vals) : maxAbs);
    const bw = (W - pad.l - pad.r) / res.days.length;
    const iMax = vals.indexOf(Math.max(...vals));
    const iMin = vals.indexOf(Math.min(...vals));
    let bars = '';
    res.days.forEach((d, i) => {
      const v = d.ganancia;
      const h = Math.max(1, Math.abs(v) * scale);
      const x = pad.l + i * bw + bw * 0.18;
      const y = v >= 0 ? zeroY - h : zeroY;
      const w = bw * 0.64;
      bars +=
        '<g class="bar-g"><rect class="hit" x="' +
        (pad.l + i * bw) +
        '" y="0" width="' +
        bw +
        '" height="' +
        H +
        '"></rect><rect class="' +
        (v >= 0 ? 'bar-pos' : 'bar-neg') +
        '" x="' +
        x.toFixed(1) +
        '" y="' +
        y.toFixed(1) +
        '" width="' +
        w.toFixed(1) +
        '" height="' +
        h.toFixed(1) +
        '" rx="3"></rect><title>' +
        e(U.fmtDay(d.day, true) + ': ' + U.money(v) + ' · ' + d.pedidos + ' pedidos · anuncios ' + U.money(d.ads)) +
        '</title></g>';
      if ((i === iMax && v > 0) || (i === iMin && v < 0)) {
        const ly = v >= 0 ? y - 5 : y + h + 12;
        bars += '<text class="bar-label" x="' + (x + w / 2).toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle">' + e(U.moneyShort(v)) + '</text>';
      }
      const step = Math.ceil(res.days.length / 10);
      if (i % step === 0 || i === res.days.length - 1) bars += '<text class="axis-label" x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + e(U.fmtDay(d.day)) + '</text>';
    });
    box.innerHTML =
      '<h3>Ganancia por día</h3><div class="chart-wrap"><svg class="chart" viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" width="' +
      W +
      '" height="' +
      H +
      '" role="img" aria-label="Ganancia estimada por día"><line class="zero" x1="' +
      pad.l +
      '" x2="' +
      (W - pad.r) +
      '" y1="' +
      zeroY.toFixed(1) +
      '" y2="' +
      zeroY.toFixed(1) +
      '"></line>' +
      bars +
      '</svg></div>';
  }

  function maxPos(v) {
    return Math.max(0, ...v);
  }
  function maxNeg(v) {
    return Math.max(0, ...v.map((x) => -x));
  }

  function renderSources(res) {
    const box = $('#gan-sources', el);
    const rows = res.sources.filter((s) => s.pedidos || s.ads);
    if (!rows.length) {
      box.innerHTML = '<h3>Por plataforma</h3><p class="muted">Sin pedidos en este rango.</p>';
      return;
    }
    box.innerHTML =
      '<h3>Por plataforma</h3><p class="muted small">Según la UTM que trae cada pedido. El gasto de “Otros” no se asigna a ninguna.</p><div class="table-wrap"><table class="table"><thead><tr><th>Plataforma</th><th class="num">Pedidos</th><th class="num">Anulados</th><th class="num">Ventas esperadas</th><th class="num">Anuncios</th><th class="num">Ganancia</th><th class="num">ROAS</th></tr></thead><tbody>' +
      rows
        .map(
          (s) =>
            '<tr><th scope="row">' +
            e(O.SOURCES[s.source] || s.source) +
            '</th><td class="num">' +
            s.pedidos +
            '</td><td class="num">' +
            s.anulados +
            '</td><td class="num">' +
            e(U.money(s.ventas)) +
            '</td><td class="num">' +
            e(U.money(s.ads)) +
            '</td><td class="num ' +
            (s.ganancia - s.fijos >= 0 ? 'pos' : 'neg') +
            '">' +
            e(U.money(s.ganancia)) +
            '</td><td class="num">' +
            (s.roas != null ? e(s.roas.toFixed(2).replace('.', ',')) : '—') +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table></div>';
  }

  const saveSpend = {};
  function onInput(ev) {
    const t = ev.target;
    if (!t.dataset.day) return;
    const day = t.dataset.day;
    clearTimeout(saveSpend[day]);
    saveSpend[day] = setTimeout(() => {
      const row = {};
      for (const k of ['tiktok', 'meta', 'otros']) {
        const inp = el.querySelector('#gasto-' + day + '-' + k);
        row[k] = inp ? U.parseNum(inp.value) || 0 : 0;
      }
      state.gastos[day] = row;
      Store.set('gastos/' + day, row).catch(storeFail);
      renderAll(true);
    }, 600);
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.id === 'gan-desde' || t.id === 'gan-hasta') {
      state.desde = $('#gan-desde', el).value;
      state.hasta = $('#gan-hasta', el).value;
      if (state.desde > state.hasta) [state.desde, state.hasta] = [state.hasta, state.desde];
      load();
    } else if (t.dataset.act === 'importar-csv' && t.files && t.files[0]) {
      VC.ui
        .readFileText(t.files[0])
        .then((txt) => {
          Shop.importCSV(txt);
          state.error = null;
          toast('Pedidos importados del CSV.', 'good');
          renderAll();
        })
        .catch((err) => toast(err.message || 'No se pudo leer el archivo.', 'bad'));
    } else if (t.dataset.day) {
      const v = U.parseNum(t.value);
      t.value = v ? U.int(v) : '';
    }
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act], [data-seg]');
    if (!t || !el.contains(t)) return;
    if (t.dataset.seg === 'gan-rango') {
      state.rango = t.dataset.value;
      prefSet('gan-rango', state.rango);
      load();
    } else if (t.dataset.act === 'refrescar' || t.dataset.act === 'reintentar') load(true);
    else if (t.dataset.act === 'permisos') VC.runtime.managePermissions();
  }

  VC.tools = VC.tools || {};
  VC.tools.ganancia = { mount, render: renderAll, load };
})(window);
