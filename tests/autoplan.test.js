const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../app/src/lib/autoplan.js');
const S = require('../app/src/lib/scripts.js');

const HOY = '2026-10-10';
const tienda = { precio1: 68990, precio2: 72990 };

function ad(angulo, desde, over) {
  return Object.assign({ anunciante: 'Tienda ' + angulo, angulo, desde, gancho: 'Gancho de ' + angulo + ' ' + desde, ultimaVez: '2026-10-09T15:00:00Z' }, over);
}

test('autoplan: el ganador reciente del reporte de anuncios manda', () => {
  const r = P.plan({ ultimoAnalisis: { ganador: 'gym', fecha: '2026-10-05T12:00:00Z' }, competencia: { ads: [ad('dolor', '2026-08-01')] }, tienda, cfg: { cantidad: 2, clips: 5 }, hoy: HOY });
  assert.equal(r.opts.angulo, 'gym');
  assert.match(r.razones[0], /^Ángulo Gym: es el ganador de tu último reporte de anuncios/);
  assert.ok(['fit_m', 'fit_h'].includes(r.opts.personaje));
  assert.equal(r.opts.cantidad, 2);
  assert.equal(r.opts.clips, 5);
  assert.equal(r.opts.personajeLibre, '');
  assert.equal(r.opts.idiomaPrompt, 'en');
  assert.equal(r.opts.oferta, 'Pagás al recibir. Llevando 2 pagás $ 72.990 en total');
});

test('autoplan: ganador viejo → ángulo más repetido en la competencia con 21+ días', () => {
  const ads = [
    ad('estetica', '2026-09-01'),
    ad('estetica', '2026-08-20'),
    ad('dolor', '2026-09-05'),
    // nuevos (menos de 21 días): no cuentan aunque sean más
    ad('medico', '2026-10-01'),
    ad('medico', '2026-10-02'),
    ad('medico', '2026-10-03'),
    // fuera de los 4 ángulos
    ad('regalo', '2026-07-01'),
    ad('regalo', '2026-07-02'),
    ad('regalo', '2026-07-03'),
    // no se ve hace meses: probablemente se apagó
    ad('gym', '2026-01-01', { ultimaVez: '2026-05-01T12:00:00Z' }),
    ad('gym', '2026-01-02', { ultimaVez: '2026-05-01T12:00:00Z' }),
    ad('gym', '2026-01-03', { ultimaVez: '2026-05-01T12:00:00Z' }),
  ];
  const r = P.plan({ ultimoAnalisis: { ganador: 'gym', fecha: '2026-08-01T12:00:00Z' }, competencia: { ads, escaneo: { fecha: '2026-10-08T12:00:00Z' } }, tienda, hoy: HOY });
  assert.equal(r.opts.angulo, 'estetica');
  assert.match(r.razones[0], /^Ángulo Estética: .*competencia.*21\+ días/);
  assert.match(r.razones[0], /2 de 3/);
  assert.match(r.razones[0], /más de 14 días/);
  // Ganchos de inspiración: primero los del ángulo elegido, máximo 3, solo de anuncios con 21+ días
  assert.match(r.opts.extra, /inspiración, sin copiar/);
  assert.match(r.opts.extra, /Gancho de estetica 2026-08-20/);
  assert.doesNotMatch(r.opts.extra, /medico/);
  assert.equal((r.opts.extra.match(/"Gancho/g) || []).length, 3);
});

test('autoplan: usa el campo dias si viene y deduplica ganchos', () => {
  const ads = [
    { angulo: 'gym', dias: 40, gancho: '¿Te duele la espalda en el gym?' },
    { angulo: 'gym', dias: 30, gancho: 'Te duele la espalda en el gym' },
    { angulo: 'dolor', dias: 25, gancho: 'Otro "gancho"\ncon salto' },
  ];
  const r = P.plan({ competencia: { ads }, tienda, hoy: HOY });
  assert.equal(r.opts.angulo, 'gym');
  assert.equal((r.opts.extra.match(/espalda en el gym/g) || []).length, 1);
  assert.match(r.opts.extra, /"Otro 'gancho' con salto"/);
});

test('autoplan: sin datos rota por el ángulo menos usado', () => {
  const vacio = P.plan({ tienda, hoy: HOY });
  assert.equal(vacio.opts.angulo, 'dolor');
  assert.match(vacio.razones[0], /rotación/);
  assert.equal(vacio.opts.extra, '');

  const historial = [
    { fecha: '2026-10-01T10:00:00Z', angulo: 'dolor', personaje: 'oficinista' },
    { fecha: '2026-10-02T10:00:00Z', angulo: 'medico', personaje: 'senior' },
    { fecha: '2026-10-04T10:00:00Z', angulo: 'gym', personaje: 'fit_m' },
    { fecha: '2026-10-03T10:00:00Z', angulo: 'dolor', personaje: 'joven' },
  ];
  const r = P.plan({ historial, tienda, hoy: HOY });
  assert.equal(r.opts.angulo, 'estetica');
  // Estética: oficinista y fit_m se usaron en las últimas 3 tandas (por fecha: senior, joven, fit_m) → oficinista libre
  assert.equal(r.opts.personaje, 'oficinista');
  assert.match(r.razones[1], /no lo usaste en las últimas tandas/);

  // A igual cantidad de usos, el que hace más que no se usa
  const h2 = [
    { fecha: '2026-10-01', angulo: 'dolor' },
    { fecha: '2026-10-02', angulo: 'medico' },
    { fecha: '2026-10-03', angulo: 'estetica' },
    { fecha: '2026-10-04', angulo: 'gym' },
  ];
  assert.equal(P.plan({ historial: h2, hoy: HOY }).opts.angulo, 'dolor');
});

test('autoplan: personajes compatibles y sin repetir las últimas 3 tandas', () => {
  const an = { ganador: 'dolor', fecha: '2026-10-09T12:00:00Z' };
  const h = [
    { fecha: '2026-10-05', angulo: 'dolor', personaje: 'oficinista' },
    { fecha: '2026-10-06', angulo: 'dolor', personaje: 'oficinista_h' },
    { fecha: '2026-10-07', angulo: 'dolor', personaje: 'senior' },
  ];
  assert.equal(P.plan({ ultimoAnalisis: an, historial: h, hoy: HOY }).opts.personaje, 'joven');
  const h2 = h.concat([{ fecha: '2026-10-08', angulo: 'dolor', personaje: 'joven' }]);
  // oficinista ya salió de las últimas 3
  assert.equal(P.plan({ ultimoAnalisis: an, historial: h2, hoy: HOY }).opts.personaje, 'oficinista');

  // Gym tiene solo 2 personajes: si los dos se usaron hace poco, el que hace más que no se usa
  const g = { ganador: 'gym', fecha: '2026-10-09T12:00:00Z' };
  const hg = [
    { fecha: '2026-10-07', angulo: 'gym', personaje: 'fit_h' },
    { fecha: '2026-10-08', angulo: 'gym', personaje: 'fit_m' },
  ];
  const r = P.plan({ ultimoAnalisis: g, historial: hg, hoy: HOY });
  assert.equal(r.opts.personaje, 'fit_h');
  assert.equal(r.opts.genero, 'm');
  assert.match(r.razones[1], /hace más que no usás/);

  for (const [ang, lista] of Object.entries(P.COMPATIBLES)) for (const k of lista) assert.ok(S.PERSONAJES[k], ang + ' → ' + k);
});

test('autoplan: oferta desde la tienda', () => {
  assert.equal(P.plan({ tienda: { precio1: 68990 }, hoy: HOY }).opts.oferta, 'Pagás al recibir. Sale $ 68.990');
  assert.equal(P.plan({ tienda: {}, hoy: HOY }).opts.oferta, 'Pagás al recibir.');
  assert.equal(P.plan({ tienda: { precio1: '68.990', precio2: '72.990' }, hoy: HOY }).opts.oferta, 'Pagás al recibir. Llevando 2 pagás $ 72.990 en total');
});

test('autoplan: la duda más repetida entra en el pedido extra', () => {
  const objeciones = [
    { tipo: 'precio', n: 2, ejemplo: '¿cuánto sale?' },
    { tipo: 'positivo', n: 9, ejemplo: 'me encantó' },
    { tipo: 'comodidad', n: 4, ejemplo: 'es incómodo?' },
  ];
  const r = P.plan({ objeciones, tienda, hoy: HOY, cfg: { cantidad: 3 } });
  assert.match(r.opts.extra, /^Uno de los guiones responde la duda más repetida en los comentarios: ¿es incómodo\? ¿se nota abajo de la ropa\? \(ej\.: 'es incómodo\?'\)\.$/);
  assert.ok(r.razones.some((x) => /^Un guion responde '¿es incómodo/.test(x) && /4 veces/.test(x)));
  const uno = P.plan({ objeciones, tienda, hoy: HOY, cfg: { cantidad: 1 } });
  assert.match(uno.opts.extra, /^El guion responde/);
  const salud = P.plan({ objeciones: [{ tipo: 'salud', n: 1, ejemplo: 'tengo hernia' }], hoy: HOY });
  assert.match(salud.opts.extra, /kinesiólogo/);
});

test('autoplan: el plan sirve para buildPrompt y respeta los topes', () => {
  const r = P.plan({ cfg: { cantidad: 9, clips: 1 }, idioma: 'es', hoy: HOY });
  assert.equal(r.opts.cantidad, 5);
  assert.equal(r.opts.clips, 3);
  assert.equal(r.opts.idiomaPrompt, 'es');
  const prompt = S.buildPrompt(Object.assign({}, r.opts, { producto: S.PRODUCTO_DEFAULT }));
  assert.match(prompt, /Escribí 5 guiones/);
  assert.match(prompt, /exactamente 3 clips/);
  assert.match(prompt, /ÁNGULO: Dolor/);
  assert.match(prompt, /OFERTA: Pagás al recibir\./);
});

test('autoplan: objeciones agrupadas por tipo, sin positivos ni otros', () => {
  const docs = new Map([
    ['a', { tipo: 'comodidad', ejemplo: 'viejo', creada: '2026-09-01T00:00:00Z' }],
    ['b', { tipo: 'comodidad', ejemplo: 'nuevo', creada: '2026-10-01T00:00:00Z' }],
    ['c', { tipo: 'positivo', ejemplo: 'genial' }],
    ['d', { tipo: 'otro', ejemplo: 'jaja' }],
    ['e', { tipo: 'precio', ejemplo: '' }],
  ]);
  assert.deepEqual(P.objeciones(docs), [
    { tipo: 'comodidad', n: 2, ejemplo: 'nuevo' },
    { tipo: 'precio', n: 1, ejemplo: '' },
  ]);
  assert.deepEqual(P.objeciones(null), []);
});

test('autoplan: historial con las últimas 10 tandas', () => {
  let h = [];
  for (let i = 0; i < 12; i++) h = P.sumarHistorial(h, { fecha: '2026-10-' + String(i + 1).padStart(2, '0') + 'T10:00:00Z', angulo: 'dolor', personaje: 'senior', extra: 'x' });
  assert.equal(h.length, 10);
  assert.equal(h[9].fecha, '2026-10-12T10:00:00Z');
  assert.deepEqual(Object.keys(h[0]).sort(), ['angulo', 'fecha', 'personaje']);
});

test('autoplan: el documento guardado no pasa el tope de tamaño', () => {
  const opts = { angulo: 'dolor', personaje: 'senior', clips: 6, cantidad: 5, producto: 'x' };
  const largo = 'palabra '.repeat(1500);
  const guiones = S.sanitize({ guiones: Array.from({ length: 5 }, () => ({ titulo: 't', ficha: largo, clips: Array.from({ length: 6 }, () => ({ dialogo: 'hola', prompt: largo })) })) }, opts);
  const doc = P.armarDoc({ fecha: '2026-10-10T10:00:00Z', origen: 'auto', motivo: '', razones: ['a'], opts, guiones, historial: [] }, 60000);
  assert.ok(P.bytes(doc) <= 60000);
  assert.ok(doc.guiones.length >= 1);
  assert.equal(doc.opts.producto, undefined);
  const chico = P.armarDoc({ fecha: 'f', origen: 'manual', guiones: guiones.slice(0, 1).map((g) => Object.assign({}, g, { ficha: 'corta', clips: g.clips.slice(0, 1).map((c) => Object.assign({}, c, { prompt: 'p' })) })) });
  assert.equal(chico.guiones[0].ficha, 'corta');
});

test('autoplan: textos de motivo y resumen', () => {
  assert.equal(P.motivoTexto('auto'), 'se escribió sola al abrir el panel');
  assert.match(P.motivoTexto('cadena', 'competencia'), /escaneo de la competencia/);
  assert.match(P.motivoTexto('manual'), /Generar ahora/);
  assert.equal(P.resumen(3, 'dolor'), 'Escribí 3 guiones nuevos (ángulo Dolor)');
  assert.equal(P.resumen(1, 'gym'), 'Escribí 1 guion nuevo (ángulo Gym)');
});
