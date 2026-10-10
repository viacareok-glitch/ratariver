/* Ajustes: costos del negocio, datos de la tienda, mensajes de WhatsApp, producto para guiones y conexión con Shopify. */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const O = VC.orders;
  const P = VC.profit;
  const S = VC.scripts;
  const { Store, Shop } = VC.runtime;
  const { e, $$, App, DEFAULT_MSGS, toast, banner, chip, icon, bubble, pageHead, info, more, toggle } = VC.ui;

  const COSTOS = [
    ['costoUnidad', 'Corrector', 'Lo que te cobra el proveedor o Dropi por cada unidad.', '$'],
    ['costoEnvio', 'Envío', 'El flete que pagás cuando el pedido llega y se cobra.', '$'],
    ['costoDevolucion', 'Devolución', 'Lo que pagás cuando rechazan el paquete: ida y vuelta.', '$'],
    ['comisionCobro', 'Comisión de cobro', 'El porcentaje que te descuentan del cobro contra entrega.', '%'],
    ['otrosPorPedido', 'Otros por pedido', 'Packaging, etiqueta y preparación de cada pedido despachado.', '$'],
    ['fijosMensuales', 'Fijos por mes', 'Shopify, apps (Releasit, etc.) y herramientas. Se reparte por día.', '$'],
  ];
  const TASAS = [
    ['tasaConfirmacion', 'Se despachan', 'De cada 100 pedidos que entran, cuántos no se anulan antes de salir.', 'confirmacion'],
    ['tasaEntrega', 'Se entregan', 'De cada 100 que salen, cuántos se entregan y se cobran.', 'entrega'],
  ];
  const PLANTILLAS = [
    ['confirmacion', 'Pedir confirmación'],
    ['recordatorio', 'Recordatorio de confirmación'],
    ['direccion', 'Pedir dirección completa'],
    ['resena', 'Pedir reseña'],
    ['resenaRecordatorio', 'Recordatorio de reseña'],
  ];
  const TIENDA = [
    ['precio1', 'Precio 1 unidad', '68.990', true],
    ['precio2', 'Precio 2 unidades', '72.990', true],
    ['envio', 'Envíos', 'Enviamos a todo el país', false],
    ['pago', 'Forma de pago', 'pagás en efectivo cuando te llega', false],
    ['demora', 'Demora de entrega', 'Ej.: de 3 a 7 días hábiles', false],
    ['talles', 'Talles', 'Ej.: es regulable, va de S a XL', false],
    ['garantia', 'Cambios y garantía', 'Ej.: cambio dentro de los 10 días', false],
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

  function sampleOrder() {
    return Shop.orders.find((o) => o.estado === 'pendiente') || Shop.orders[0];
  }

  function head(iconName, tone, title, extra, right) {
    return '<div class="panel-head"><div class="panel-title">' + bubble(iconName, tone) + '<h3>' + e(title) + '</h3>' + (extra || '') + '</div>' + (right || '') + '</div>';
  }

  // Campo con etiqueta corta, "?" opcional y unidad ($ o %)
  function numField(id, attrs, label, help, unit, value, placeholder) {
    return (
      '<div class="aj-field"><div class="aj-lbl"><label for="' +
      id +
      '">' +
      e(label) +
      '</label>' +
      (help ? info(help) : '') +
      '</div><span class="input-unit"><span class="unit">' +
      unit +
      '</span><input id="' +
      id +
      '" ' +
      attrs +
      ' value="' +
      e(value) +
      '" placeholder="' +
      e(placeholder == null ? '0' : placeholder) +
      '"></span></div>'
    );
  }

  function textField(id, attrs, label, value, placeholder) {
    return '<div class="aj-field"><div class="aj-lbl"><label for="' + id + '">' + e(label) + '</label></div><input id="' + id + '" ' + attrs + ' value="' + e(value) + '"' + (placeholder ? ' placeholder="' + e(placeholder) + '"' : '') + '></div>';
  }

  function render() {
    if (!el) return;
    // Conserva abiertos los plegables al redibujar
    const abiertos = $$('details[open]', el)
      .map((d) => d.id)
      .filter(Boolean);
    const rates = O.historicalRates(Shop.orders);
    const cfg = P.normalizeCfg(App.cfg);
    const be = P.breakEven(App.cfg, rates);
    const listos = P.costsReady(App.cfg);
    const sample = sampleOrder();

    const costos =
      '<section class="panel aj-panel" id="aj-costos">' +
      head('wallet', listos ? 'good' : 'warn', 'Costos', '', listos ? chip('Listos', 'good') : chip('Faltan cargar', 'warn')) +
      '<div class="aj-fields">' +
      COSTOS.map(([k, label, help, unit]) => numField('cfg-' + k, 'data-cfg="' + k + '" data-unit="' + unit + '" inputmode="decimal"', label, help, unit, fmtVal(App.cfg[k], unit))).join('') +
      '</div>' +
      more(
        'Tasas y tope de publicidad',
        '<div class="aj-more"><div class="aj-fields">' +
          TASAS.map(([k, label, help, hk]) => {
            const hist = rates[hk];
            const n = hk === 'confirmacion' ? rates.muestraConfirmacion : rates.muestraEntrega;
            return numField(
              'cfg-' + k,
              'data-cfg="' + k + '" data-unit="%" inputmode="decimal"',
              label,
              help + (hist != null ? ' Vacío = tu historial: ' + U.pct(hist) + ' (' + n + ' pedidos).' : ' Vacío = tu historial de Shopify.'),
              '%',
              cfg[k] != null ? String(cfg[k]).replace('.', ',') : '',
              hist != null ? Math.round(hist * 100) : ''
            );
          }).join('') +
          numField(
            'cfg-cpaMaxManual',
            'data-cfg="cpaMaxManual" data-unit="$" inputmode="numeric"',
            'Tope por pedido',
            'Lo máximo que querés pagar en publicidad por pedido, para el analizador de creativos. Vacío = el calculado' + (be && be.cpaEquilibrio > 0 && listos ? ' (' + U.money(be.cpaEquilibrio) + ').' : '.'),
            '$',
            fmtVal(cfg.cpaMaxManual, '$'),
            'calculado'
          ) +
          '</div><p class="note">' +
          icon('chart') +
          (rates.total
            ? e(rates.total) + ' pedidos en tu historial · ' + e(U.pct(rates.anulados / rates.total)) + ' anulados · ticket entregado ' + e(U.money(rates.ticketPromedio))
            : 'Todavía no se cargaron pedidos.') +
          '</p></div>',
        'aj-more-tasas'
      ) +
      '</section>';

    const tienda =
      '<section class="panel aj-panel" id="aj-tienda">' +
      head('store', 'peach', 'Datos de la tienda', info('Los usan las respuestas a comentarios, los mensajes a clientes y las ofertas. Poné solo lo que cumplís.')) +
      '<div class="aj-fields">' +
      textField('msg-tienda', 'data-msg="tienda"', 'Nombre', App.msgs.tienda || '') +
      TIENDA.map(([k, label, ph, unit]) => {
        const v = App.tienda[k];
        return unit
          ? numField('td-' + k, 'data-tienda="' + k + '" data-unit="$" inputmode="numeric"', label, '', '$', v ? U.int(v) : '', ph)
          : textField('td-' + k, 'data-tienda="' + k + '"', label, v || '', ph);
      }).join('') +
      '</div></section>';

    const mensajes =
      '<section class="panel aj-panel" id="aj-mensajes">' +
      head('message', 'wa', 'Mensajes de WhatsApp', info('Podés usar estas variables en las plantillas: ' + VARS.map((v) => '<span class="mono">{' + v + '}</span>').join(' ') + (sample ? '<br><br>La vista previa usa el pedido ' + e(sample.name) + '.' : ''))) +
      '<div class="aj-fields is-3">' +
      [
        ['firma', 'Firma (opcional)'],
        ['productoSingular', 'Producto (1 unidad)'],
        ['productoPlural', 'Producto (varias)'],
      ]
        .map(([k, l]) => textField('msg-' + k, 'data-msg="' + k + '"', l, App.msgs[k] || ''))
        .join('') +
      '</div><div class="aj-tpls">' +
      PLANTILLAS.map(([k, label]) =>
        more(
          label,
          '<div class="aj-tpl"><textarea id="msg-' +
            k +
            '" data-msg="' +
            k +
            '" rows="6" aria-label="' +
            e(label) +
            '">' +
            e(App.msgs[k]) +
            '</textarea><div class="aj-tpl-side">' +
            (sample ? '<div class="preview" id="prev-' + k + '">' + e(U.fillTemplate(App.msgs[k], O.templateVars(sample, App.msgs))) + '</div>' : '') +
            '<button class="btn link" data-act="restaurar" data-k="' +
            k +
            '">' +
            icon('refresh') +
            'Volver al original</button></div></div>',
          'aj-tpl-' + k
        )
      ).join('') +
      '</div></section>';

    const guiones =
      '<section class="panel aj-panel" id="aj-guiones">' +
      head('video', 'source', 'Producto para guiones', info('La IA de video lo necesita para dibujar el corrector igual en cada clip. Si lo dejás vacío, se usa: ' + e(S.PRODUCTO_DEFAULT))) +
      '<div class="aj-field"><div class="aj-lbl"><label for="msg-productoGuiones">Cómo se ve el corrector</label></div><textarea id="msg-productoGuiones" data-msg="productoGuiones" rows="4" placeholder="' +
      e(S.PRODUCTO_DEFAULT) +
      '">' +
      e(App.msgs.productoGuiones || '') +
      '</textarea></div></section>';

    const estado =
      Shop.mode === 'live'
        ? [chip('Conectado', 'good'), Shop.loadedAt ? Shop.orders.length + ' pedidos cargados' : 'Cargando pedidos…']
        : Shop.mode === 'csv'
          ? [chip('CSV importado', 'info'), Shop.orders.length + ' pedidos del archivo']
          : [chip('Sin conexión', 'warn'), 'Abrí el panel desde claude.ai'];
    const shopify =
      '<section class="panel aj-panel" id="aj-shopify">' +
      head('refresh', '', 'Shopify y datos') +
      '<p class="aj-status">' +
      estado[0] +
      '<span class="muted">' +
      e(estado[1]) +
      '</span></p>' +
      '<div class="aj-switch">' +
      toggle('msg-etiquetarShopify', !!App.msgs.etiquetarShopify, 'Etiquetar pedidos en Shopify', 'data-msg="etiquetarShopify"') +
      info('Cuando marcás un pedido en Confirmar, le pone la etiqueta <span class="mono">WA-confirmado</span> o <span class="mono">WA-cancelado</span> en Shopify.') +
      '</div><div class="row-actions"><label class="btn ghost file-btn">' +
      icon('upload') +
      'Importar CSV<input type="file" accept=".csv,text/csv" data-act="importar-csv" hidden></label>' +
      (Shop.mode === 'live' ? '<button class="btn ghost" data-act="refrescar">' + icon('refresh') + 'Traer pedidos</button>' : '') +
      '</div><p class="note">' +
      (Store.mode === 'db'
        ? icon('check') + 'Se guarda en tu cuenta.' + info('Confirmaciones, gastos, reseñas y ajustes quedan guardados en el panel: los ves desde cualquier dispositivo.')
        : icon('alert') + 'Se guarda solo en este navegador.' + info('Abrí el panel desde claude.ai para guardar tus datos en tu cuenta.')) +
      '</p></section>';

    el.innerHTML =
      pageHead('Ajustes', 'Tus costos, datos y mensajes. Se guarda solo.') +
      '<div class="grid-2 aj-grid">' +
      costos +
      tienda +
      '</div>' +
      mensajes +
      '<div class="grid-2 aj-grid">' +
      guiones +
      shopify +
      '</div>';
    for (const id of abiertos) {
      const d = el.querySelector('#' + CSS.escape(id));
      if (d) d.open = true;
    }
  }

  function updatePreviews() {
    const sample = sampleOrder();
    if (!sample) return;
    for (const [k] of PLANTILLAS) {
      const p = el.querySelector('#prev-' + k);
      if (p) p.textContent = U.fillTemplate(App.msgs[k], O.templateVars(sample, App.msgs));
    }
  }

  function onInput(ev) {
    const t = ev.target;
    if (t.dataset.tienda) {
      const k = t.dataset.tienda;
      App.tienda[k] = t.dataset.unit === '$' ? U.parseMoney(t.value) || 0 : t.value;
      App.saveTienda();
      App.emit('tienda');
      return;
    }
    if (t.dataset.cfg) {
      const raw = t.value.trim();
      const parse = t.dataset.unit === '$' ? U.parseMoney : U.parseNum;
      const v = raw === '' ? (P.DEFAULT_CFG[t.dataset.cfg] === null ? null : 0) : parse(raw);
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
    if (t.dataset.tienda && t.dataset.unit === '$') {
      t.value = App.tienda[t.dataset.tienda] ? U.int(App.tienda[t.dataset.tienda]) : '';
    } else if (t.dataset.cfg) {
      t.value = fmtVal(App.cfg[t.dataset.cfg], t.dataset.unit);
      // El estado de "Costos" (listos o faltan) cambia con lo que cargaste
      const listos = P.costsReady(App.cfg);
      const h = el.querySelector('#aj-costos .panel-head');
      if (h) {
        const c = h.querySelector(':scope > .chip');
        const b = h.querySelector('.ico-bubble');
        if (c) c.outerHTML = listos ? chip('Listos', 'good') : chip('Faltan cargar', 'warn');
        if (b) b.className = 'ico-bubble tone-' + (listos ? 'good' : 'warn');
      }
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
