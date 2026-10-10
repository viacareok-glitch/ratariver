/* Ajustes: costos del negocio, mensajes de WhatsApp, producto para guiones y conexión con Shopify. */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const P = VC.profit;
  const S = VC.scripts;
  const { Store, Shop } = VC.runtime;
  const { e, $, App, DEFAULT_MSGS, toast, banner } = VC.ui;

  const COSTOS = [
    ['costoUnidad', 'Costo de cada corrector', 'Lo que te cobra el proveedor o Dropi por unidad.', '$'],
    ['costoEnvio', 'Envío de un pedido entregado', 'Flete que pagás cuando el pedido llega y se cobra.', '$'],
    ['costoDevolucion', 'Pedido devuelto', 'Lo que pagás cuando rechazan el paquete: ida y vuelta.', '$'],
    ['comisionCobro', 'Comisión de cobro contra entrega', 'Porcentaje que te descuentan del cobro.', '%'],
    ['otrosPorPedido', 'Otros por pedido despachado', 'Packaging, etiqueta, preparación.', '$'],
    ['fijosMensuales', 'Costos fijos por mes', 'Shopify, apps (Releasit, etc.), herramientas. Se prorratea por día.', '$'],
  ];
  const TASAS = [
    ['tasaConfirmacion', 'Pedidos que se despachan', 'De cada 100 que entran, cuántos no se anulan antes de salir.', 'confirmacion'],
    ['tasaEntrega', 'Despachados que se entregan', 'De cada 100 que salen, cuántos se entregan y cobran.', 'entrega'],
  ];
  const PLANTILLAS = [
    ['confirmacion', 'Pedir confirmación'],
    ['recordatorio', 'Recordatorio de confirmación'],
    ['direccion', 'Pedir dirección completa'],
    ['resena', 'Pedir reseña'],
    ['resenaRecordatorio', 'Recordatorio de reseña'],
  ];
  const VARS = ['nombre', 'pedido', 'cantidad', 'producto', 'total', 'direccion', 'ciudad', 'provincia', 'cp', 'extras', 'tienda', 'firma'];

  let el;

  function mount(section) {
    el = section;
    render();
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('click', onClick);
    Shop.onChange(() => !el.contains(document.activeElement) && render());
  }

  function fmtVal(v, unit) {
    if (v == null || v === '' || (unit !== '%' && !Number(v))) return '';
    return unit === '%' ? String(v).replace('.', ',') : U.int(v);
  }

  function render() {
    if (!el) return;
    const rates = O.historicalRates(Shop.orders);
    const cfg = P.normalizeCfg(App.cfg);
    const be = P.breakEven(App.cfg, rates);
    const sample = Shop.orders.find((o) => o.estado === 'pendiente') || Shop.orders[0];
    el.innerHTML =
      '<header class="tool-head"><div><h2>Ajustes</h2><p class="lede">Lo que cargues acá lo usan todas las herramientas. Se guarda solo.</p></div></header>' +
      '<div class="grid-2">' +
      '<section class="panel"><h3>Costos del negocio</h3><div class="settings">' +
      COSTOS.map(
        ([k, label, help, unit]) =>
          '<label class="setting" for="cfg-' +
          k +
          '"><span class="setting-label">' +
          e(label) +
          '</span><span class="setting-help">' +
          e(help) +
          '</span><span class="input-unit"><span class="unit">' +
          unit +
          '</span><input id="cfg-' +
          k +
          '" data-cfg="' +
          k +
          '" data-unit="' +
          unit +
          '" inputmode="decimal" value="' +
          e(fmtVal(App.cfg[k], unit)) +
          '" placeholder="0"></span></label>'
      ).join('') +
      '</div></section>' +
      '<section class="panel"><h3>Tasas para proyectar</h3><p class="muted small">Vacío = se usa tu historial de Shopify.</p><div class="settings">' +
      TASAS.map(([k, label, help, hk]) => {
        const hist = rates[hk];
        const n = hk === 'confirmacion' ? rates.muestraConfirmacion : rates.muestraEntrega;
        return (
          '<label class="setting" for="cfg-' +
          k +
          '"><span class="setting-label">' +
          e(label) +
          '</span><span class="setting-help">' +
          e(help) +
          (hist != null ? ' Historial: ' + U.pct(hist) + ' (' + n + ').' : ' Sin historial todavía.') +
          '</span><span class="input-unit"><span class="unit">%</span><input id="cfg-' +
          k +
          '" data-cfg="' +
          k +
          '" data-unit="%" inputmode="decimal" value="' +
          e(cfg[k] != null ? String(cfg[k]).replace('.', ',') : '') +
          '" placeholder="' +
          (hist != null ? Math.round(hist * 100) : '') +
          '"></span></label>'
        );
      }).join('') +
      '<label class="setting" for="cfg-cpaMaxManual"><span class="setting-label">CPA máximo para el analizador</span><span class="setting-help">Vacío = el calculado' +
      (be && be.cpaEquilibrio > 0 && P.costsReady(App.cfg) ? ' (' + U.money(be.cpaEquilibrio) + ')' : '') +
      '.</span><span class="input-unit"><span class="unit">$</span><input id="cfg-cpaMaxManual" data-cfg="cpaMaxManual" data-unit="$" inputmode="numeric" value="' +
      e(fmtVal(cfg.cpaMaxManual, '$')) +
      '" placeholder="calculado"></span></label></div>' +
      '<div class="history"><h4>Tu historial en Shopify</h4><p>' +
      (rates.total
        ? e(rates.total) + ' pedidos cargados: ' + e(rates.anulados) + ' anulados (' + e(U.pct(rates.anulados / rates.total)) + '). Ticket promedio entregado: ' + e(U.money(rates.ticketPromedio)) + '.'
        : 'Todavía no se cargaron pedidos.') +
      '</p></div></section></div>' +
      '<section class="panel"><h3>Mensajes de WhatsApp</h3><div class="form-grid">' +
      [
        ['tienda', 'Nombre de la tienda'],
        ['firma', 'Firma (opcional)'],
        ['productoSingular', 'Producto (1 unidad)'],
        ['productoPlural', 'Producto (varias)'],
      ]
        .map(([k, l]) => '<label for="msg-' + k + '">' + e(l) + '<input id="msg-' + k + '" data-msg="' + k + '" value="' + e(App.msgs[k] || '') + '"></label>')
        .join('') +
      '</div><p class="muted small">Variables: ' +
      VARS.map((v) => '<span class="mono">{' + v + '}</span>').join(' ') +
      '</p><div class="templates">' +
      PLANTILLAS.map(
        ([k, label]) =>
          '<div class="template"><label for="msg-' +
          k +
          '">' +
          e(label) +
          '<textarea id="msg-' +
          k +
          '" data-msg="' +
          k +
          '" rows="5">' +
          e(App.msgs[k]) +
          '</textarea></label><div class="tpl-foot"><button class="btn link" data-act="restaurar" data-k="' +
          k +
          '">Volver al texto original</button></div>' +
          (sample ? '<div class="preview" id="prev-' + k + '">' + e(U.fillTemplate(App.msgs[k], O.templateVars(sample, App.msgs))) + '</div>' : '') +
          '</div>'
      ).join('') +
      '</div>' +
      (sample ? '<p class="muted small">Vista previa con el pedido ' + e(sample.name) + '.</p>' : '') +
      '</section>' +
      '<div class="grid-2"><section class="panel"><h3>Producto para los guiones</h3><label for="msg-productoGuiones">Cómo se ve el corrector (la IA de video lo necesita para dibujarlo igual en cada clip)<textarea id="msg-productoGuiones" data-msg="productoGuiones" rows="3" placeholder="' +
      e(S.PRODUCTO_DEFAULT) +
      '">' +
      e(App.msgs.productoGuiones || '') +
      '</textarea></label><p class="muted small">Vacío = ' +
      e(S.PRODUCTO_DEFAULT) +
      '.</p></section>' +
      '<section class="panel"><h3>Shopify y datos</h3><label class="check" for="msg-etiquetarShopify"><input type="checkbox" id="msg-etiquetarShopify" data-msg="etiquetarShopify"' +
      (App.msgs.etiquetarShopify ? ' checked' : '') +
      '> Al marcar un pedido, ponerle la etiqueta <span class="mono">WA-confirmado</span> o <span class="mono">WA-cancelado</span> en Shopify</label>' +
      '<p class="muted small">' +
      e(
        Shop.mode === 'live'
          ? 'Conectado a Shopify por claude.ai. ' + (Shop.loadedAt ? Shop.orders.length + ' pedidos cargados.' : 'Cargando…')
          : Shop.mode === 'csv'
            ? 'Usando el CSV importado (' + Shop.orders.length + ' pedidos).'
            : 'Sin conexión a Shopify en esta vista.'
      ) +
      '</p><div class="row-actions"><label class="btn ghost file-btn">Importar CSV de pedidos<input type="file" accept=".csv,text/csv" data-act="importar-csv" hidden></label>' +
      (Shop.mode === 'live' ? '<button class="btn ghost" data-act="refrescar">Volver a traer pedidos</button>' : '') +
      '</div><p class="muted small">' +
      e(
        Store.mode === 'db'
          ? 'Confirmaciones, gastos, reseñas y ajustes se guardan en el panel y los ves desde cualquier dispositivo.'
          : 'Tus datos se guardan solo en este navegador. Abrí el panel desde claude.ai para guardarlos en tu cuenta.'
      ) +
      '</p></section></div>';
  }

  function updatePreviews() {
    const sample = Shop.orders.find((o) => o.estado === 'pendiente') || Shop.orders[0];
    if (!sample) return;
    for (const [k] of PLANTILLAS) {
      const p = el.querySelector('#prev-' + k);
      if (p) p.textContent = U.fillTemplate(App.msgs[k], O.templateVars(sample, App.msgs));
    }
  }

  function onInput(ev) {
    const t = ev.target;
    if (t.dataset.cfg) {
      const raw = t.value.trim();
      const v = raw === '' ? (P.DEFAULT_CFG[t.dataset.cfg] === null ? null : 0) : U.parseNum(raw);
      if (raw !== '' && v == null) return;
      App.cfg[t.dataset.cfg] = v;
      App.saveCfg();
      App.emit('cfg');
    } else if (t.dataset.msg && t.type !== 'checkbox') {
      App.msgs[t.dataset.msg] = t.value;
      App.saveMsgs();
      updatePreviews();
      App.emit('msgs');
    }
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.dataset.cfg) {
      t.value = fmtVal(App.cfg[t.dataset.cfg], t.dataset.unit);
    } else if (t.dataset.msg && t.type === 'checkbox') {
      App.msgs[t.dataset.msg] = t.checked;
      App.saveMsgs();
      App.emit('msgs');
    } else if (t.dataset.act === 'importar-csv' && t.files && t.files[0]) {
      VC.ui
        .readFileText(t.files[0])
        .then((txt) => {
          const list = Shop.importCSV(txt);
          toast(list.length + ' pedidos importados del CSV.', 'good');
          render();
        })
        .catch((err) => toast(err.message || 'No se pudo leer el archivo.', 'bad'));
    }
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    if (t.dataset.act === 'restaurar') {
      const k = t.dataset.k;
      App.msgs[k] = DEFAULT_MSGS[k];
      const ta = el.querySelector('#msg-' + k);
      if (ta) ta.value = App.msgs[k];
      App.saveMsgs();
      updatePreviews();
      App.emit('msgs');
    } else if (t.dataset.act === 'refrescar') {
      Shop.ensure(null, { fresh: true })
        .then(() => {
          toast('Pedidos actualizados.', 'good');
          render();
        })
        .catch((err) => toast(err.message || 'No se pudo actualizar.', 'bad'));
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.ajustes = { mount, render, banner };
})(window);
