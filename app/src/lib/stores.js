/*
 * Tiendas Shopify de la competencia: foto compacta del catálogo, comparación entre revisiones, historial
 * y "movimiento" (señales de venta). Shopify no publica ventas ni stock exacto: todo esto son señales.
 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const U = isNode ? require('./util.js') : root.VC.util;
  const R = isNode ? require('./research.js') : root.VC.research;

  const TOPE_PRODUCTOS = 150;
  const TOPE_HISTORIAL = 10;
  const TOPE_CAMBIOS = 20;
  const TOPE_RESENAS = 3; // productos de postura a los que se les cuentan reseñas
  const TOPE_TIENDAS = 12; // por corrida
  const DIAS_LANZAMIENTO = 30;
  const PAGINA = 250; // productos por página de /products.json
  const MAX_DOC = 140000; // bytes aproximados por documento (el límite es 256 KB)
  const COMPRAS_POR_RESENA = [10, 50]; // rango orientativo

  function docPath(dominio) {
    const d = R.normalizeDomain(dominio);
    return d ? 'tiendas/' + d : '';
  }

  function plural(n, uno, varios) {
    return U.int(n) + ' ' + (n === 1 ? uno : varios);
  }

  function lista(partes) {
    if (partes.length < 2) return partes.join('');
    return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
  }

  function capital(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function esPostura(p) {
    return p && p.postura != null ? !!p.postura : R.postureProducts([p]).length > 0;
  }

  function fechaProducto(p) {
    return (p && (p.publicado || p.creado)) || null;
  }

  /* Productos de postura ordenados: primero los que dicen corrector o postura, después los disponibles, después los más viejos */
  function posturaOrdenada(list) {
    const fuerte = (p) => (/corrector|postur/i.test(U.stripAccents(p.titulo || '')) ? 0 : 1);
    const t = (p) => {
      const x = Date.parse(fechaProducto(p));
      return Number.isFinite(x) ? x : Infinity;
    };
    return (list || [])
      .filter(esPostura)
      .slice()
      .sort((a, b) => fuerte(a) - fuerte(b) || (b.disponible ? 1 : 0) - (a.disponible ? 1 : 0) || t(a) - t(b));
  }

  /* El corrector "estrella" de la tienda: el de postura con más reseñas; si no hay reseñas, el primero de posturaOrdenada */
  function principal(productos, resenas) {
    const ps = posturaOrdenada(productos);
    if (!ps.length) return null;
    const r = resenas || {};
    let best = null;
    for (const p of ps) if (r[p.handle] != null && (best == null || r[p.handle] > r[best.handle])) best = p;
    return best || ps[0];
  }

  function compactProduct(p, postura) {
    return {
      id: String(p.id),
      titulo: String(p.titulo || '').slice(0, 100),
      handle: String(p.handle || '').slice(0, 120),
      precioMin: p.precioMin == null ? null : p.precioMin,
      tachado: p.tachado == null ? null : p.tachado,
      disponible: !!p.disponible,
      publicado: p.publicado || null,
      creado: p.creado || null,
      variantes: Number(p.variantes) || 0,
      disponibles: Number(p.disponibles) || 0,
      postura: !!postura,
    };
  }

  /*
   * Foto compacta para guardar: primero los de postura, después los más nuevos, hasta TOPE_PRODUCTOS.
   * productos: lista de VC.research.parseShopifyProducts.
   */
  function snapshot(productos, tope) {
    const all = productos || [];
    const post = posturaOrdenada(all);
    const ids = new Set(post.map((p) => p.id));
    const resto = all
      .filter((p) => !ids.has(p.id))
      .sort((a, b) => String(fechaProducto(b) || '').localeCompare(String(fechaProducto(a) || '')));
    return post
      .map((p) => compactProduct(p, true))
      .concat(resto.map((p) => compactProduct(p, false)))
      .slice(0, tope || TOPE_PRODUCTOS);
  }

  /*
   * El texto de /products.json puede venir cortado si la página es muy larga: rescata los productos completos
   * que alcanzaron a llegar. Devuelve {productos, parcial} o null si no es un catálogo de Shopify.
   */
  function leerCatalogo(texto) {
    const full = R.parseShopifyProducts(texto);
    if (full) return { productos: full, parcial: full.length >= PAGINA };
    const s = String(texto || '');
    const ini = s.search(/\{\s*"products"\s*:\s*\[/);
    if (ini < 0) return null;
    const re = /\{\s*"id"\s*:\s*\d+\s*,\s*"title"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*"handle"\s*:/g;
    re.lastIndex = ini;
    const cortes = [];
    let m;
    while ((m = re.exec(s))) cortes.push(m.index);
    // Prueba cortando antes del último producto empezado, después del anterior, y así (pocas veces)
    for (let i = cortes.length - 1; i >= 1 && i >= cortes.length - 4; i--) {
      const trozo = s.slice(ini, cortes[i]).replace(/[\s,]+$/, '') + ']}';
      const prods = R.parseShopifyProducts(trozo);
      if (prods && prods.length) return { productos: prods, parcial: true };
    }
    return null;
  }

  /* Mensaje claro cuando la página no trajo un catálogo */
  function motivoError(texto) {
    const s = String(texto || '');
    if (/(password|contraseña|Opening soon|Abriremos pronto|Enter store using password)/i.test(s)) return 'La tienda está cerrada con contraseña.';
    if (!s.trim()) return 'La página no cargó. Probá de nuevo más tarde.';
    return 'No es una tienda Shopify o tiene el catálogo oculto.';
  }

  function corto(p) {
    return { titulo: p.titulo, handle: p.handle, precio: p.precioMin == null ? null : p.precioMin };
  }

  /*
   * Compara la revisión anterior (doc.ultima) con el catálogo recién leído. Devuelve null en la primera revisión.
   * opts.parcial: el catálogo nuevo no está completo (no se puede saber qué se quitó).
   */
  function comparar(prevUltima, productos, opts) {
    if (!prevUltima || !prevUltima.fecha || !Array.isArray(prevUltima.productos)) return null;
    const o = opts || {};
    const d = R.diffCatalog(prevUltima.productos, productos);
    // Si la foto anterior estaba recortada, "nuevo" es solo lo publicado después de esa revisión
    if (prevUltima.truncado) {
      const desde = Date.parse(prevUltima.fecha);
      d.nuevos = d.nuevos.filter((p) => {
        const t = Date.parse(fechaProducto(p));
        return !Number.isFinite(t) || t > desde;
      });
    }
    if (o.parcial) d.quitados = [];
    const prevById = new Map(prevUltima.productos.map((p) => [p.id, p]));
    const variantes = [];
    for (const p of productos || []) {
      const a = prevById.get(p.id);
      if (!a || !a.disponible || !p.disponible || a.variantes !== p.variantes) continue;
      if (a.disponibles !== p.disponibles) variantes.push({ titulo: p.titulo, handle: p.handle, antes: a.disponibles, ahora: p.disponibles, de: p.variantes });
    }
    const conteo = { nuevos: d.nuevos.length, quitados: d.quitados.length, precios: d.precios.length, agotados: d.agotados.length, repuestos: d.repuestos.length, variantes: variantes.length };
    return {
      desde: prevUltima.fecha,
      fecha: o.fecha || null,
      nuevos: d.nuevos.slice(0, TOPE_CAMBIOS).map(corto),
      quitados: d.quitados.slice(0, TOPE_CAMBIOS).map(corto),
      precios: d.precios.slice(0, TOPE_CAMBIOS).map((x) => ({ titulo: x.producto.titulo, handle: x.producto.handle, antes: x.antes, ahora: x.ahora })),
      agotados: d.agotados.slice(0, TOPE_CAMBIOS).map(corto),
      repuestos: d.repuestos.slice(0, TOPE_CAMBIOS).map(corto),
      variantes: variantes.slice(0, TOPE_CAMBIOS),
      resenas: [],
      conteo,
    };
  }

  /*
   * Reseñas leídas ahora ({handle: n|null}) contra las anteriores. Si una lectura falló, se conserva el número anterior.
   * Devuelve {resenas, cambios: [{titulo, handle, antes, ahora, suma}], nuevas}.
   */
  function compararResenas(prev, ahora, productos) {
    const p = prev || {};
    const resenas = {};
    const cambios = [];
    let nuevas = 0;
    const titulo = new Map((productos || []).map((x) => [x.handle, x.titulo]));
    for (const [h, n] of Object.entries(ahora || {})) {
      if (n == null) {
        if (p[h] != null) resenas[h] = p[h];
        continue;
      }
      resenas[h] = n;
      if (p[h] != null) {
        const suma = Math.max(0, n - p[h]);
        nuevas += suma;
        cambios.push({ titulo: titulo.get(h) || h, handle: h, antes: p[h], ahora: n, suma });
      }
    }
    return { resenas, cambios, nuevas };
  }

  function lanzamientos(productos, hoy, dias) {
    const lim = dias || DIAS_LANZAMIENTO;
    return (productos || []).filter((p) => {
      const d = R.daysSince(fechaProducto(p), hoy);
      return d != null && d >= 0 && d <= lim;
    });
  }

  /* Una línea del historial a partir de la revisión guardada y sus cambios */
  function resumenRevision(ultima, cambios, resenasNuevas) {
    const ps = (ultima && ultima.productos) || [];
    const total = ultima && ultima.total != null ? ultima.total : ps.length;
    const agotados = ultima && ultima.agotados != null ? ultima.agotados : ps.filter((p) => !p.disponible).length;
    const c = principal(ps, ultima && ultima.resenas);
    const vals = Object.values((ultima && ultima.resenas) || {}).filter((n) => n != null);
    const k = (cambios && cambios.conteo) || {};
    return {
      fecha: ultima ? ultima.fecha : null,
      productos: total,
      disponibles: total - agotados,
      agotados,
      precioCorrector: c ? c.precioMin : null,
      resenasTotal: vals.length ? U.sum(vals) : null,
      resenasNuevas: resenasNuevas || 0,
      nuevos: k.nuevos || 0,
      precios: k.precios || 0,
      seAgotaron: k.agotados || 0,
      repuestos: k.repuestos || 0,
    };
  }

  function docBase(dominio, fecha, origen) {
    return { dominio: R.normalizeDomain(dominio), agregada: fecha, origen: origen === 'anuncio' ? 'anuncio' : 'manual', ultima: null, historial: [], cambios: null };
  }

  /*
   * Arma el documento nuevo de una tienda después de revisarla.
   * r: {dominio, fecha (ISO), productos (parseShopifyProducts o null), parcial, resenas {handle: n|null}, error, origen}
   * Devuelve {doc, cuenta: {nuevos, precios, agotados, repuestos, resenas}, novedades}.
   */
  function revisar(prev, r) {
    const fecha = r.fecha || new Date().toISOString();
    const base = Object.assign(docBase(r.dominio, fecha, r.origen), prev || {});
    base.dominio = R.normalizeDomain(r.dominio || base.dominio);
    base.historial = Array.isArray(base.historial) ? base.historial : [];
    const prevUltima = base.ultima && base.ultima.fecha ? base.ultima : null;
    const cuenta = { nuevos: 0, precios: 0, agotados: 0, repuestos: 0, resenas: 0 };
    let error = r.error || '';
    if (!error && (!r.productos || !r.productos.length)) error = r.productos ? 'La tienda no muestra productos en su catálogo público.' : 'No es una tienda Shopify o tiene el catálogo oculto.';
    if (error) {
      // Se conserva la última foto buena para comparar la próxima vez
      const ultima = Object.assign({ fecha: null, productos: [], resenas: {} }, prevUltima || {}, { intento: fecha, error: String(error).slice(0, 300) });
      return { doc: Object.assign({}, base, { ultima }), cuenta, novedades: 0 };
    }
    const productos = r.productos;
    const cambios = comparar(prevUltima, productos, { parcial: !!r.parcial, fecha });
    const res = compararResenas(prevUltima && prevUltima.resenas, r.resenas, productos);
    if (cambios) cambios.resenas = res.cambios.slice(0, TOPE_CAMBIOS);
    const foto = snapshot(productos);
    const ultima = {
      fecha,
      intento: fecha,
      total: productos.length,
      agotados: productos.filter((p) => !p.disponible).length,
      truncado: foto.length < productos.length,
      parcial: !!r.parcial,
      productos: foto,
      resenas: res.resenas,
      error: '',
    };
    const historial = base.historial.concat([resumenRevision(ultima, cambios, cambios ? res.nuevas : 0)]).slice(-TOPE_HISTORIAL);
    if (cambios) {
      cuenta.nuevos = cambios.conteo.nuevos;
      cuenta.precios = cambios.conteo.precios;
      cuenta.agotados = cambios.conteo.agotados;
      cuenta.repuestos = cambios.conteo.repuestos;
      cuenta.resenas = res.nuevas;
    }
    const doc = ajustarTamano(Object.assign({}, base, { ultima, historial, cambios }));
    return { doc, cuenta, novedades: cuenta.nuevos + cuenta.precios + cuenta.agotados + cuenta.repuestos + cuenta.resenas };
  }

  function tamano(doc) {
    return JSON.stringify(doc).length * 1.1; // margen por acentos y caracteres de más de un byte
  }

  /* Recorta el documento si se pasa de MAX_DOC: primero las listas de cambios, después la foto del catálogo */
  function ajustarTamano(doc, max) {
    const lim = max || MAX_DOC;
    if (tamano(doc) <= lim) return doc;
    const d = JSON.parse(JSON.stringify(doc));
    if (d.cambios) for (const k of ['nuevos', 'quitados', 'precios', 'agotados', 'repuestos', 'variantes', 'resenas']) if (Array.isArray(d.cambios[k])) d.cambios[k] = d.cambios[k].slice(0, 5);
    while (d.ultima && Array.isArray(d.ultima.productos) && d.ultima.productos.length > 10 && tamano(d) > lim) {
      d.ultima.productos = d.ultima.productos.slice(0, Math.floor(d.ultima.productos.length * 0.75));
      d.ultima.truncado = true;
    }
    return d;
  }

  /* Anuncios guardados por dominio (colección 'competencia'): {dominio: {anuncios, diasMax}} */
  function anunciosPorDominio(ads, hoy) {
    const out = {};
    const today = hoy || U.todayKeyAR();
    for (const a of ads || []) {
      const d = R.normalizeDomain(a && a.dominio);
      if (!d) continue;
      let dias = a.dias != null && Number.isFinite(Number(a.dias)) ? Number(a.dias) : null;
      if (dias == null && /^\d{4}-\d{2}-\d{2}$/.test(String(a.desde || ''))) dias = Math.max(0, U.daysBetween(a.desde, today));
      const o = out[d] || (out[d] = { anuncios: 0, diasMax: null });
      o.anuncios++;
      if (dias != null && (o.diasMax == null || dias > o.diasMax)) o.diasMax = dias;
    }
    return out;
  }

  function meses(dias) {
    const m = Math.floor(dias / 30);
    return m === 1 ? '1 mes' : m + ' meses';
  }

  /*
   * Movimiento de una tienda (alto, medio o bajo) con una explicación corta. Son señales, no ventas:
   * reseñas que suma, productos que se agotan y se reponen, su corrector agotado o con talles agotados,
   * cuánto lleva publicado y con stock, si pauta, lanzamientos recientes y cambios de precio.
   * opts: {hoy, anuncios: {anuncios, diasMax} | null}
   */
  function movimiento(doc, opts) {
    const o = opts || {};
    const hoy = o.hoy || U.todayKeyAR();
    const u = doc && doc.ultima;
    if (!u || !u.fecha) return { nivel: null, puntos: 0, motivos: [], texto: 'Todavía no se revisó.' };
    const h = Array.isArray(doc.historial) ? doc.historial : [];
    const suma = (k) => U.sum(h, (x) => Number(x[k]) || 0);
    const motivos = [];
    const add = (pts, texto) => motivos.push({ pts, texto });

    const rn = suma('resenasNuevas');
    if (rn > 0) add(rn >= 10 ? 3 : rn >= 3 ? 2 : 1, 'sumó ' + plural(rn, 'reseña', 'reseñas') + (h[0] && h[0].fecha ? ' desde el ' + U.fmtDay(U.dayKeyAR(h[0].fecha)) : ''));
    const rep = suma('repuestos');
    if (rep > 0) add(2, 'repuso ' + plural(rep, 'producto que se había agotado', 'productos que se habían agotado'));
    const ago = suma('seAgotaron');
    if (ago > 0) add(1, 'se le ' + (ago === 1 ? 'agotó 1 producto' : 'agotaron ' + U.int(ago) + ' productos'));

    const c = principal(u.productos, u.resenas);
    if (c) {
      const dias = R.daysSince(fechaProducto(c), hoy);
      if (!c.disponible) add(2, 'su corrector está agotado (demanda o falta de stock)');
      else if (c.variantes > 1 && c.disponibles < c.variantes) add(1, 'tiene ' + plural(c.variantes - c.disponibles, 'variante agotada', 'variantes agotadas') + ' en su corrector');
      if (c.disponible && dias != null && dias >= 90) add(2, 'su corrector sigue publicado y con stock hace ' + meses(dias));
      else if (c.disponible && dias != null && dias >= 45) add(1, 'su corrector lleva ' + dias + ' días publicado y con stock');
    }

    const ads = o.anuncios;
    if (ads && ads.anuncios) add(ads.diasMax != null && ads.diasMax >= 21 ? 2 : 1, 'pauta en Meta (' + plural(ads.anuncios, 'anuncio guardado', 'anuncios guardados') + (ads.diasMax != null && ads.diasMax >= 21 ? ', uno activo hace ' + ads.diasMax + ' días' : '') + ')');
    else if (doc.origen === 'anuncio') add(1, 'la encontramos pautando en Meta');

    const lz = lanzamientos(u.productos, hoy).length;
    if (lz >= 3) add(1, 'lanzó ' + lz + ' productos en ' + DIAS_LANZAMIENTO + ' días (está testeando)');
    const pr = suma('precios');
    if (pr > 0) add(1, 'movió ' + plural(pr, 'precio', 'precios'));

    const puntos = U.sum(motivos, (m) => m.pts);
    const nivel = puntos >= 5 ? 'alto' : puntos >= 2 ? 'medio' : 'bajo';
    const top = motivos
      .slice()
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 3)
      .map((m) => m.texto);
    const texto = top.length ? capital(lista(top)) + '.' : h.length < 2 ? 'Primera revisión: los cambios se ven a partir de la próxima.' : 'Sin señales de venta en las últimas revisiones.';
    return { nivel, puntos, motivos, texto };
  }

  /* Precio de su corrector contra el tuyo */
  function compararPrecio(suyo, mio) {
    if (!(suyo > 0) || !(mio > 0)) return null;
    const dif = suyo - mio;
    const pct = dif / mio;
    if (Math.abs(pct) < 0.02) return { dif, pct, tono: 'neutral', texto: 'Casi el mismo precio que el tuyo' };
    return dif < 0
      ? { dif, pct, tono: 'warn', texto: U.money(-dif) + ' más barato que el tuyo (' + U.pct(-pct) + ')' }
      : { dif, pct, tono: 'good', texto: U.money(dif) + ' más caro que el tuyo (' + U.pct(pct) + ')' };
  }

  /* Rango orientativo de ventas a partir de reseñas nuevas (si son reales) */
  function ventasEstimadas(resenasNuevas) {
    if (!(resenasNuevas > 0)) return null;
    return { min: resenasNuevas * COMPRAS_POR_RESENA[0], max: resenasNuevas * COMPRAS_POR_RESENA[1] };
  }

  /* Dominios a revisar: los de la configuración y los guardados, sin los quitados; primero los que hace más que no se miran */
  function dominiosARevisar(cfgDominios, docs, quitadas, tope) {
    const fuera = new Set((quitadas || []).map(R.normalizeDomain));
    const m = docs instanceof Map ? docs : new Map(Object.entries(docs || {}));
    const set = new Set();
    for (const d of (cfgDominios || []).concat([...m.keys()])) {
      const n = R.normalizeDomain(d);
      if (n && R.isStoreDomain(n) && !fuera.has(n)) set.add(n);
    }
    const ultimo = (d) => {
      const u = m.get(d) && m.get(d).ultima;
      return (u && (u.intento || u.fecha)) || '';
    };
    return [...set].sort((a, b) => ultimo(a).localeCompare(ultimo(b)) || a.localeCompare(b)).slice(0, tope || TOPE_TIENDAS);
  }

  /* Aviso corto de una corrida: totales = suma de las cuentas de revisar() */
  function resumenCorrida(n, totales, errores) {
    const t = totales || {};
    const cambios = (t.nuevos || 0) + (t.precios || 0) + (t.agotados || 0) + (t.repuestos || 0);
    const partes = [];
    if (t.nuevos) partes.push(plural(t.nuevos, 'producto nuevo', 'productos nuevos'));
    if (t.precios) partes.push(plural(t.precios, 'cambio de precio', 'cambios de precio'));
    if (t.agotados) partes.push(plural(t.agotados, 'agotado', 'agotados'));
    if (t.repuestos) partes.push(plural(t.repuestos, 'repuesto', 'repuestos'));
    let s = 'Revisé ' + plural(n, 'tienda', 'tiendas') + ': ' + (cambios ? plural(cambios, 'cambio', 'cambios') + ' (' + partes.join(', ') + ')' : 'sin cambios');
    if (t.resenas) s += ' y ' + plural(t.resenas, 'reseña nueva', 'reseñas nuevas');
    s += '.';
    if (errores) s += ' ' + (errores === 1 ? '1 no se pudo leer.' : errores + ' no se pudieron leer.');
    return s;
  }

  const api = {
    TOPE_PRODUCTOS,
    TOPE_HISTORIAL,
    TOPE_CAMBIOS,
    TOPE_RESENAS,
    TOPE_TIENDAS,
    DIAS_LANZAMIENTO,
    MAX_DOC,
    COMPRAS_POR_RESENA,
    docPath,
    docBase,
    posturaOrdenada,
    principal,
    snapshot,
    leerCatalogo,
    motivoError,
    comparar,
    compararResenas,
    lanzamientos,
    resumenRevision,
    revisar,
    ajustarTamano,
    anunciosPorDominio,
    movimiento,
    compararPrecio,
    ventasEstimadas,
    dominiosARevisar,
    resumenCorrida,
  };
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).stores = api;
})(typeof window !== 'undefined' ? window : globalThis);
