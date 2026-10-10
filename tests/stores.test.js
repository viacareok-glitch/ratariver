const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../app/src/lib/research.js');
const S = require('../app/src/lib/stores.js');

function prod(id, title, o) {
  const x = o || {};
  return {
    id,
    title,
    handle: x.handle || 'p' + id,
    product_type: x.tipo || '',
    created_at: x.creado || '2026-01-10T10:00:00-03:00',
    published_at: x.publicado || x.creado || '2026-01-10T10:00:00-03:00',
    variants: (x.variantes || [{ price: x.precio || '10000.00', compare_at_price: x.tachado || null, available: x.disponible !== false }]).map((v, i) => Object.assign({ id: id * 100 + i, title: 'V' + i }, v)),
  };
}

function catalogo(list) {
  return R.parseShopifyProducts(JSON.stringify({ products: list }));
}

test('foto compacta: postura primero, después lo más nuevo, con tope', () => {
  const list = catalogo([
    prod(1, 'Almohada', { publicado: '2026-09-01T10:00:00-03:00' }),
    prod(2, 'Faja lumbar', { publicado: '2026-03-01T10:00:00-03:00' }),
    prod(3, 'Corrector de postura Pro', { publicado: '2026-05-01T10:00:00-03:00', tachado: '89990.00', precio: '49990.00' }),
    prod(4, 'Masajeador', { publicado: '2026-10-01T10:00:00-03:00' }),
    prod(5, 'ViaFit X', { tipo: 'Corrector de postura' }),
  ]);
  const foto = S.snapshot(list);
  assert.deepEqual(
    foto.map((p) => p.id),
    ['3', '5', '2', '4', '1']
  );
  assert.equal(foto[0].postura, true);
  assert.equal(foto[0].tachado, 89990);
  assert.equal(foto[1].postura, true); // por el tipo, aunque el título no lo diga
  assert.equal(foto[4].postura, false);
  assert.equal('imagen' in foto[0], false);
  assert.equal(S.snapshot(list, 2).length, 2);
  assert.equal(S.principal(foto, {}).id, '3');
  assert.equal(S.principal(foto, { p5: 300, p3: 20 }).id, '5'); // el que más reseñas tiene
});

test('catálogo cortado: rescata los productos completos', () => {
  const full = JSON.stringify({ products: [prod(1, 'Corrector A'), prod(2, 'Corrector B'), prod(3, 'Corrector C')] });
  const ok = S.leerCatalogo('pretty print ' + full);
  assert.equal(ok.productos.length, 3);
  assert.equal(ok.parcial, false);
  const cortado = full.slice(0, full.length - 40);
  const r = S.leerCatalogo(cortado);
  assert.ok(r);
  assert.equal(r.parcial, true);
  assert.deepEqual(
    r.productos.map((p) => p.id),
    ['1', '2']
  );
  assert.equal(S.leerCatalogo('<html>Not found</html>'), null);
  assert.match(S.motivoError('Opening soon. Enter store using password'), /contraseña/);
  assert.match(S.motivoError('<html>Hola</html>'), /Shopify/);
});

test('revisar: primera revisión, cambios, reseñas e historial', () => {
  const t1 = '2026-10-01T12:00:00Z';
  const c1 = catalogo([
    prod(1, 'Corrector de postura Pro', { handle: 'corrector', precio: '49990.00', tachado: '89990.00', creado: '2026-05-01T10:00:00-03:00' }),
    prod(2, 'Almohada', { precio: '29990.00' }),
    prod(3, 'Faja', { precio: '19990.00', disponible: false }),
    prod(4, 'Rodillera', { variantes: [{ price: '9990.00', available: true }, { price: '9990.00', available: true }] }),
    prod(9, 'Taza', {}),
  ]);
  const a = S.revisar(null, { dominio: 'https://www.Tienda.com.ar/', fecha: t1, productos: c1, resenas: { corrector: 120, p3: null }, origen: 'anuncio' });
  assert.equal(a.doc.dominio, 'tienda.com.ar');
  assert.equal(a.doc.origen, 'anuncio');
  assert.equal(a.doc.agregada, t1);
  assert.equal(a.doc.cambios, null);
  assert.equal(a.novedades, 0);
  assert.equal(a.doc.ultima.total, 5);
  assert.equal(a.doc.ultima.agotados, 1);
  assert.deepEqual(a.doc.ultima.resenas, { corrector: 120 });
  assert.equal(a.doc.historial.length, 1);
  assert.equal(a.doc.historial[0].precioCorrector, 49990);
  assert.equal(a.doc.historial[0].resenasTotal, 120);

  const t2 = '2026-10-05T12:00:00Z';
  const c2 = catalogo([
    prod(1, 'Corrector de postura Pro', { handle: 'corrector', precio: '44990.00', tachado: '89990.00', creado: '2026-05-01T10:00:00-03:00' }),
    prod(2, 'Almohada', { precio: '29990.00', disponible: false }),
    prod(3, 'Faja', { precio: '19990.00' }),
    prod(4, 'Rodillera', { variantes: [{ price: '9990.00', available: true }, { price: '9990.00', available: false }] }),
    prod(7, 'Corrector Kids', { handle: 'kids', creado: '2026-10-03T10:00:00-03:00' }),
  ]);
  const b = S.revisar(a.doc, { dominio: 'tienda.com.ar', fecha: t2, productos: c2, resenas: { corrector: 135, kids: 4, p3: null }, origen: 'manual' });
  const k = b.doc.cambios;
  assert.equal(b.doc.origen, 'anuncio'); // se mantiene el origen guardado
  assert.equal(k.desde, t1);
  assert.equal(k.fecha, t2);
  assert.deepEqual(
    k.nuevos.map((p) => p.titulo),
    ['Corrector Kids']
  );
  assert.deepEqual(
    k.quitados.map((p) => p.titulo),
    ['Taza']
  );
  assert.deepEqual(k.precios, [{ titulo: 'Corrector de postura Pro', handle: 'corrector', antes: 49990, ahora: 44990 }]);
  assert.deepEqual(
    k.agotados.map((p) => p.titulo),
    ['Almohada']
  );
  assert.deepEqual(
    k.repuestos.map((p) => p.titulo),
    ['Faja']
  );
  assert.deepEqual(k.variantes, [{ titulo: 'Rodillera', handle: 'p4', antes: 2, ahora: 1, de: 2 }]);
  assert.deepEqual(k.resenas, [{ titulo: 'Corrector de postura Pro', handle: 'corrector', antes: 120, ahora: 135, suma: 15 }]);
  assert.deepEqual(b.cuenta, { nuevos: 1, precios: 1, agotados: 1, repuestos: 1, resenas: 15 });
  assert.equal(b.novedades, 19);
  assert.deepEqual(b.doc.ultima.resenas, { corrector: 135, kids: 4 });
  assert.equal(b.doc.historial.length, 2);
  const h = b.doc.historial[1];
  assert.equal(h.precioCorrector, 44990);
  assert.equal(h.resenasNuevas, 15);
  assert.equal(h.repuestos, 1);
  assert.equal(h.seAgotaron, 1);
  assert.equal(h.resenasTotal, 139);

  // Una lectura que falla conserva la foto anterior y anota el error
  const t3 = '2026-10-06T12:00:00Z';
  const c = S.revisar(b.doc, { dominio: 'tienda.com.ar', fecha: t3, productos: null, error: 'No es una tienda Shopify o tiene el catálogo oculto.' });
  assert.equal(c.novedades, 0);
  assert.equal(c.doc.ultima.fecha, t2);
  assert.equal(c.doc.ultima.intento, t3);
  assert.match(c.doc.ultima.error, /Shopify/);
  assert.equal(c.doc.ultima.productos.length, 5);
  assert.equal(c.doc.historial.length, 2);
  assert.equal(c.doc.cambios, b.doc.cambios);
  // Un catálogo vacío no borra lo anterior
  const v = S.revisar(b.doc, { dominio: 'tienda.com.ar', fecha: t3, productos: [] });
  assert.match(v.doc.ultima.error, /no muestra productos/);
  assert.equal(v.doc.ultima.productos.length, 5);
  // Error en una tienda que nunca se pudo leer
  const n = S.revisar(null, { dominio: 'otra.com', fecha: t3, productos: null, error: 'x' });
  assert.equal(n.doc.ultima.fecha, null);
  assert.equal(n.doc.origen, 'manual');
});

test('historial con tope y foto recortada sin falsos productos nuevos', () => {
  let doc = null;
  const muchos = [];
  for (let i = 1; i <= 200; i++) muchos.push(prod(i, 'Producto ' + i, { publicado: '2026-0' + (1 + (i % 9)) + '-01T10:00:00-03:00' }));
  for (let d = 1; d <= 12; d++) {
    const fecha = '2026-10-' + String(d).padStart(2, '0') + 'T12:00:00Z';
    doc = S.revisar(doc, { dominio: 'grande.com', fecha, productos: catalogo(muchos), resenas: {} }).doc;
  }
  assert.equal(doc.historial.length, S.TOPE_HISTORIAL);
  assert.equal(doc.ultima.productos.length, S.TOPE_PRODUCTOS);
  assert.equal(doc.ultima.truncado, true);
  assert.equal(doc.ultima.total, 200);
  assert.equal(doc.cambios.conteo.nuevos, 0);
  assert.equal(doc.cambios.conteo.quitados, 0);
  // Un producto publicado después de la revisión anterior sí cuenta como nuevo
  const mas = muchos.concat([prod(999, 'Lanzamiento', { publicado: '2026-10-12T20:00:00Z' })]);
  const r = S.revisar(doc, { dominio: 'grande.com', fecha: '2026-10-13T12:00:00Z', productos: catalogo(mas), resenas: {} });
  assert.deepEqual(
    r.doc.cambios.nuevos.map((p) => p.titulo),
    ['Lanzamiento']
  );
  // Catálogo parcial: no se puede saber qué se quitó
  const p = S.revisar(r.doc, { dominio: 'grande.com', fecha: '2026-10-14T12:00:00Z', productos: catalogo(mas.slice(0, 50)), parcial: true, resenas: {} });
  assert.equal(p.doc.cambios.conteo.quitados, 0);
  assert.ok(JSON.stringify(p.doc).length < 150000);
});

test('ajustar tamaño recorta la foto si el documento es muy grande', () => {
  const productos = [];
  for (let i = 0; i < 150; i++) productos.push({ id: String(i), titulo: 'x'.repeat(100), handle: 'h'.repeat(120), precioMin: 1, disponible: true });
  const doc = { dominio: 'a.com', ultima: { fecha: '2026-10-01T00:00:00Z', productos }, cambios: { nuevos: productos.slice(0, 20) } };
  const out = S.ajustarTamano(doc, 20000);
  assert.ok(JSON.stringify(out).length * 1.1 <= 20000);
  assert.equal(out.ultima.truncado, true);
  assert.equal(out.cambios.nuevos.length, 5);
  assert.equal(doc.ultima.productos.length, 150); // no toca el original
  const chico = { a: 1 };
  assert.equal(S.ajustarTamano(chico), chico); // si entra, se devuelve tal cual
});

test('movimiento: alto, medio y bajo con explicación', () => {
  const hoy = '2026-10-10';
  const corrector = { id: '1', titulo: 'Corrector de postura', handle: 'corrector', precioMin: 45000, disponible: true, variantes: 3, disponibles: 2, publicado: '2026-05-01T10:00:00-03:00', postura: true };
  const alto = {
    origen: 'anuncio',
    ultima: { fecha: '2026-10-09T12:00:00Z', productos: [corrector], resenas: { corrector: 200 } },
    historial: [
      { fecha: '2026-10-01T12:00:00Z', resenasNuevas: 0 },
      { fecha: '2026-10-05T12:00:00Z', resenasNuevas: 8, repuestos: 1 },
      { fecha: '2026-10-09T12:00:00Z', resenasNuevas: 6, precios: 1 },
    ],
  };
  const m = S.movimiento(alto, { hoy, anuncios: { anuncios: 3, diasMax: 40 } });
  assert.equal(m.nivel, 'alto');
  assert.ok(m.puntos >= 5);
  assert.match(m.texto, /^Sumó 14 reseñas desde el 1 oct/);
  assert.match(m.texto, /\.$/);
  assert.ok(m.motivos.some((x) => /hace 5 meses/.test(x.texto)));
  assert.ok(m.motivos.some((x) => /1 variante agotada/.test(x.texto)));
  assert.ok(m.motivos.some((x) => /3 anuncios guardados, uno activo hace 40 días/.test(x.texto)));

  const medio = {
    origen: 'manual',
    ultima: { fecha: '2026-10-09T12:00:00Z', productos: [Object.assign({}, corrector, { disponibles: 3, publicado: '2026-08-10T10:00:00-03:00' })], resenas: {} },
    historial: [{ fecha: '2026-10-01T12:00:00Z' }, { fecha: '2026-10-09T12:00:00Z', resenasNuevas: 1 }],
  };
  const md = S.movimiento(medio, { hoy });
  assert.equal(md.nivel, 'medio');
  assert.match(md.texto, /61 días publicado y con stock/);

  const bajo = {
    origen: 'manual',
    ultima: { fecha: '2026-10-09T12:00:00Z', productos: [Object.assign({}, corrector, { disponibles: 3, publicado: '2026-10-01T10:00:00-03:00' })], resenas: {} },
    historial: [{ fecha: '2026-10-09T12:00:00Z' }],
  };
  const b = S.movimiento(bajo, { hoy });
  assert.equal(b.nivel, 'bajo');
  assert.match(b.texto, /Primera revisión/);
  const agotado = S.movimiento({ ultima: { fecha: 'x', productos: [Object.assign({}, corrector, { disponible: false })] }, historial: [{}, {}] }, { hoy });
  assert.match(agotado.texto, /agotado/);
  assert.equal(S.movimiento({ ultima: null }).nivel, null);
  assert.equal(S.movimiento(null).texto, 'Todavía no se revisó.');
});

test('precio contra el tuyo y ventas estimadas', () => {
  assert.equal(S.compararPrecio(59990, 68990).texto, '$ 9.000 más barato que el tuyo (13%)');
  assert.equal(S.compararPrecio(59990, 68990).tono, 'warn');
  assert.equal(S.compararPrecio(78990, 68990).texto, '$ 10.000 más caro que el tuyo (14%)');
  assert.equal(S.compararPrecio(68000, 68990).texto, 'Casi el mismo precio que el tuyo');
  assert.equal(S.compararPrecio(null, 68990), null);
  assert.deepEqual(S.ventasEstimadas(12), { min: 120, max: 600 });
  assert.equal(S.ventasEstimadas(0), null);
});

test('dominios a revisar, anuncios por dominio y resumen de la corrida', () => {
  const docs = new Map([
    ['vieja.com', { ultima: { fecha: '2026-10-01T00:00:00Z', intento: '2026-10-02T00:00:00Z' } }],
    ['nueva.com', { ultima: { fecha: '2026-10-09T00:00:00Z' } }],
    ['quitada.com', { ultima: null }],
  ]);
  const ds = S.dominiosARevisar(['https://www.Sinrevisar.com.ar/x', 'instagram.com', 'nueva.com', 'no es dominio'], docs, ['quitada.com']);
  assert.deepEqual(ds, ['sinrevisar.com.ar', 'vieja.com', 'nueva.com']);
  assert.equal(S.dominiosARevisar(['a.com', 'b.com', 'c.com'], new Map(), [], 2).length, 2);
  assert.equal(S.docPath('https://www.Tienda.com/'), 'tiendas/tienda.com');
  assert.equal(S.docPath('nada'), '');

  const ads = S.anunciosPorDominio(
    [
      { dominio: 'tienda.com', desde: '2026-09-01' },
      { dominio: 'TIENDA.COM', dias: 10 },
      { dominio: '', desde: '2026-09-01' },
      { dominio: 'otra.com.ar' },
    ],
    '2026-10-10'
  );
  assert.deepEqual(ads['tienda.com'], { anuncios: 2, diasMax: 39 });
  assert.deepEqual(ads['otra.com.ar'], { anuncios: 1, diasMax: null });

  assert.equal(S.resumenCorrida(3, { nuevos: 2, precios: 1, agotados: 0, repuestos: 0, resenas: 14 }, 1), 'Revisé 3 tiendas: 3 cambios (2 productos nuevos, 1 cambio de precio) y 14 reseñas nuevas. 1 no se pudo leer.');
  assert.equal(S.resumenCorrida(1, {}, 0), 'Revisé 1 tienda: sin cambios.');
});
