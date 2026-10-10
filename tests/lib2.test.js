const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../app/src/lib/orders.js');
const OF = require('../app/src/lib/offers.js');
const C = require('../app/src/lib/customers.js');
const CM = require('../app/src/lib/comments.js');
const CP = require('../app/src/lib/competitors.js');
const PR = require('../app/src/lib/products.js');

const cfg = { costoUnidad: 12000, costoEnvio: 9000, costoDevolucion: 14000, comisionCobro: 0, otrosPorPedido: 0 };
const rates = { confirmacion: 0.5, entrega: 0.9 };

test('ofertas: economía por pedido y conversión necesaria', () => {
  const uno = OF.evaluate({ unidades: 1, precio: 68990 }, cfg, rates, 15000, 0);
  const margen = 68990 - 12000 - 9000;
  assert.equal(Math.round(uno.margenEntrega), margen);
  const esperado = 0.5 * (0.9 * margen - 0.1 * 14000);
  assert.equal(Math.round(uno.esperado), Math.round(esperado));
  assert.equal(Math.round(uno.ganancia), Math.round(esperado - 15000));

  const { evs, best } = OF.compare(OF.DEFAULT_OFERTAS, cfg, rates, 15000, 0);
  assert.equal(evs.length, 5);
  // 2 unidades a $72.990 cuesta una unidad más y cobra $4.000 más: a igual conversión deja menos
  assert.ok(evs[1].ganancia < evs[0].ganancia);
  // …y necesita más pedidos por peso invertido para empatar
  assert.ok(evs[1].liftNecesario > 0);
  // Verificación: con esa conversión extra iguala a la base
  const conLift = OF.evaluate(Object.assign({}, OF.DEFAULT_OFERTAS[1], { lift: evs[1].liftNecesario * 100 }), cfg, rates, 15000, 0);
  assert.equal(Math.round(conLift.ganancia), Math.round(evs[0].ganancia));
  assert.ok(best);
});

test('ofertas: una promo que no deja margen nunca empata', () => {
  const malo = OF.evaluate({ unidades: 3, precio: 30000 }, cfg, rates, 15000, 0);
  const base = OF.evaluate({ unidades: 1, precio: 68990 }, cfg, rates, 15000, 0);
  assert.equal(OF.liftNeeded(malo, base), null);
});

function order(i, over) {
  return O.fromGraphQL(
    Object.assign(
      {
        id: 'gid://shopify/Order/' + i,
        name: '#' + i,
        createdAt: '2026-08-01T15:00:00Z',
        closedAt: '2026-08-06T15:00:00Z',
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'FULFILLED',
        fulfillments: [{ createdAt: '2026-08-02T15:00:00Z' }],
        customAttributes: [{ key: 'WhatsApp', value: '11400000' + String(i).padStart(2, '0') }],
        shippingAddress: { firstName: 'ANA', lastName: 'PAZ', address1: 'Mitre 1', city: 'Rosario' },
        totalPriceSet: { shopMoney: { amount: '68990' } },
        lineItems: { nodes: [{ title: 'Corrector', quantity: 1 }] },
        tags: [],
      },
      over
    )
  );
}

test('reactivador: clientes que ya pagaron y oferta sugerida', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const orders = [
    order(1),
    order(2, { lineItems: { nodes: [{ title: 'Corrector', quantity: 2 }] } }),
    order(3, { createdAt: '2026-10-09T12:00:00Z', displayFinancialStatus: 'PENDING', displayFulfillmentStatus: 'UNFULFILLED', fulfillments: [], customAttributes: [{ key: 'WhatsApp', value: '1140000001' }] }),
    order(4, { displayFinancialStatus: 'VOIDED', cancelledAt: '2026-08-01T16:00:00Z', fulfillments: [], displayFulfillmentStatus: 'UNFULFILLED' }),
    order(5, { closedAt: '2026-10-05T12:00:00Z' }),
  ];
  const list = C.buildCustomers(orders, { now, minDias: 20 });
  assert.equal(list.length, 3); // el 4 nunca pagó
  const by = Object.fromEntries(list.map((c) => [c.wa, c]));
  assert.equal(by['5491140000001'].abierto, true); // tiene un pedido nuevo abierto
  assert.equal(by['5491140000001'].listo, false);
  assert.equal(by['5491140000002'].listo, true);
  assert.equal(by['5491140000005'].listo, false); // compró hace 5 días
  assert.equal(C.suggestOffer(by['5491140000002']), 'amigo');
  assert.equal(C.suggestOffer(by['5491140000005']), 'familia');
  assert.ok(C.reordered(by['5491140000001'], '2026-10-01T00:00:00Z'));
  const msg = C.message(by['5491140000002'], 'familia', { precioOferta: 45000, codigo: 'VUELVE20' }, { tienda: 'ViaCare', precio1: 68990 });
  assert.match(msg, /Ana/);
  assert.match(msg, /\$ 45\.000/);
  assert.match(msg, /VUELVE20/);
});

test('comentarios: clasificación y respuestas de 150 caracteres', () => {
  const d = { precio1: 68990, precio2: 72990, envio: 'Enviamos a todo el país', pago: 'pagás cuando te llega' };
  const cases = {
    '¿Hacen envíos a Córdoba?': 'envio',
    '¿es incómodo?': 'comodidad',
    '¿sirve de verdad o es verso?': 'duda',
    'cuanto sale??': 'precio',
    'Lo quiero, cómo lo compro': 'compra',
    'Tengo escoliosis, me sirve?': 'salud',
    'me llegó y es re cómodo!': 'positivo',
    '¿lo tengo que usar todo el día?': 'uso',
    'pedí hace 2 semanas y nunca me llegó': 'reclamo',
    'se paga con tarjeta?': 'pago',
    'sirve para hombre?': 'talle',
  };
  for (const [txt, tipo] of Object.entries(cases)) {
    assert.equal(CM.classify(txt).id, tipo, txt);
    for (const v of [0, 1]) {
      const r = CM.templateReply(txt, d, v);
      assert.ok(r.respuesta.length <= CM.MAX, txt + ' → ' + r.respuesta.length);
      assert.ok(r.respuesta.length > 10);
    }
  }
  assert.match(CM.templateReply('¿Hacen envíos a Córdoba?', d, 0).respuesta, /Córdoba/);
  assert.match(CM.templateReply('cuanto sale??', d, 0).respuesta, /\$ 68\.990/);
  assert.deepEqual(CM.splitComments('Juan\n¿llega a Salta?\n2d\nResponder\nVer 3 respuestas\n¿es incómodo?'), ['Juan', '¿llega a Salta?', '¿es incómodo?']);
});

test('competencia: fechas de la Biblioteca de anuncios y ganadores', () => {
  assert.equal(CP.parseDate('Comenzó a circular el 12 ago 2026'), '2026-08-12');
  assert.equal(CP.parseDate('12 de agosto de 2026'), '2026-08-12');
  assert.equal(CP.parseDate('Started running on Aug 3, 2026'), '2026-08-03');
  assert.equal(CP.parseDate('2026-09-30'), '2026-09-30');
  assert.equal(CP.parseDate('05/09/2026'), '2026-09-05');
  assert.equal(CP.daysActive('2026-09-10', '2026-10-10'), 30);
  const s = CP.summarize(
    [
      { anunciante: 'A', desde: '2026-08-01', angulo: 'dolor', oferta: '2x1' },
      { anunciante: 'B', desde: '2026-10-05', angulo: 'estetica', oferta: '2x1' },
      { anunciante: 'A', desde: '', angulo: 'dolor', oferta: '' },
    ],
    '2026-10-10'
  );
  assert.equal(s.total, 3);
  assert.equal(s.ganadores, 1);
  assert.equal(s.anunciantes, 2);
  assert.deepEqual(s.ofertas[0], ['2x1', 2]);
  assert.equal(s.ads[0].anunciante, 'A');
  assert.match(CP.adLibraryUrl('corrector postural'), /country=AR&q=corrector%20postural/);
  const clean = CP.sanitizeAds({ anuncios: [{ anunciante: 'X', desde: '3 sep 2026', gancho: 'Hola', angulo: 'raro', precio: '$ 39.990' }, {}] });
  assert.equal(clean.length, 1);
  assert.equal(clean[0].angulo, 'otro');
  assert.equal(clean[0].desde, '2026-09-03');
  assert.equal(clean[0].precio, 39990);
});

test('productos: margen y puntaje', () => {
  const p = Object.assign({}, PR.CANDIDATOS[1], { precio: 59990, costo: 18000 });
  const sc = PR.score(p, cfg, rates, 15000);
  assert.ok(sc.completo);
  assert.equal(Math.round(sc.eco.margenEntrega), 59990 - 18000 - 9000);
  assert.ok(sc.puntaje > 0 && sc.puntaje <= 100);
  const sinCosto = PR.score(PR.CANDIDATOS[1], cfg, rates, 15000);
  assert.equal(sinCosto.completo, false);
  assert.match(PR.mlUrl('Almohada cervical viscoelástica'), /listado\.mercadolibre\.com\.ar\/almohada-cervical-viscoelastica$/);
});
