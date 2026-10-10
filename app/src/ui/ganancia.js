/* 2 · Ganancia real */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const P = VC.profit;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, seg, chip, banner, shopStatusBanner, prefGet, prefSet, toast, storeFail, icon, bubble, pageHead, info } = VC.ui;

  const state = {
    rango: prefGet('gan-rango', 'hoy'),
    desde: null,
    hasta: null,
    gastos: {},
    loading: false,
    error: null,
  };

  const PLATAFORMAS = [
    ['tiktok', 'TikTok'],
    ['meta', 'Meta'],
    ['otros', 'Otros'],
  ];

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
      pageHead(
        'Ganancia',
        '¿Cuánto te queda de verdad?',
        '<div id="gan-range"></div><button class="btn ghost icon-only" data-act="refrescar" aria-label="Actualizar pedidos" title="Actualizar">' + icon('refresh') + '</button>'
      ) +
      '<div id="gan-dates"></div><div id="gan-status"></div><div id="gan-kpis"></div>' +
      '<div class="grid-2">' +
      '<section class="panel gan-spend" id="gan-spend"><div class="panel-head"><div class="panel-title">' +
      bubble('trending', 'peach') +
      '<h3>Gasto en anuncios</h3>' +
      info('Copiá lo que gastaste cada día en cada plataforma, en pesos. Se guarda solo.') +
      '</div></div><div id="gan-be"></div><div id="gan-spend-rows"></div></section>' +
      '<div class="gan-side"><section class="panel" id="gan-break"></section><section class="panel" id="gan-chart"></section></div></div>' +
      '<section class="panel" id="gan-sources"></section>';
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

  function periodo(from, to) {
    if (from === to) return U.fmtDay(from, true);
    return U.fmtDay(from) + ' al ' + U.fmtDay(to);
  }

  function renderAll(keepInputs) {
    if (!el) return;
    const [from, to] = range();
    $('#gan-range', el).innerHTML = seg(
      'gan-rango',
      [
        { value: 'hoy', label: 'Hoy' },
        { value: 'ayer', label: 'Ayer' },
        { value: '7d', label: '7 días' },
        { value: 'mes', label: 'Este mes' },
        { value: 'custom', label: 'Fechas' },
      ],
      state.rango
    );
    const dates = $('#gan-dates', el);
    if (state.rango === 'custom') {
      if (!dates.querySelector('#gan-desde'))
        dates.innerHTML =
          '<div class="dates gan-dates"><label for="gan-desde">Desde <input type="date" id="gan-desde" value="' +
          from +
          '"></label><label for="gan-hasta">Hasta <input type="date" id="gan-hasta" value="' +
          to +
          '"></label></div>';
    } else dates.innerHTML = '';

    const statusEl = $('#gan-status', el);
    const notes = [];
    if (Shop.mode === 'none') notes.push(shopStatusBanner({ message: 'Abrí el panel desde claude.ai para ver tus pedidos, o importá el CSV de Shopify.' }));
    else if (state.error) notes.push(shopStatusBanner(state.error));
    if (!P.costsReady(App.cfg)) notes.push(banner('warn', '<strong>Faltan tus costos.</strong> Sin ellos la ganancia no es real.', '<button class="btn" data-goto="ajustes">Cargar costos</button>'));
    statusEl.innerHTML = notes.join('');

    const rates = O.historicalRates(Shop.orders);
    const res = P.computeProfit({ orders: Shop.orders, gastos: state.gastos, cfg: App.cfg, rates, confirm: App.confirmStates(), from, to });
    const be = P.breakEven(App.cfg, rates);
    const loadingFirst = (state.loading || Shop.mode === 'pending') && !Shop.loadedAt;

    renderKpis(res, be, rates, from, to, loadingFirst);
    renderBE(res, be);
    if (!keepInputs || !el.querySelector('#gan-spend-rows input:focus')) renderSpend(res);
    renderBreak(res);
    renderChart(res);
    renderSources(res);
  }

  function kpiCard(ic, tone, label, value, sub, valueTone, extra) {
    return (
      '<div class="gk' +
      (valueTone ? ' is-' + valueTone : '') +
      '">' +
      bubble(ic, tone) +
      '<span class="gk-label">' +
      e(label) +
      (extra || '') +
      '</span><span class="gk-value">' +
      value +
      '</span><span class="gk-sub">' +
      sub +
      '</span></div>'
    );
  }

  function proyeccion(res, rates) {
    const r = res.rates;
    const origen = (o, n, que) => (o === 'historico' ? 'según tu historial, ' + n + ' ' + que : o === 'manual' ? 'cargada por vos' : 'estimada, sin historial');
    return (
      'Los pedidos sin entregar se proyectan: de cada 100 se despachan <strong>' +
      Math.round(r.confirmacion * 100) +
      '</strong> (' +
      e(origen(r.origenConfirmacion, rates.muestraConfirmacion, 'pedidos')) +
      ') y de esos se entregan <strong>' +
      Math.round(r.entrega * 100) +
      '</strong> (' +
      e(origen(r.origenEntrega, rates.muestraEntrega, 'envíos')) +
      '). Los confirmados por WhatsApp cuentan como despachados. Las tasas se cambian en Ajustes.<br><br>Ya cobrado, menos gastos: <strong>' +
      e(U.money(res.total.asegurado.ganancia)) +
      '</strong>.'
    );
  }

  function renderKpis(res, be, rates, from, to, loadingFirst) {
    const box = $('#gan-kpis', el);
    if (loadingFirst) {
      box.innerHTML = '<div class="gan-kpis"><div class="skeleton kpi-sk"></div><div class="skeleton kpi-sk"></div><div class="skeleton kpi-sk"></div><div class="skeleton kpi-sk"></div></div>';
      return;
    }
    const t = res.total;
    const costos = P.costsReady(App.cfg);
    const pedidosSub = [
      t.entregados ? t.entregados + (t.entregados === 1 ? ' entregado' : ' entregados') : '',
      t.abiertos ? t.abiertos + (t.abiertos === 1 ? ' abierto' : ' abiertos') : '',
      t.anulados ? t.anulados + (t.anulados === 1 ? ' anulado' : ' anulados') : '',
      t.devueltos ? t.devueltos + (t.devueltos === 1 ? ' devuelto' : ' devueltos') : '',
    ]
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ');
    const eqEntrega = be && be.cpaEntregaEquilibrio > 0 ? be.cpaEntregaEquilibrio : null;
    box.innerHTML =
      '<div class="gan-kpis">' +
      kpiCard(
        'wallet',
        !costos ? '' : t.ganancia >= 0 ? 'good' : 'bad',
        'Ganancia estimada',
        e(U.money(t.ganancia)),
        e(periodo(from, to)),
        !costos ? '' : t.ganancia >= 0 ? 'good' : 'bad',
        info(proyeccion(res, rates), 'Cómo se calcula')
      ) +
      kpiCard('trending', 'peach', 'Anuncios', e(U.money(t.ads)), t.roas != null ? 'ROAS ' + e(t.roas.toFixed(2).replace('.', ',')) : t.pedidos ? 'Sin cargar' : 'Sin gasto') +
      kpiCard('box', '', 'Pedidos', e(U.int(t.pedidos)), e(pedidosSub || 'Sin pedidos')) +
      kpiCard(
        'truck',
        'source',
        'Costo por entrega',
        t.cpaEntrega != null ? e(U.money(t.cpaEntrega)) : '—',
        eqEntrega ? 'Máximo ' + e(U.money(eqEntrega)) : 'Sin datos',
        t.cpaEntrega != null && eqEntrega ? (t.cpaEntrega <= eqEntrega ? 'good' : 'bad') : ''
      ) +
      '</div>';
  }

  // Cuánto se puede pagar por pedido en TikTok o Meta
  function renderBE(res, be) {
    const box = $('#gan-be', el);
    const t = res.total;
    if (!be) {
      box.innerHTML = '<p class="note">' + icon('clock') + ' Cuando tengas entregas, te digo cuánto podés pagar por pedido.</p>';
      return;
    }
    if (!P.costsReady(App.cfg)) {
      box.innerHTML = '';
      return;
    }
    if (be.cpaEquilibrio <= 0) {
      box.innerHTML = banner('bad', 'Con estos costos cada pedido pierde plata aun sin anuncios.', '<button class="btn ghost sm" data-goto="ajustes">Revisar costos</button>');
      return;
    }
    const ahora = t.cpaPedido != null && t.ads > 0 ? t.cpaPedido : null;
    box.innerHTML =
      '<div class="gan-be"><span class="gb-label">Podés pagar hasta</span><span class="gb-num">' +
      e(U.money(be.cpaEquilibrio)) +
      '</span><span class="gb-sub">por pedido sin perder plata ' +
      info(
        'Para quedarte con un 30% de margen: <strong>' +
          e(U.money(be.cpaObjetivo)) +
          '</strong> por pedido.<br><br>Ticket promedio ' +
          e(U.money(be.ticket)) +
          ', ' +
          e(be.unidades.toFixed(1).replace('.', ',')) +
          ' unidades por pedido. Cada entrega te deja ' +
          e(U.money(be.margenEntrega)) +
          ' antes de anuncios.',
        'Cómo se calcula'
      ) +
      '</span>' +
      (ahora != null
        ? '<span class="gb-now">' +
          chip('Estás pagando ' + U.money(ahora), ahora <= be.cpaEquilibrio ? 'good' : 'bad') +
          '</span>'
        : '') +
      '</div>';
  }

  function renderSpend(res) {
    const days = res.days.slice().reverse();
    const many = days.length > 31;
    const rows = (many ? days.slice(0, 31) : days)
      .map((d) => {
        const g = state.gastos[d.day] || {};
        const inp = (k, label) =>
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
          '" placeholder="' +
          label +
          '" aria-label="Gasto en ' +
          label +
          ' el ' +
          e(U.fmtDay(d.day)) +
          '">';
        return (
          '<div class="sp-row"><span class="sp-day">' +
          e(U.fmtDay(d.day, true)) +
          '</span><span class="sp-ins">' +
          PLATAFORMAS.map(([k, label]) => inp(k, label)).join('') +
          '</span><span class="sp-gan ' +
          (d.ganancia >= 0 ? 'pos' : 'neg') +
          '" title="Ganancia del día">' +
          e(U.moneyShort(d.ganancia)) +
          '</span></div>'
        );
      })
      .join('');
    $('#gan-spend-rows', el).innerHTML =
      '<div class="sp-list"><div class="sp-row sp-headrow" aria-hidden="true"><span class="sp-day">Día</span><span class="sp-ins">' +
      PLATAFORMAS.map(([, label]) => '<span>' + label + '</span>').join('') +
      '</span><span class="sp-gan">Ganancia</span></div>' +
      rows +
      '</div>' +
      (many ? '<p class="note">Se ven los últimos 31 días.</p>' : '');
  }

  function renderBreak(res) {
    const t = res.total;
    const items = [
      ['Ventas esperadas', t.ventas, 'base'],
      ['Producto', -t.producto],
      ['Envíos', -t.envios],
      ['Devoluciones', -t.devoluciones],
      ['Comisión', -t.comisiones],
      ['Otros por pedido', -t.otros],
      ['Costos fijos', -t.fijos],
      ['Anuncios', -t.ads],
    ].filter((x) => x[2] === 'base' || Math.round(x[1]) !== 0);
    const max = Math.max(1, t.ventas, Math.abs(t.ganancia));
    const bar = (v, cls) => '<span class="wf-bar ' + cls + '" style="width:' + Math.max(1, (Math.abs(v) / max) * 100).toFixed(1) + '%"></span>';
    const list = items
      .map((x) => '<li><span class="wf-label">' + e(x[0]) + '</span><span class="wf-track">' + bar(x[1], x[2] === 'base' ? 'base' : 'cost') + '</span><span class="wf-val">' + e(U.money(x[1])) + '</span></li>')
      .join('');
    const g =
      '<li class="wf-total"><span class="wf-label">Ganancia</span><span class="wf-track">' +
      bar(t.ganancia, t.ganancia >= 0 ? 'pos' : 'neg') +
      '</span><span class="wf-val ' +
      (t.ganancia >= 0 ? 'pos' : 'neg') +
      '">' +
      e(U.money(t.ganancia)) +
      '</span></li>';
    $('#gan-break', el).innerHTML =
      '<div class="panel-head"><div class="panel-title">' +
      bubble('wallet', 'good') +
      '<h3>De dónde sale la ganancia</h3>' +
      info('Ventas esperadas: lo que vas a cobrar de los pedidos del período, contando los que todavía no se entregaron según tus tasas. Abajo, todo lo que se resta.') +
      '</div></div><ul class="waterfall">' +
      list +
      g +
      '</ul>';
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
    // Ancho útil del panel (sin el relleno), para que el gráfico no se pase y entre en media columna
    const cs = getComputedStyle(box);
    const inner = Math.floor(box.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
    const W = Math.max(280, inner, res.days.length * 12);
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
        '" rx="4"></rect><title>' +
        e(U.fmtDay(d.day, true) + ': ' + U.money(v) + ' · ' + d.pedidos + ' pedidos · anuncios ' + U.money(d.ads)) +
        '</title></g>';
      if ((i === iMax && v > 0) || (i === iMin && v < 0)) {
        const ly = v >= 0 ? y - 5 : y + h + 12;
        bars += '<text class="bar-label" x="' + (x + w / 2).toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle">' + e(U.moneyShort(v)) + '</text>';
      }
      const step = Math.ceil(res.days.length / 10);
      const last = res.days.length - 1;
      // La última fecha siempre; las otras cada "step" días, salvo que se pisen con la última
      if ((i % step === 0 && last - i > step / 2) || i === last) bars += '<text class="axis-label" x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + e(U.fmtDay(d.day)) + '</text>';
    });
    box.innerHTML =
      '<div class="panel-head"><div class="panel-title">' +
      bubble('chart') +
      '<h3>Ganancia por día</h3></div></div><div class="chart-wrap"><svg class="chart" viewBox="0 0 ' +
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
    const head =
      '<div class="panel-head"><div class="panel-title">' +
      bubble('grid', 'source') +
      '<h3>Por plataforma</h3>' +
      info('Según la UTM que trae cada pedido. El gasto de “Otros” no se asigna a ninguna plataforma.') +
      '</div></div>';
    if (!rows.length) {
      box.innerHTML = head + '<p class="note">Sin pedidos en estas fechas.</p>';
      return;
    }
    box.innerHTML =
      head +
      '<div class="table-wrap"><table class="table gan-src"><thead><tr><th>Plataforma</th><th class="num">Pedidos</th><th class="num hide-sm">Anulados</th><th class="num hide-sm">Ventas</th><th class="num hide-sm">Anuncios</th><th class="num">Ganancia</th><th class="num">ROAS</th></tr></thead><tbody>' +
      rows
        .map(
          (s) =>
            '<tr><th scope="row">' +
            e(O.SOURCES[s.source] || s.source) +
            '</th><td class="num">' +
            s.pedidos +
            '</td><td class="num hide-sm">' +
            s.anulados +
            '</td><td class="num hide-sm">' +
            e(U.money(s.ventas)) +
            '</td><td class="num hide-sm">' +
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
      for (const [k] of PLATAFORMAS) {
        const inp = el.querySelector('#gasto-' + day + '-' + k);
        row[k] = inp ? U.parseMoney(inp.value) || 0 : 0;
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
      if (state.desde > state.hasta) {
        [state.desde, state.hasta] = [state.hasta, state.desde];
        $('#gan-desde', el).value = state.desde;
        $('#gan-hasta', el).value = state.hasta;
      }
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
      const v = U.parseMoney(t.value);
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
