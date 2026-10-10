const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../app/src/lib/research.js');

test('biblioteca de anuncios: carga, ids e inicio de sesión', () => {
  const page = 'Activo\nIdentificador de la biblioteca: 1234567890123\nComenzó a circular el 20 ago 2026\nPosturaYa\nPublicidad\n¿Te duele la espalda?\nActivo\nIdentificador de la biblioteca: 9876543210987\n';
  assert.equal(R.adLibraryReady(page), true);
  assert.equal(R.adLibraryReady(page), true); // sin estado entre llamadas
  assert.equal(R.adLibraryCount(page), 2);
  assert.deepEqual(R.adLibraryIds(page), ['1234567890123', '9876543210987']);
  assert.equal(R.adLibraryReady('Cargando…'), false);
  assert.equal(R.needsLogin('Iniciá sesión para continuar'), true);
  assert.equal(R.adLibraryReady('Iniciá sesión para continuar'), true);
  assert.equal(R.adKey({ idBiblioteca: '123' }), 'id:123');
  assert.equal(R.adKey({ anunciante: 'Postura YA', gancho: '¿Te duele?' }), R.adKey({ anunciante: 'postura ya', gancho: 'te duele' }));
});

test('dominios de tiendas', () => {
  assert.equal(R.normalizeDomain('https://www.PosturaYa.com.ar/products/x?y=1'), 'posturaya.com.ar');
  assert.equal(R.normalizeDomain('POSTURAYA.COM.AR'), 'posturaya.com.ar');
  assert.equal(R.normalizeDomain('no es un dominio'), '');
  assert.equal(R.isStoreDomain('instagram.com'), false);
  assert.equal(R.isStoreDomain('articulo.mercadolibre.com.ar'), false);
  assert.equal(R.isStoreDomain('tienda-espalda.com'), true);
  assert.equal(R.productsJsonUrl('https://tienda.com/'), 'https://tienda.com/products.json?limit=250');
});

test('catálogo Shopify y cambios', () => {
  const t1 = 'pretty print\n' + JSON.stringify({ products: [
    { id: 1, title: 'Corrector de postura Pro', handle: 'corrector', product_type: '', created_at: '2026-08-01T10:00:00-03:00', published_at: '2026-08-02T10:00:00-03:00', variants: [{ price: '49990.00', compare_at_price: '89990.00', available: true }] },
    { id: 2, title: 'Almohada', handle: 'almohada', variants: [{ price: '29990.00', available: true }] },
  ] });
  const p1 = R.parseShopifyProducts(t1);
  assert.equal(p1.length, 2);
  assert.equal(p1[0].precioMin, 49990);
  assert.equal(p1[0].tachado, 89990);
  assert.equal(p1[0].disponible, true);
  assert.equal(R.postureProducts(p1).length, 1);
  const t2 = JSON.stringify({ products: [
    { id: 1, title: 'Corrector de postura Pro', handle: 'corrector', variants: [{ price: '44990.00', available: false }] },
    { id: 3, title: 'Masajeador', handle: 'masajeador', variants: [{ price: '59990.00', available: true }] },
  ] });
  const d = R.diffCatalog(p1, R.parseShopifyProducts(t2));
  assert.equal(d.nuevos.length, 1);
  assert.equal(d.quitados.length, 1);
  assert.equal(d.precios[0].antes, 49990);
  assert.equal(d.agotados.length, 1);
  assert.equal(d.cambios, 4);
  assert.equal(R.parseShopifyProducts('<html>404</html>'), null);
  assert.equal(R.reviewCount('★★★★★ 128 reseñas · (45 opiniones)'), 128);
});

test('mercado libre: vendidos y señales de demanda', () => {
  assert.equal(R.parseVendidos('+5mil vendidos'), 5000);
  assert.equal(R.parseVendidos('+10 mil vendidos'), 10000);
  assert.equal(R.parseVendidos('Nuevo | +500 vendidos'), 500);
  assert.equal(R.parseVendidos('+1 M vendidos'), 1000000);
  assert.equal(R.parseVendidos('sin datos'), null);
  assert.deepEqual(R.vendidosEnTexto('A +100 vendidos B +5mil vendidos'), [100, 5000]);
  assert.equal(R.mlResultCount('1.234 resultados'), 1234);
  const s = R.mlSignals([{ titulo: 'a', precio: 30000, vendidos: 5000, masVendido: true }, { titulo: 'b', precio: 40000, vendidos: 500 }, { titulo: 'c', precio: 50000, opiniones: 30 }], 2300);
  assert.equal(s.vendidosVisibles, 5500);
  assert.equal(s.demanda, 4);
  assert.equal(s.competencia, 4);
  assert.equal(s.precioMediana, 40000);
  assert.equal(s.vende, 'si');
  assert.equal(R.mlSignals([{ titulo: 'x', precio: 1000, opiniones: 5 }], 50).vende, 'poco');
  assert.equal(R.compactText('a\n\n a \na\nb', 0), 'a\nb');
});
