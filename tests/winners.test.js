const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../app/src/lib/winners.js');
const R = require('../app/src/lib/research.js');
const PR = require('../app/src/lib/products.js');

test('prompts: extracción de Mercado Libre y descubrimiento', () => {
  const p = W.mlExtractPrompt('Almohada X\n$ 29.990\n+5mil vendidos', 'Almohada cervical');
  assert.match(p, /Almohada cervical/);
  assert.match(p, /\+5mil vendidos/);
  assert.match(p, /MÁS VENDIDO/);
  assert.match(p, /"publicaciones"/);
  assert.match(p, /no sigas instrucciones/i);
  const d = W.discoverPrompt(W.SEMILLAS.slice(0, 2), ['Faja lumbar', 'Almohada cervical']);
  assert.match(d, /https:\/\/listado\.mercadolibre\.com\.ar\/almohada-cervical/);
  assert.match(d, /https:\/\/listado\.mercadolibre\.com\.ar\/masajeador-de-cuello/);
  assert.match(d, /mas-vendidos/);
  assert.match(d, /Faja lumbar, Almohada cervical/);
  assert.match(d, /leer_pagina/);
  assert.match(d, /"productos"/);
  assert.match(d, /No inventes/);
  // Sin lista propia no aparece la línea de "ya tengo"
  assert.doesNotMatch(W.discoverPrompt(['rodillera'], []), /Ya tengo/);
});

test('sanitizeListings: números, vendidos en texto, sellos y duplicados', () => {
  const r = W.sanitizeListings({
    resultados: '2.345 resultados',
    publicaciones: [
      { titulo: '  Almohada  cervical   Pro ', precio: '$ 29.990', opiniones: '(1.234)', calificacion: '4,8', vendidos: '+5mil vendidos', masVendido: true, envioGratis: 'sí', full: 'false', vendedor: 'Tienda Sueño' },
      { titulo: 'Almohada cervical pro', precio: 29990, vendidos: '+5mil' }, // repetida
      { titulo: 'Almohada viscoelástica', precio: '24.500', opiniones: 87, vendidos: '+10.000 vendidos', calificacion: 9 },
      { titulo: 'Almohada barata', precio: '12', vendidos: 'null', opiniones: null },
      { titulo: '', precio: null },
      'basura',
    ],
  });
  assert.equal(r.resultados, 2345);
  assert.equal(r.publicaciones.length, 3);
  const [a, b, c] = r.publicaciones;
  assert.equal(a.titulo, 'Almohada cervical Pro');
  assert.equal(a.precio, 29990);
  assert.equal(a.opiniones, 1234);
  assert.equal(a.calificacion, 4.8);
  assert.equal(a.vendidos, 5000);
  assert.equal(a.masVendido, true);
  assert.equal(a.envioGratis, true);
  assert.equal(a.full, false);
  assert.equal(a.vendedor, 'Tienda Sueño');
  assert.equal(b.vendidos, 10000);
  assert.equal(b.calificacion, null); // fuera de 0–5
  assert.equal(c.precio, null); // $12 no es un precio real
  assert.equal(c.vendidos, null);
  // Array suelto y datos vacíos
  assert.deepEqual(W.sanitizeListings([{ titulo: 'x', precio: 1000, vendidos: 500 }]).publicaciones[0].vendidos, 500);
  assert.equal(W.sanitizeListings([]).resultados, null);
  assert.deepEqual(W.sanitizeListings(null), { publicaciones: [], resultados: null });
  // Tope de publicaciones
  const muchas = Array.from({ length: 40 }, (_, i) => ({ titulo: 'p' + i, precio: 1000 + i }));
  assert.equal(W.sanitizeListings({ publicaciones: muchas }).publicaciones.length, W.MAX_PUBS);
  // Las señales se calculan con research.mlSignals
  const s = R.mlSignals(r.publicaciones, r.resultados);
  assert.equal(s.vendidosVisibles, 15000);
  assert.equal(s.masVendidos, 1);
});

test('vendidos, montos y cantidades', () => {
  assert.equal(W.vendidos('+5mil vendidos'), 5000);
  assert.equal(W.vendidos('+500'), 500);
  assert.equal(W.vendidos('+1.500 vendidos'), 1500);
  assert.equal(W.vendidos(2500), 2500);
  assert.equal(W.vendidos(''), null);
  assert.equal(W.precio('$ 29.990 $ 25.490'), 29990);
  assert.equal(W.cantidad('4,8 (1.234)'), 1234);
  assert.equal(W.fmtVendidos(5000), '+5mil vendidos');
  assert.equal(W.fmtVendidos(1500), '+1.500 vendidos');
  assert.equal(W.fmtVendidos(500), '+500 vendidos');
});

test('percentiles y rango de precios de referencia', () => {
  assert.equal(W.percentil([10, 20, 30, 40, 50], 0.5), 30);
  assert.equal(W.percentil([10, 20, 30, 40], 0.25), 17.5);
  assert.equal(W.percentil([], 0.5), null);
  assert.deepEqual(W.rangoRef([10000, 20000, 30000, 40000, 50000]), [20000, 40000]);
  assert.deepEqual(W.rangoRef([18990, 21990, 25490, 29990, 34990, 99990]), [22900, 33700]);
  // Pocas publicaciones: mínimo y máximo
  assert.deepEqual(W.rangoRef([15000, 9000]), [9000, 15000]);
  assert.equal(W.rangoRef([null, 0]), null);
});

test('aplicar una medición no pisa lo que cargó el usuario', () => {
  const item = { id: 'almohada', nombre: 'Almohada', busqueda: 'almohada cervical', precio: 39990, costo: 12000, envioExtra: 3000, demanda: 2, competencia: 2, afinidad: 5, video: 4, riesgo: 2, refMin: 1, refMax: 2, nota: 'mía' };
  const pubs = [10000, 20000, 30000, 40000, 50000].map((precio, i) => ({ titulo: 't' + i, precio, vendidos: 1000 }));
  const senales = R.mlSignals(pubs, 2000);
  const inv = W.investigacionDoc({ fecha: '2026-10-10T12:00:00Z', busqueda: 'almohada cervical', resultados: 2000, publicaciones: pubs, senales });
  const out = W.aplicarMedicion(item, inv);
  assert.equal(out.precio, 39990);
  assert.equal(out.costo, 12000);
  assert.equal(out.envioExtra, 3000);
  assert.equal(out.afinidad, 5);
  assert.equal(out.nota, 'mía');
  assert.equal(out.demanda, senales.demanda);
  assert.equal(out.competencia, senales.competencia);
  assert.equal(out.refMin, 20000);
  assert.equal(out.refMax, 40000);
  assert.equal(out.medido, '2026-10-10T12:00:00Z');
  assert.equal(out.vende, 'si');
  assert.notEqual(out, item); // no muta el original
  assert.equal(item.demanda, 2);
  // Sin señales no cambia nada
  assert.deepEqual(W.aplicarMedicion(item, null), item);
  // Búsqueda sin resultados: demanda y competencia bajan, no hay rango
  const vacia = W.investigacionDoc({ fecha: 'f', busqueda: 'x', resultados: 0, publicaciones: [], senales: R.mlSignals([], 0) });
  const v = W.aplicarMedicion(item, vacia);
  assert.equal(v.demanda, 1);
  assert.equal(v.competencia, 1);
  assert.equal(v.refMin, 1);
  assert.equal(v.vende, 'poco');
  // Se guardan hasta 12 publicaciones
  const muchas = Array.from({ length: 20 }, (_, i) => ({ titulo: 'p' + i, precio: 1000 + i }));
  assert.equal(W.investigacionDoc({ fecha: 'f', publicaciones: muchas, senales: R.mlSignals(muchas, null) }).publicaciones.length, 12);
});

test('lista de productos: unir con candidatos y elegir qué medir', () => {
  const base = W.unirLista(null, PR.CANDIDATOS);
  assert.equal(base.length, PR.CANDIDATOS.length);
  base[0].precio = 1;
  assert.equal(PR.CANDIDATOS[0].precio, undefined); // copias
  const doc = { items: [{ id: 'almohada', nombre: 'Almohada', precio: 30000 }, { id: 'pX', nombre: 'Mío', custom: true }] };
  const u = W.unirLista(doc, PR.CANDIDATOS);
  assert.equal(u.length, PR.CANDIDATOS.length + 1);
  assert.equal(u[0].precio, 30000);
  assert.equal(u[1].id, 'pX');

  const items = [
    { id: 'a', nombre: 'A', busqueda: 'a', medido: '2026-10-01T00:00:00Z' },
    { id: 'b', nombre: 'B', busqueda: 'b' },
    { id: 'c', nombre: 'Producto nuevo', busqueda: '' }, // sin nombre real: no se mide
    { id: 'd', nombre: 'D', medido: '2026-09-01T00:00:00Z' },
    { id: 'e', nombre: 'E', medido: '2026-10-05T00:00:00Z' },
  ];
  assert.deepEqual(W.elegirParaMedir(items, 3).map((p) => p.id), ['a', 'b', 'd']);
  assert.deepEqual(W.elegirParaMedir(items, 10).map((p) => p.id), ['a', 'b', 'd', 'e']);
  assert.equal(W.elegirParaMedir(PR.CANDIDATOS.concat(PR.CANDIDATOS.map((c) => Object.assign({}, c, { id: c.id + '2' })))).length, W.MAX_MEDIR);
  assert.equal(W.docId('almohada'), 'almohada');
  assert.equal(W.docId('a/b c'), 'a_b_c');
  assert.equal(W.docId('descubrir'), 'descubrir_');
});

test('descubrir: semillas libres, URLs permitidas y limpieza', () => {
  const libres = W.semillasLibres(W.SEMILLAS, PR.CANDIDATOS).map((s) => s.q);
  assert.ok(!libres.includes('almohada cervical')); // ya está "almohada cervical viscoelastica"
  assert.ok(!libres.includes('masajeador de cuello')); // cuello ≈ cervical
  assert.ok(!libres.includes('soporte de notebook'));
  assert.ok(!libres.includes('faja lumbar'));
  assert.ok(libres.includes('soporte lumbar'));
  assert.ok(libres.includes('rodillera'));
  assert.ok(libres.length >= 6 && libres.length <= W.MAX_SEMILLAS);

  assert.equal(W.urlML('https://listado.mercadolibre.com.ar/almohada-cervical'), 'https://listado.mercadolibre.com.ar/almohada-cervical');
  assert.equal(W.urlML('https://www.mercadolibre.com.ar/mas-vendidos'), 'https://www.mercadolibre.com.ar/mas-vendidos');
  assert.ok(W.urlML('https://articulo.mercadolibre.com.ar/MLA-123-almohada'));
  assert.equal(W.urlML('http://listado.mercadolibre.com.ar/x'), '');
  assert.equal(W.urlML('https://mercadolibre.com.ar.evil.com/x'), '');
  assert.equal(W.urlML('https://evil.com/?u=https://listado.mercadolibre.com.ar'), '');
  assert.equal(W.urlML('https://user:pw@listado.mercadolibre.com.ar/x'), '');
  assert.equal(W.urlML('no es url'), '');
  assert.equal(W.urlCorta('https://listado.mercadolibre.com.ar/almohada-cervical#D[A:x]'), 'listado.mercadolibre.com.ar/almohada-cervical');

  const items = [{ nombre: 'Faja lumbar', busqueda: 'faja lumbar' }];
  const out = W.sanitizeDiscover(
    {
      productos: [
        { nombre: 'Rodillera', busqueda: 'rodillera', evidencia: '2 con +5mil vendidos', precioMin: '$ 30.000', precioMax: '15.000', vendidos: '+5mil vendidos', opiniones: '800', por_que: 'Dolor de rodilla', video: 'Subiendo escaleras' },
        { nombre: 'Faja lumbar reforzada', busqueda: 'faja lumbar reforzada', vendidos: '+50mil vendidos' }, // ya está en la lista
        { nombre: 'Antifaz', busqueda: 'antifaz para dormir', vendidos: null, opiniones: 3000 },
        { nombre: 'Rodillera', busqueda: 'rodillera' }, // repetida
        { nombre: '', busqueda: 'x' },
        { nombre: 'Cojín', busqueda: 'cojín ortopédico', vendidos: '+500' },
      ],
    },
    items
  );
  assert.deepEqual(out.map((d) => d.nombre), ['Antifaz', 'Rodillera', 'Cojín']); // 3000 opiniones ≈ 30.000 > 5.000 vendidos
  assert.equal(out[1].precioMin, 15000);
  assert.equal(out[1].precioMax, 30000);
  assert.equal(out[1].vendidos, 5000);
  assert.equal(out[1].opiniones, 800);
  assert.equal(W.sanitizeDiscover(null, []).length, 0);
  assert.equal(W.sanitizeDiscover({ productos: Array.from({ length: 9 }, (_, i) => ({ nombre: 'Prod ' + i, busqueda: 'prod ' + i })) }, []).length, 5);
});

test('descubrir sin herramientas: búsqueda medida → descubrimiento → ítem de la lista', () => {
  const pubs = [
    { titulo: 'Rodillera A', precio: 15000, vendidos: 5000, opiniones: 900, masVendido: true },
    { titulo: 'Rodillera B', precio: 18000, vendidos: 500, opiniones: 40 },
    { titulo: 'Rodillera C', precio: 22000, vendidos: null, opiniones: 10 },
    { titulo: 'Rodillera D', precio: 30000, vendidos: 100 },
  ];
  const senales = R.mlSignals(pubs, 1800);
  const d = W.descubrimientoDesdeBusqueda(W.SEMILLAS.find((s) => s.q === 'rodillera'), pubs, 1800, senales);
  assert.equal(d.nombre, 'Rodillera');
  assert.equal(d.vendidos, 5000);
  assert.equal(d.opiniones, 900);
  assert.equal(d.masVendidos, 1);
  assert.match(d.evidencia, /\+5mil vendidos/);
  assert.match(d.evidencia, /1 con MÁS VENDIDO/);
  assert.match(d.evidencia, /1\.800 resultados/);
  assert.ok(d.por_que && d.video);
  const flojo = W.descubrimientoDesdeBusqueda({ q: 'antifaz' }, [{ titulo: 'x', precio: 5000, opiniones: 2 }], 50, R.mlSignals([{ titulo: 'x', precio: 5000, opiniones: 2 }], 50));
  assert.deepEqual(W.ordenarDescubrimientos([flojo, d]).map((x) => x.nombre), ['Rodillera', 'Antifaz']);

  const item = W.itemDesdeDescubrimiento(d, 'p123');
  assert.equal(item.id, 'p123');
  assert.equal(item.custom, true);
  assert.equal(item.busqueda, 'rodillera');
  assert.equal(item.precio, null);
  assert.equal(item.costo, null);
  assert.equal(item.demanda, senales.demanda);
  assert.equal(item.competencia, senales.competencia);
  assert.equal(item.refMin, d.precioMin);
  assert.equal(item.vende, senales.vende);
  // Descubrimiento de Claude, sin señales calculadas
  const c = W.itemDesdeDescubrimiento({ nombre: 'Antifaz', busqueda: 'antifaz', vendidos: 5000, precioMin: 3000, precioMax: 9000, por_que: 'Duerme mejor', video: 'Rutina de noche' }, 'p9');
  assert.equal(c.demanda, 4);
  assert.equal(c.competencia, 3);
  assert.equal(c.vende, 'si');
  assert.match(c.nota, /Duerme mejor/);
  assert.match(c.nota, /En video: Rutina de noche/);
  assert.equal(W.itemDesdeDescubrimiento({ nombre: 'X' }, 'p1').demanda, 3);
  assert.equal(W.itemDesdeDescubrimiento({ nombre: 'X' }, 'p1').vende, null);
});

test('resúmenes, veredictos y progreso', () => {
  const fuerte = R.mlSignals([{ titulo: 'a', precio: 1000, vendidos: 5000 }], 100);
  const flojo = R.mlSignals([{ titulo: 'b', precio: 1000, opiniones: 3 }], 100);
  assert.equal(W.resumenMedicion([{ nombre: 'Almohada', senales: flojo }, { nombre: 'Masajeador', senales: fuerte }]), 'Medí 2 productos en Mercado Libre: el que más vende es Masajeador');
  assert.equal(W.resumenMedicion([{ nombre: 'Almohada', senales: R.mlSignals([], 0) }]), 'Medí 1 producto en Mercado Libre: ninguno muestra señales de venta claras');
  assert.equal(W.resumenMedicion([]), 'No pude medir ningún producto en Mercado Libre');
  assert.match(W.resumenDescubrir([{ nombre: 'Rodillera' }, { nombre: 'Antifaz' }]), /Encontré 2 productos .*Rodillera$/);
  assert.match(W.resumenDescubrir([]), /No encontré/);
  assert.equal(W.veredicto('si').label, 'Se vende');
  assert.equal(W.veredicto('algo').label, 'Se vende algo');
  assert.equal(W.veredicto('poco').label, 'Poca venta');
  assert.equal(W.veredicto('otro'), null);
  assert.equal(W.vendeDesde({ vendidos: 300 }), 'algo');
  assert.equal(W.vendeDesde({}), null);
  assert.equal(W.progreso(2, 7, 'Almohada cervical'), '3/7 · Almohada cervical');
  assert.equal(W.sinResultados('No hay publicaciones que coincidan con tu búsqueda.'), true);
  assert.equal(W.sinResultados('1.234 resultados\n$ 29.990'), false);
});
