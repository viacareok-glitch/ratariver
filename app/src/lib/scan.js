/*
 * Escaneo automático de la competencia en la Biblioteca de anuncios de Meta: lógica pura.
 * Fusiona lo encontrado con los anuncios guardados, arma el resumen por búsqueda, detecta tiendas nuevas
 * y escribe el pedido de "Qué encontré" para Claude.
 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const U = isNode ? require('./util.js') : root.VC.util;
  const R = isNode ? require('./research.js') : root.VC.research;
  const CP = isNode ? require('./competitors.js') : root.VC.competitors;

  const MAX_BUSQUEDAS = 8;
  const MAX_DOMINIOS = 20;
  // Campos que se completan en un anuncio guardado si les faltan
  const COMPLETAR = ['desde', 'idBiblioteca', 'dominio', 'precio', 'oferta', 'busqueda'];

  /* ---------- Búsquedas ---------- */

  function limpiarBusqueda(q) {
    return String(q || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  }

  // Sin vacías ni repetidas (sin importar mayúsculas ni acentos), hasta `max`
  function limpiarBusquedas(list, max) {
    const out = [];
    const vistas = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const q = limpiarBusqueda(raw);
      const k = R.normKey(q);
      if (!k || vistas.has(k)) continue;
      vistas.add(k);
      out.push(q);
      if (out.length >= (max || MAX_BUSQUEDAS)) break;
    }
    return out;
  }

  function agregarBusqueda(list, q, max) {
    const lista = limpiarBusquedas(list, max);
    const nueva = limpiarBusqueda(q);
    if (!R.normKey(nueva)) return { lista, error: 'Escribí qué buscar.' };
    if (lista.some((x) => R.normKey(x) === R.normKey(nueva))) return { lista, error: 'Esa búsqueda ya está.' };
    if (lista.length >= (max || MAX_BUSQUEDAS)) return { lista, error: 'Podés tener hasta ' + (max || MAX_BUSQUEDAS) + ' búsquedas. Quitá una para agregar otra.' };
    return { lista: lista.concat(nueva), error: '' };
  }

  function progreso(i, n, q) {
    return i + 1 + '/' + n + ' · ' + q;
  }

  /* ---------- Página de la Biblioteca ---------- */

  // 'anuncios' | 'login' | 'vacia' | 'cookies' | 'cargando'
  function estadoPagina(text) {
    const s = String(text || '');
    if (R.adLibraryCount(s) > 0 || /(Comenz[oó] a circular|Started running)/i.test(s)) return 'anuncios';
    if (R.needsLogin(s)) return 'login';
    if (R.adLibraryReady(s)) return 'vacia';
    if (/cookies/i.test(s)) return 'cookies';
    return 'cargando';
  }

  // Si Claude devolvió un identificador que no está en la página, lo descartamos (mejor sin id que con uno inventado)
  function validarIds(ads, idsEnTexto) {
    const ok = new Set(idsEnTexto || []);
    return (ads || []).map((a) => (a.idBiblioteca && ok.size && !ok.has(a.idBiblioteca) ? Object.assign({}, a, { idBiblioteca: '' }) : a));
  }

  /* ---------- Fusión con lo guardado ---------- */

  // Clave por texto (anunciante + gancho), sin importar el identificador
  function textKey(a) {
    return R.adKey({ anunciante: a && a.anunciante, gancho: a && a.gancho });
  }

  function vacio(v) {
    return v == null || v === '';
  }

  function nuevoId(now, rand) {
    return 'a' + (now || Date.now()).toString(36) + (rand ? rand() : Math.random()).toString(36).slice(2, 6);
  }

  /*
   * guardados: Map(id → anuncio) o array [{id, ...}]. encontrados: anuncios de sanitizeAds (con `busqueda`).
   * ahora: ISO del escaneo. opts.tocados: Set de ids ya vistos en este escaneo (se suma vistoVeces una sola vez).
   * Devuelve {escrituras: [{id, data, nuevo}], nuevos: [{id, ...}], docs: Map actualizado}. No modifica `guardados`.
   */
  function mergeAds(guardados, encontrados, ahora, opts) {
    opts = opts || {};
    const tocados = opts.tocados || new Set();
    const makeId = opts.makeId || (() => nuevoId());
    const docs = new Map(guardados instanceof Map ? guardados : (guardados || []).map((a) => [a.id, a]));
    const porClave = new Map();
    const porTexto = new Map();
    const indexar = (id, a) => {
      porClave.set(R.adKey(a), id);
      const tk = textKey(a);
      const prev = porTexto.get(tk);
      // Para el cruce por texto preferimos el guardado sin identificador
      if (!prev || (docs.get(prev) && docs.get(prev).idBiblioteca && !a.idBiblioteca)) porTexto.set(tk, id);
    };
    for (const [id, a] of docs) indexar(id, a || {});

    const escrituras = new Map();
    const nuevos = [];
    for (const f of encontrados || []) {
      if (!f || (!f.anunciante && !f.gancho)) continue;
      let id = porClave.get(R.adKey(f));
      if (!id) {
        const c = porTexto.get(textKey(f));
        // Solo por texto si a alguno de los dos le falta el identificador: dos ids distintos son dos anuncios
        if (c && (!f.idBiblioteca || !docs.get(c).idBiblioteca)) id = c;
      }
      if (id) {
        const prev = docs.get(id);
        const next = Object.assign({}, prev);
        if (!tocados.has(id)) {
          next.ultimaVez = ahora;
          next.vistoVeces = (Number(prev.vistoVeces) || 1) + 1;
          tocados.add(id);
        }
        for (const k of COMPLETAR) if (vacio(prev[k]) && !vacio(f[k])) next[k] = f[k];
        if (!next.primeraVez && prev.cargado) next.primeraVez = prev.cargado;
        if (JSON.stringify(next) === JSON.stringify(prev)) continue;
        docs.set(id, next);
        const ya = escrituras.get(id);
        escrituras.set(id, { id, data: next, nuevo: ya ? ya.nuevo : false });
        if (ya && ya.nuevo) {
          const i = nuevos.findIndex((n) => n.id === id);
          if (i >= 0) nuevos[i] = Object.assign({ id }, next);
        }
        indexar(id, next);
      } else {
        id = makeId();
        for (let n = 1; docs.has(id); n++) id = makeId() + n.toString(36);
        const data = Object.assign({}, f, { primeraVez: ahora, ultimaVez: ahora, cargado: ahora, origen: 'auto', vistoVeces: 1 });
        docs.set(id, data);
        tocados.add(id);
        escrituras.set(id, { id, data, nuevo: true });
        nuevos.push(Object.assign({ id }, data));
        indexar(id, data);
      }
    }
    return { escrituras: [...escrituras.values()], nuevos, docs };
  }

  // Nombres de anunciantes de `nuevos` que no estaban entre los guardados antes del escaneo
  function anunciantesNuevos(antes, nuevos) {
    const conocidos = new Set((antes || []).map((a) => R.normKey(a && a.anunciante)).filter(Boolean));
    const out = [];
    for (const a of nuevos || []) {
      const k = R.normKey(a && a.anunciante);
      if (!k || conocidos.has(k)) continue;
      conocidos.add(k);
      out.push(String(a.anunciante).trim());
    }
    return out;
  }

  // Dominios de tiendas que aparecen en los anuncios y todavía no se revisan. lista = actuales + nuevos (tope total)
  function dominiosNuevos(ads, actuales, tope) {
    const max = tope || MAX_DOMINIOS;
    const base = Array.isArray(actuales) ? actuales.slice() : [];
    const set = new Set(base.map(R.normalizeDomain).filter(Boolean));
    const agregar = [];
    for (const a of ads || []) {
      const d = R.normalizeDomain(a && a.dominio);
      if (!d || !R.isStoreDomain(d) || set.has(d)) continue;
      if (set.size >= max) break;
      set.add(d);
      agregar.push(d);
    }
    return { agregar, lista: base.concat(agregar) };
  }

  /* ---------- Resumen del escaneo ---------- */

  const NO_REVISADA = 'No se revisó.';

  // items: [{q, estado, anuncios, nuevos, error}] → [{q, anuncios, nuevos, error}]
  function porBusqueda(items) {
    return (items || []).map((it) => ({
      q: String(it.q || '').slice(0, 80),
      anuncios: Number(it.anuncios) || 0,
      nuevos: Number(it.nuevos) || 0,
      error: it.error ? String(it.error).slice(0, 300) : it.estado === 'espera' || it.estado === 'omitida' ? NO_REVISADA : '',
    }));
  }

  function plural(n, uno, varios) {
    return n + ' ' + (n === 1 ? uno : varios);
  }

  function resumenCorto(nuevos) {
    return nuevos > 0 ? 'Encontré ' + plural(nuevos, 'anuncio nuevo', 'anuncios nuevos') + ' de la competencia' : 'Sin anuncios nuevos de la competencia';
  }

  function esNuevo(a, fechaEscaneo) {
    const p = Date.parse(a && a.primeraVez);
    const f = Date.parse(fechaEscaneo);
    return Number.isFinite(p) && Number.isFinite(f) && p >= f;
  }

  function ganadores(ads, hoy) {
    return (ads || []).filter((a) => {
      const d = a.dias != null ? a.dias : CP.daysActive(a.desde, hoy);
      return d != null && d >= CP.GANADOR_DIAS;
    });
  }

  function preciosResumen(ads) {
    const p = (ads || []).map((a) => Number(a && a.precio)).filter((n) => Number.isFinite(n) && n > 0);
    return { n: p.length, min: p.length ? Math.min(...p) : null, mediana: R.median(p), max: p.length ? Math.max(...p) : null };
  }

  // Documento 'escaneos/ultimo' con tamaños acotados
  function armarEscaneo(o) {
    return {
      fecha: o.fecha,
      porBusqueda: (o.porBusqueda || []).slice(0, MAX_BUSQUEDAS),
      nuevos: Number(o.nuevos) || 0,
      total: Number(o.total) || 0,
      ganadores: Number(o.ganadores) || 0,
      anunciantesNuevos: (o.nombresNuevos || []).length,
      nombresNuevos: (o.nombresNuevos || []).slice(0, 20).map((s) => String(s).slice(0, 80)),
      dominiosNuevos: (o.dominiosNuevos || []).slice(0, MAX_DOMINIOS),
      resumen: String(o.resumen || '').slice(0, 8000),
      aviso: String(o.aviso || '').slice(0, 300),
      errorResumen: String(o.errorResumen || '').slice(0, 300),
    };
  }

  /* ---------- Pedido a Claude: "Qué encontré" ---------- */

  function lineaAnuncio(a, hoy) {
    const dias = a.dias != null ? a.dias : CP.daysActive(a.desde, hoy);
    return [
      a.anunciante || 's/n',
      dias != null ? dias + ' días' : 's/f',
      CP.ANGULOS[a.angulo] || a.angulo || '',
      a.oferta || 'sin oferta',
      a.precio ? U.money(a.precio) : 's/p',
      a.formato || '',
      '"' + String(a.gancho || '').slice(0, 160) + '"',
    ].join(' | ');
  }

  /*
   * o = {nuevos: [anuncios], ganadores: [anuncios], porBusqueda: [{q, anuncios, nuevos, error}], total, hoy,
   *      datos: {tienda, precio1, precio2}, vistos?: [anuncios vistos en el escaneo, para los precios]}
   */
  function findingsPrompt(o) {
    const d = o.datos || {};
    const hoy = o.hoy || U.todayKeyAR();
    const nuevos = (o.nuevos || []).slice(0, 40);
    const gan = (o.ganadores || []).slice(0, 40);
    const precios = preciosResumen(o.vistos || (o.nuevos || []).concat(o.ganadores || []));
    const busq = (o.porBusqueda || []).map((b) => '- ' + b.q + ': ' + (b.error ? 'no se pudo leer (' + b.error + ')' : plural(b.anuncios, 'anuncio', 'anuncios') + ', ' + plural(b.nuevos, 'nuevo', 'nuevos')));
    const mios = d.precio1 ? 'Mis precios: 1 unidad ' + U.money(d.precio1) + (d.precio2 ? ', 2 unidades ' + U.money(d.precio2) : '') + '.' : 'No cargué mis precios.';
    return [
      'Sos estratega de creativos para e-commerce en Argentina. Mi tienda, ' + (d.tienda || 'ViaCare') + ', vende un corrector de postura con pago contra entrega por anuncios de TikTok y Meta.',
      'Hoy es ' + hoy + '. Acabo de escanear la Biblioteca de anuncios de Meta (Argentina, anuncios activos) con estas búsquedas:',
      busq.join('\n') || '- (ninguna)',
      'En total vi ' + plural(Number(o.total) || 0, 'anuncio distinto', 'anuncios distintos') + '.',
      '',
      'ANUNCIOS NUEVOS desde el escaneo anterior (anunciante | días activo | ángulo | oferta | precio | formato | gancho):',
      nuevos.length ? nuevos.map((a) => lineaAnuncio(a, hoy)).join('\n') : 'Ninguno.',
      '',
      'ACTIVOS HACE ' + CP.GANADOR_DIAS + ' DÍAS O MÁS (señal de que les rinde: nadie sostiene semanas un anuncio que pierde plata):',
      gan.length ? gan.map((a) => lineaAnuncio(a, hoy)).join('\n') : 'Ninguno.',
      '',
      'PRECIOS que se ven en los anuncios: ' +
        (precios.n ? plural(precios.n, 'anuncio', 'anuncios') + ' con precio; mínimo ' + U.money(precios.min) + ', mediana ' + U.money(precios.mediana) + ', máximo ' + U.money(precios.max) + '.' : 'ningún anuncio muestra precio.') +
        ' ' +
        mios,
      '',
      'Escribí "Qué encontré" en español rioplatense (con voseo), en texto plano sin markdown (nada de #, ** ni tablas), corto: máximo unas 300 palabras. Cuatro partes, cada una con su título solo en una línea y debajo viñetas con guion:',
      'Novedades: anuncios y anunciantes nuevos que valga la pena mirar. Si no hay, decilo en una línea.',
      'Lo que les funciona: ganchos, ángulos y ofertas que se repiten en los activos hace ' + CP.GANADOR_DIAS + ' días o más.',
      'Precios: los de la competencia contra los míos, y si estoy caro, en línea o barato.',
      'Qué probar en ViaCare: de 3 a 5 ideas, cada una con la primera frase, el ángulo y qué se ve en los primeros 3 segundos.',
      'Reglas: inspirate sin copiar textos de otros; nada de claims médicos ni promesas de cura (nada de "cura", "elimina el dolor" ni "corrige la columna"); no inventes datos que no estén arriba. Los días activos son una señal de que el anuncio rinde, no un dato de ventas: no digas cuánto venden.',
    ].join('\n');
  }

  const api = {
    MAX_BUSQUEDAS,
    MAX_DOMINIOS,
    NO_REVISADA,
    limpiarBusquedas,
    agregarBusqueda,
    progreso,
    estadoPagina,
    validarIds,
    textKey,
    nuevoId,
    mergeAds,
    anunciantesNuevos,
    dominiosNuevos,
    porBusqueda,
    resumenCorto,
    esNuevo,
    ganadores,
    preciosResumen,
    armarEscaneo,
    findingsPrompt,
  };
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).scan = api;
})(typeof window !== 'undefined' ? window : globalThis);
