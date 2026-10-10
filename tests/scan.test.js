const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../app/src/lib/scan.js');
const CP = require('../app/src/lib/competitors.js');

const AHORA = '2026-10-10T15:00:00.000Z';

function idsSecuenciales() {
  let n = 0;
  return () => 'anuevo' + ++n;
}

test('búsquedas: limpia, saca repetidas y respeta el tope', () => {
  assert.deepEqual(S.limpiarBusquedas(['  corrector   postural ', 'Corrector Postural', '', null, 'faja']), ['corrector postural', 'faja']);
  const muchas = Array.from({ length: 12 }, (_, i) => 'busqueda ' + i);
  assert.equal(S.limpiarBusquedas(muchas).length, 8);
  assert.equal(S.agregarBusqueda(['faja'], 'FAJA').error, 'Esa búsqueda ya está.');
  assert.equal(S.agregarBusqueda(['faja'], '   ').error, 'Escribí qué buscar.');
  assert.match(S.agregarBusqueda(muchas.slice(0, 8), 'otra').error, /hasta 8/);
  assert.deepEqual(S.agregarBusqueda(['faja'], ' corrector de espalda ').lista, ['faja', 'corrector de espalda']);
  assert.equal(S.progreso(1, 6, 'corrector de postura'), '2/6 · corrector de postura');
});

test('estado de la página de la biblioteca', () => {
  assert.equal(S.estadoPagina('Activo\nIdentificador de la biblioteca: 1234567890\n'), 'anuncios');
  assert.equal(S.estadoPagina('Comenzó a circular el 1 sep 2026'), 'anuncios');
  assert.equal(S.estadoPagina('Iniciá sesión para continuar'), 'login');
  assert.equal(S.estadoPagina('No hay anuncios que coincidan'), 'vacia');
  assert.equal(S.estadoPagina('¿Permitir el uso de cookies de Facebook en este navegador?'), 'cookies');
  assert.equal(S.estadoPagina('Cargando…'), 'cargando');
});

test('descarta identificadores que no están en la página', () => {
  const ads = [{ anunciante: 'A', gancho: 'x', idBiblioteca: '111111' }, { anunciante: 'B', gancho: 'y', idBiblioteca: '999999' }];
  const out = S.validarIds(ads, ['111111']);
  assert.equal(out[0].idBiblioteca, '111111');
  assert.equal(out[1].idBiblioteca, '');
  assert.equal(ads[1].idBiblioteca, '999999'); // no modifica el original
  assert.equal(S.validarIds(ads, [])[1].idBiblioteca, '999999'); // sin ids en el texto no hay con qué comparar
});

test('fusión: anuncio nuevo', () => {
  const m = S.mergeAds(new Map(), [{ anunciante: 'PosturaYa', gancho: '¿Te duele la espalda?', idBiblioteca: '123456', busqueda: 'corrector postural' }], AHORA, { makeId: idsSecuenciales() });
  assert.equal(m.nuevos.length, 1);
  assert.equal(m.escrituras.length, 1);
  const w = m.escrituras[0];
  assert.equal(w.id, 'anuevo1');
  assert.equal(w.nuevo, true);
  assert.equal(w.data.primeraVez, AHORA);
  assert.equal(w.data.ultimaVez, AHORA);
  assert.equal(w.data.cargado, AHORA);
  assert.equal(w.data.origen, 'auto');
  assert.equal(w.data.vistoVeces, 1);
  assert.equal(w.data.busqueda, 'corrector postural');
  assert.equal(m.docs.get('anuevo1').anunciante, 'PosturaYa');
});

test('fusión: existente por id se actualiza y completa lo que falta', () => {
  const guardados = new Map([['a1', { anunciante: 'PosturaYa', gancho: 'Viejo gancho', idBiblioteca: '123456', desde: '', precio: null, oferta: '2x1', cargado: '2026-09-01T10:00:00.000Z', vistoVeces: 2 }]]);
  const m = S.mergeAds(guardados, [{ anunciante: 'PosturaYa', gancho: 'Otro texto', idBiblioteca: '123456', desde: '2026-08-20', precio: 49990, oferta: 'envío gratis', dominio: 'posturaya.com.ar' }], AHORA, { makeId: idsSecuenciales() });
  assert.equal(m.nuevos.length, 0);
  const d = m.escrituras[0].data;
  assert.equal(m.escrituras[0].id, 'a1');
  assert.equal(m.escrituras[0].nuevo, false);
  assert.equal(d.ultimaVez, AHORA);
  assert.equal(d.vistoVeces, 3);
  assert.equal(d.desde, '2026-08-20');
  assert.equal(d.precio, 49990);
  assert.equal(d.oferta, '2x1'); // no pisa lo que ya estaba
  assert.equal(d.dominio, 'posturaya.com.ar');
  assert.equal(d.gancho, 'Viejo gancho');
  assert.equal(d.primeraVez, '2026-09-01T10:00:00.000Z'); // la toma de cuando se cargó
  assert.equal(guardados.get('a1').vistoVeces, 2); // no modifica lo guardado
});

test('fusión: un anuncio viejo sin id se reconoce por anunciante y gancho', () => {
  const guardados = [{ id: 'm1', anunciante: 'Postura YA', gancho: '¿Te duele la espalda?' }];
  const m = S.mergeAds(guardados, [{ anunciante: 'postura ya', gancho: 'Te duele la espalda', idBiblioteca: '777777' }], AHORA, { makeId: idsSecuenciales() });
  assert.equal(m.nuevos.length, 0);
  assert.equal(m.escrituras[0].id, 'm1');
  assert.equal(m.escrituras[0].data.idBiblioteca, '777777');
  assert.equal(m.escrituras[0].data.vistoVeces, 2);
  assert.equal(m.escrituras[0].data.primeraVez, undefined); // sin fecha de carga no inventamos cuándo apareció
});

test('fusión: sin id contra guardado con id, y dos ids distintos con el mismo texto', () => {
  const guardados = [{ id: 'g1', anunciante: 'Espalda Feliz', gancho: 'Mirá esto', idBiblioteca: '111111' }];
  const sinId = S.mergeAds(guardados, [{ anunciante: 'Espalda Feliz', gancho: 'Mirá esto' }], AHORA, { makeId: idsSecuenciales() });
  assert.equal(sinId.nuevos.length, 0);
  assert.equal(sinId.escrituras[0].id, 'g1');
  const otroId = S.mergeAds(guardados, [{ anunciante: 'Espalda Feliz', gancho: 'Mirá esto', idBiblioteca: '222222' }], AHORA, { makeId: idsSecuenciales() });
  assert.equal(otroId.nuevos.length, 1);
});

test('fusión: el mismo anuncio en dos búsquedas cuenta una vez', () => {
  const tocados = new Set();
  const makeId = idsSecuenciales();
  const ad = { anunciante: 'PosturaYa', gancho: 'Gancho', idBiblioteca: '555555', busqueda: 'corrector postural' };
  const m1 = S.mergeAds(new Map(), [ad, Object.assign({}, ad)], AHORA, { tocados, makeId });
  assert.equal(m1.nuevos.length, 1);
  assert.equal(m1.escrituras.length, 1);
  const m2 = S.mergeAds(m1.docs, [Object.assign({}, ad, { busqueda: 'faja postural', precio: 39990 })], AHORA, { tocados, makeId });
  assert.equal(m2.nuevos.length, 0);
  const d = m2.docs.get('anuevo1');
  assert.equal(d.vistoVeces, 1);
  assert.equal(d.busqueda, 'corrector postural');
  assert.equal(d.precio, 39990);
  // Un anuncio guardado visto en dos búsquedas suma una sola vez
  const viejo = new Map([['v1', { anunciante: 'X', gancho: 'Y', idBiblioteca: '888888', vistoVeces: 4 }]]);
  const t2 = new Set();
  const r1 = S.mergeAds(viejo, [{ anunciante: 'X', gancho: 'Y', idBiblioteca: '888888' }], AHORA, { tocados: t2 });
  const r2 = S.mergeAds(r1.docs, [{ anunciante: 'X', gancho: 'Y', idBiblioteca: '888888' }], AHORA, { tocados: t2 });
  assert.equal(r2.docs.get('v1').vistoVeces, 5);
  assert.equal(r2.escrituras.length, 0); // nada cambió
});

test('ids nuevos no chocan con los guardados', () => {
  const m = S.mergeAds(new Map([['fijo', { anunciante: 'Z', gancho: 'z', idBiblioteca: '1' }]]), [{ anunciante: 'Q', gancho: 'q' }], AHORA, { makeId: () => 'fijo' });
  assert.notEqual(m.nuevos[0].id, 'fijo');
  assert.match(S.nuevoId(1760108400000, () => 0.123456), /^a[0-9a-z]+$/);
});

test('anunciantes y tiendas nuevas', () => {
  const antes = [{ anunciante: 'PosturaYa' }];
  assert.deepEqual(S.anunciantesNuevos(antes, [{ anunciante: 'posturaya' }, { anunciante: 'Espalda Recta' }, { anunciante: 'espalda recta' }]), ['Espalda Recta']);
  const ads = [{ dominio: 'posturaya.com.ar' }, { dominio: 'instagram.com' }, { dominio: 'NUEVA-TIENDA.COM' }, { dominio: '' }, { dominio: 'otra.com.ar' }];
  const r = S.dominiosNuevos(ads, ['https://www.posturaya.com.ar/'], 20);
  assert.deepEqual(r.agregar, ['nueva-tienda.com', 'otra.com.ar']);
  assert.equal(r.lista.length, 3);
  const lleno = S.dominiosNuevos(ads, Array.from({ length: 19 }, (_, i) => 't' + i + '.com'), 20);
  assert.deepEqual(lleno.agregar, ['posturaya.com.ar']);
  assert.equal(lleno.lista.length, 20);
});

test('resumen por búsqueda y textos cortos', () => {
  const pb = S.porBusqueda([
    { q: 'corrector postural', estado: 'ok', anuncios: 5, nuevos: 2, error: '' },
    { q: 'faja', estado: 'sin', anuncios: 0, nuevos: 0, error: '' },
    { q: 'espalda', estado: 'error', anuncios: 0, nuevos: 0, error: 'Meta pide iniciar sesión' },
    { q: 'postura', estado: 'espera' },
  ]);
  assert.deepEqual(pb[0], { q: 'corrector postural', anuncios: 5, nuevos: 2, error: '' });
  assert.equal(pb[1].error, '');
  assert.equal(pb[2].error, 'Meta pide iniciar sesión');
  assert.equal(pb[3].error, S.NO_REVISADA);
  assert.equal(S.resumenCorto(0), 'Sin anuncios nuevos de la competencia');
  assert.equal(S.resumenCorto(1), 'Encontré 1 anuncio nuevo de la competencia');
  assert.equal(S.resumenCorto(4), 'Encontré 4 anuncios nuevos de la competencia');
  assert.equal(S.esNuevo({ primeraVez: AHORA }, AHORA), true);
  assert.equal(S.esNuevo({ primeraVez: '2026-10-01T00:00:00.000Z' }, AHORA), false);
  assert.equal(S.esNuevo({}, AHORA), false);
  assert.equal(S.esNuevo({ primeraVez: AHORA }, null), false);
});

test('ganadores, precios y documento del escaneo', () => {
  const ads = [
    { desde: '2026-09-01', precio: 50000 },
    { desde: '2026-10-05', precio: 30000 },
    { dias: 30, precio: null },
  ];
  assert.equal(S.ganadores(ads, '2026-10-10').length, 2);
  const p = S.preciosResumen(ads);
  assert.deepEqual(p, { n: 2, min: 30000, mediana: 40000, max: 50000 });
  const doc = S.armarEscaneo({ fecha: AHORA, porBusqueda: [], nuevos: 2, total: 9, ganadores: 3, nombresNuevos: ['A', 'B'], dominiosNuevos: ['x.com'], resumen: 'x'.repeat(9000) });
  assert.equal(doc.anunciantesNuevos, 2);
  assert.equal(doc.resumen.length, 8000);
  assert.ok(JSON.stringify(doc).length < 150 * 1024);
});

test('pedido de "Qué encontré"', () => {
  const nuevo = { anunciante: 'Espalda Recta', desde: '2026-10-08', angulo: 'oficina', oferta: '2x1', precio: 45990, formato: 'video', gancho: 'Si trabajás sentado, mirá esto' };
  const viejo = { anunciante: 'PosturaYa', desde: '2026-08-01', angulo: 'dolor', oferta: 'envío gratis', precio: 52990, formato: 'video', gancho: '¿Te duele la espalda al final del día?' };
  const txt = S.findingsPrompt({
    nuevos: [nuevo],
    ganadores: [viejo],
    porBusqueda: [{ q: 'corrector postural', anuncios: 2, nuevos: 1, error: '' }, { q: 'faja', anuncios: 0, nuevos: 0, error: 'No se revisó.' }],
    total: 2,
    hoy: '2026-10-10',
    datos: { tienda: 'ViaCare', precio1: 68990, precio2: 72990 },
  });
  for (const s of ['Novedades', 'Lo que les funciona', 'Precios', 'Qué probar en ViaCare', 'Espalda Recta', 'Home office', 'Si trabajás sentado', '70 días', '$ 68.990', '$ 72.990', 'mínimo $ 45.990', 'máximo $ 52.990', 'no se pudo leer', 'claims médicos', 'sin copiar', 'primeros 3 segundos', String(CP.GANADOR_DIAS)]) {
    assert.ok(txt.includes(s), 'falta: ' + s);
  }
  const vacio = S.findingsPrompt({ nuevos: [], ganadores: [], porBusqueda: [], total: 0, hoy: '2026-10-10', datos: {} });
  assert.ok(vacio.includes('Ninguno.'));
  assert.ok(vacio.includes('No cargué mis precios.'));
});
