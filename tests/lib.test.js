const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../app/src/lib/util.js');
const O = require('../app/src/lib/orders.js');
const P = require('../app/src/lib/profit.js');
const A = require('../app/src/lib/ads.js');
const S = require('../app/src/lib/scripts.js');

test('teléfonos argentinos → formato WhatsApp', () => {
  const cases = {
    '1170302470': '5491170302470',
    '+541170302470': '5491170302470',
    '5491170302470': '5491170302470',
    '011 15 7030-2470': '5491170302470',
    '0341 155 123456': '5493415123456',
    '+54 9 341 695-2906': '5493416952906',
    '3416952906': '5493416952906',
  };
  for (const [raw, wa] of Object.entries(cases)) {
    const r = U.normalizePhoneAR(raw);
    assert.equal(r.wa, wa, raw);
    assert.equal(r.ok, true, raw);
  }
  assert.equal(U.normalizePhoneAR('12345').ok, false);
  assert.equal(U.normalizePhoneAR('').wa, '');
});

test('números de exportaciones en ES y EN', () => {
  assert.equal(U.parseNum('1.234,56'), 1234.56);
  assert.equal(U.parseNum('1,234.56'), 1234.56);
  assert.equal(U.parseNum('1234.56'), 1234.56);
  assert.equal(U.parseNum('12,5'), 12.5);
  assert.equal(U.parseNum('3,2%'), 3.2);
  assert.equal(U.parseNum('$ 1.500.000'), 1500000);
  assert.equal(U.parseNum('ARS 2.300,00'), 2300);
  assert.equal(U.parseNum('1,234'), 1234);
  assert.equal(U.parseNum('-'), null);
  assert.equal(U.parseNum(''), null);
});

test('fechas en hora argentina', () => {
  assert.equal(U.dayKeyAR('2026-04-13T02:49:09Z'), '2026-04-12');
  assert.equal(U.dayKeyAR('2026-04-13T03:00:00Z'), '2026-04-13');
  assert.equal(U.addDays('2026-02-28', 1), '2026-03-01');
  assert.deepEqual(U.dayRange('2026-10-08', '2026-10-10'), ['2026-10-08', '2026-10-09', '2026-10-10']);
  assert.equal(U.money(72990), '$ 72.990');
  assert.equal(U.money(-1500.4), '−$ 1.500');
});

test('CSV con comillas, punto y coma y saltos de línea', () => {
  const csv = 'Nombre del anuncio;Importe gastado (ARS);Compras\n"Dolor, hook 1";"1.234,50";2\n"Gym\nv2";500;0\n';
  const { headers, rows } = U.parseCSV(csv);
  assert.deepEqual(headers, ['Nombre del anuncio', 'Importe gastado (ARS)', 'Compras']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['Nombre del anuncio'], 'Dolor, hook 1');
  assert.equal(rows[1]['Nombre del anuncio'], 'Gym\nv2');
});

function gqlNode(over) {
  return Object.assign(
    {
      id: 'gid://shopify/Order/1',
      name: '#VC-1',
      createdAt: '2026-10-02T23:39:43Z',
      cancelledAt: null,
      closedAt: null,
      displayFinancialStatus: 'PENDING',
      displayFulfillmentStatus: 'UNFULFILLED',
      phone: '+541170302470',
      tags: ['releasit_cod_form'],
      note: null,
      customAttributes: [
        { key: 'Nombre', value: 'DAMIAN' },
        { key: 'WhatsApp', value: '1170302470' },
        { key: 'UTM source', value: 'tiktok' },
      ],
      totalPriceSet: { shopMoney: { amount: '76580.0' } },
      subtotalLineItemsQuantity: 3,
      shippingAddress: { firstName: 'DAMIAN', lastName: 'VALENTIN', address1: 'Castro 536', city: 'Buenos Aires', province: 'CABA', zip: 'C1217AAB' },
      lineItems: {
        nodes: [
          { title: 'Corrector de Postura ViaCare™', quantity: 2, originalUnitPriceSet: { shopMoney: { amount: '68990.0' } } },
          { title: 'Envio Prioritario + Seguro', quantity: 1, originalUnitPriceSet: { shopMoney: { amount: '3590.0' } } },
        ],
      },
      fulfillments: [],
    },
    over
  );
}

test('pedido de Shopify normalizado', () => {
  const o = O.fromGraphQL(gqlNode());
  assert.equal(o.units, 2);
  assert.equal(o.total, 76580);
  assert.equal(o.estado, 'pendiente');
  assert.equal(o.source, 'tiktok');
  assert.equal(o.phone.wa, '5491170302470');
  assert.equal(o.day, '2026-10-02');
  assert.deepEqual(o.extras, ['Envio Prioritario + Seguro']);
  const v = O.templateVars(o, {});
  assert.equal(v.nombre, 'Damian');
  assert.equal(v.cantidad, '2 correctores de postura');
});

test('estados de pedidos contra entrega', () => {
  const st = (over) => O.fromGraphQL(gqlNode(over)).estado;
  assert.equal(st({ displayFinancialStatus: 'VOIDED', cancelledAt: '2026-10-02T23:40:25Z' }), 'anulado');
  assert.equal(st({ displayFinancialStatus: 'VOIDED', cancelledAt: 'x', displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ createdAt: 'x' }] }), 'devuelto');
  assert.equal(st({ displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ createdAt: 'x' }] }), 'entregado');
  assert.equal(st({ displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ createdAt: 'x' }] }), 'en_camino');
});

test('advertencia de Dropi en la dirección', () => {
  const o = O.fromGraphQL(
    gqlNode({ tags: ['Dropi Sync Error'], note: 'Esquina - Nota Dropi: 3: La ciudad no existe en el departamento ingresado, por favor corregir. CIUDAD: CABA - DEPARTAMENTO: PROVINCIA DE BUENOS AIRES -- ' })
  );
  assert.ok(o.warnings.some((w) => w.startsWith('Dropi: La ciudad no existe')), o.warnings.join('|'));
});

test('tasas históricas y ganancia', () => {
  const old = '2026-04-01T15:00:00Z';
  const mk = (i, over) => O.fromGraphQL(gqlNode(Object.assign({ id: 'gid://shopify/Order/' + i, name: '#' + i, createdAt: old }, over)));
  const paid = { displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ createdAt: old }], totalPriceSet: { shopMoney: { amount: '72990' } } };
  const orders = [
    mk(1, paid),
    mk(2, paid),
    mk(3, paid),
    mk(4, { displayFinancialStatus: 'VOIDED', cancelledAt: old, displayFulfillmentStatus: 'FULFILLED', fulfillments: [{ createdAt: old }] }),
    mk(5, { displayFinancialStatus: 'VOIDED', cancelledAt: old }),
    mk(6, { displayFinancialStatus: 'VOIDED', cancelledAt: old }),
  ];
  const r = O.historicalRates(orders, Date.parse('2026-10-10T12:00:00Z'));
  assert.equal(r.confirmacion, 4 / 6);
  assert.equal(r.entrega, 3 / 4);
  assert.equal(r.ticketPromedio, 72990);

  const cfg = { costoUnidad: 12000, costoEnvio: 9000, costoDevolucion: 14000, comisionCobro: 0, otrosPorPedido: 0, fijosMensuales: 0 };
  const res = P.computeProfit({ orders, gastos: { '2026-04-01': { tiktok: 30000 } }, cfg, rates: r, confirm: new Map(), from: '2026-04-01', to: '2026-04-01' });
  // 3 entregados × (72990 − 2×12000 − 9000) − 1 devolución × 14000 − 30000 de anuncios
  assert.equal(Math.round(res.total.ganancia), 3 * (72990 - 24000 - 9000) - 14000 - 30000);
  assert.equal(res.total.pedidos, 6);
  assert.equal(res.total.anulados, 2);

  const be = P.breakEven(cfg, r);
  const margen = 72990 - 2 * 12000 - 9000;
  assert.equal(Math.round(be.cpaEquilibrio), Math.round((4 / 6) * (0.75 * margen - 0.25 * 14000)));
});

test('pedido pendiente confirmado por WhatsApp pesa como confirmado', () => {
  const o = O.fromGraphQL(gqlNode());
  const r = { confirmacion: 0.5, entrega: 0.9 };
  assert.deepEqual(P.weights(o, r, 'confirmado'), { wd: 0.9, wr: 0.09999999999999998, real: false });
  assert.equal(P.weights(o, r, 'cancelado').wd, 0);
  assert.equal(P.weights(o, r).wd, 0.45);
});

test('reporte de TikTok: mapeo, ángulos y decisiones', () => {
  const csv = [
    'Ad name,Cost,Impressions,Clicks (destination),Complete payment,2-second video views,Video views at 100%',
    'DOLOR_hook-confesion_v1,60000,20000,400,6,7000,900',
    'GYM_press_v2,45000,15000,60,0,1500,100',
    'medico kinesiologa v1,20000,8000,120,2,3000,400',
    'estetica remera,9000,3000,30,0,900,80',
    'Total,134000,46000,610,8,12400,1480',
  ].join('\n');
  const { headers, rows } = U.parseCSV(csv);
  assert.equal(A.detectPlatform(headers), 'tiktok');
  const map = A.detectMapping(headers);
  assert.equal(map.gasto, 'Cost');
  assert.equal(map.compras, 'Complete payment');
  assert.equal(map.clics, 'Clicks (destination)');
  const ads = A.aggregate(rows, map);
  assert.equal(ads.length, 4);
  const byName = Object.fromEntries(ads.map((a) => [a.nombre, a]));
  assert.equal(A.detectAngle('DOLOR_hook-confesion_v1'), 'dolor');
  assert.equal(A.detectAngle('GYM_press_v2'), 'gym');
  assert.equal(A.detectAngle('medico kinesiologa v1'), 'medico');
  assert.equal(A.detectAngle('estetica remera'), 'estetica');
  assert.equal(A.detectAngle('video nuevo 3'), 'otro');
  const cpaMax = 20000;
  assert.equal(A.decide(byName['DOLOR_hook-confesion_v1'], cpaMax).accion, 'escalar'); // CPA 10.000
  assert.equal(A.decide(byName['GYM_press_v2'], cpaMax).accion, 'apagar'); // 45.000 sin ventas
  assert.equal(A.decide(byName['medico kinesiologa v1'], cpaMax).accion, 'escalar'); // 2 ventas a la mitad
  assert.equal(A.decide(byName['estetica remera'], cpaMax).accion, 'esperar');
  const angles = A.byAngle(ads, (a) => A.detectAngle(a.nombre));
  const w = A.winner(angles);
  assert.equal(w.angulo, 'dolor');
});

test('reporte de Meta en español', () => {
  const headers = ['Nombre del anuncio', 'Importe gastado (ARS)', 'Impresiones', 'Clics en el enlace', 'Compras', 'Reproducciones de video de 3 segundos', 'ThruPlays'];
  assert.equal(A.detectPlatform(headers), 'meta');
  const map = A.detectMapping(headers);
  assert.equal(map.gasto, 'Importe gastado (ARS)');
  assert.equal(map.hook, 'Reproducciones de video de 3 segundos');
  assert.equal(map.completas, 'ThruPlays');
});

test('guiones: prompt, saneado y plantillas sin IA', () => {
  const opts = { angulo: 'dolor', personaje: 'oficinista_h', clips: 4, cantidad: 3, idiomaPrompt: 'en', oferta: 'Pagás al recibir' };
  const prompt = S.buildPrompt(opts);
  assert.match(prompt, /exactamente 4 clips de 8 s/);
  assert.match(prompt, /JSON/);
  const fb = S.fallbackScripts(opts);
  assert.equal(fb.length, 3);
  for (const g of fb) {
    assert.equal(g.clips.length, 4);
    assert.equal(g.clips[3].hasta, 32);
    assert.ok(g.clips.every((c) => c.palabras <= S.MAX_WORDS), g.clips.map((c) => c.palabras).join(','));
    assert.ok(g.clips.every((c) => c.prompt.startsWith(g.ficha.slice(0, 40))));
    assert.ok(!/encorvada|sentada/.test(g.clips.map((c) => c.dialogo).join(' ')));
  }
  const clean = S.sanitize({ guiones: [{ titulo: 'x', clips: [{ dialogo: 'hola che' }] }, { nada: 1 }] }, opts);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].clips[0].palabras, 2);
  assert.match(S.scriptAsText(fb[0]), /CLIP 1 \(0–8 s\)/);
});

test('CSV exportado de Shopify (una fila por ítem)', () => {
  const csv = [
    'Name,Email,Financial Status,Paid at,Fulfillment Status,Fulfilled at,Total,Created at,Lineitem quantity,Lineitem name,Lineitem price,Shipping Name,Shipping Address1,Shipping City,Shipping Zip,Shipping Province Name,Shipping Phone,Notes,Note Attributes,Cancelled at,Id,Tags',
    '#VC-5,,pending,,unfulfilled,,76580,2026-10-09 21:10:00 -0300,2,Corrector de Postura,68990,Ana Paz,Mitre 120,Rosario,2000,Santa Fe,+543415550000,,"WhatsApp: 3415550000\nUTM source: tiktok",,555,releasit_cod_form',
    '#VC-5,,,,,,,,1,Envio Prioritario + Seguro,3590,,,,,,,,,,,',
    '#VC-4,,voided,,unfulfilled,,68990,2026-10-08 10:00:00 -0300,1,Corrector de Postura,68990,Luis Gil,Sarmiento 5,Córdoba,5000,Córdoba,,,,2026-10-08 12:00:00 -0300,554,',
  ].join('\n');
  const list = O.fromShopifyCSV(U.parseCSV(csv).rows);
  assert.equal(list.length, 2);
  const [a, b] = list;
  assert.equal(a.name, '#VC-5');
  assert.equal(a.units, 2);
  assert.equal(a.estado, 'pendiente');
  assert.equal(a.phone.wa, '5493415550000');
  assert.equal(a.source, 'tiktok');
  assert.equal(a.day, '2026-10-09');
  assert.equal(b.estado, 'anulado');
});

test('montos tipeados en pesos', () => {
  assert.equal(U.parseMoney('12.000'), 12000);
  assert.equal(U.parseMoney('$ 1.500.000'), 1500000);
  assert.equal(U.parseMoney('1.500,5'), 1500.5);
  assert.equal(U.parseMoney('9500'), 9500);
  assert.equal(U.parseMoney(''), null);
});
