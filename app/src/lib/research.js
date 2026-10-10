/*
 * Lectura de páginas públicas que trae el navegador: Biblioteca de anuncios de Meta, Mercado Libre y tiendas Shopify.
 * Solo lógica pura (sin red): detecta si la página terminó de cargar, compacta texto, lee catálogos y compara fotos.
 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const U = isNode ? require('./util.js') : root.VC.util;

  /* ---------- Texto ---------- */

  // Colapsa espacios, saca líneas vacías y repetidas seguidas, y corta en `max` caracteres
  function compactText(text, max) {
    const lines = String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
      .filter(Boolean);
    const out = [];
    for (const l of lines) if (out[out.length - 1] !== l) out.push(l);
    const s = out.join('\n');
    return max && s.length > max ? s.slice(0, max) : s;
  }

  /* ---------- Biblioteca de anuncios de Meta ---------- */

  const AD_MARK = /(Identificador de la biblioteca|Identificador de biblioteca|Library ID|Comenz[oó] a circular|Started running)/i;

  function adLibraryReady(text) {
    const s = String(text || '');
    return AD_MARK.test(s) || /(No hay anuncios|No se encontraron anuncios|No ads match|no results)/i.test(s) || needsLogin(s);
  }

  function adLibraryCount(text) {
    const m = String(text || '').match(/(Identificador de la biblioteca|Identificador de biblioteca|Library ID)/gi);
    return m ? m.length : 0;
  }

  function needsLogin(text) {
    const s = String(text || '');
    return !adLibraryCount(s) && /(Inici[aá] sesi[oó]n|Log in to|Log into Facebook|Entrar a Facebook|Iniciar sesi[oó]n en Facebook|You must log in)/i.test(s);
  }

  // Identificadores de la biblioteca que aparecen en el texto ("Identificador de la biblioteca: 1234567890")
  function adLibraryIds(text) {
    const ids = [];
    const re = /(?:Identificador de la biblioteca|Identificador de biblioteca|Library ID)\s*:?\s*(\d{6,})/gi;
    let m;
    while ((m = re.exec(String(text || '')))) ids.push(m[1]);
    return ids;
  }

  function adUrl(id) {
    return id ? 'https://www.facebook.com/ads/library/?id=' + encodeURIComponent(id) : '';
  }

  function normKey(s) {
    return U.stripAccents(String(s || ''))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Clave para no guardar dos veces el mismo anuncio
  function adKey(a) {
    if (a && a.idBiblioteca) return 'id:' + a.idBiblioteca;
    return 'tx:' + normKey(a && a.anunciante) + '|' + normKey(a && a.gancho).slice(0, 80);
  }

  /* ---------- Dominios y tiendas ---------- */

  // "https://www.PosturaYa.com.ar/products/x?y" → "posturaya.com.ar"
  function normalizeDomain(input) {
    let s = String(input || '')
      .trim()
      .toLowerCase();
    if (!s) return '';
    s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
    s = s.split(/[/?#\s]/)[0];
    s = s.replace(/:\d+$/, '').replace(/\.$/, '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return '';
    return s;
  }

  // Dominios que no son tiendas (redes, marketplaces, acortadores)
  const NO_TIENDA = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|whatsapp\.com|wa\.me|tiktok\.com|mercadolibre\.com(\.ar)?|mercadolibre\.com|meli\.la|google\.com|youtube\.com|linktr\.ee|bit\.ly|shopify\.com)$/;

  function isStoreDomain(d) {
    const n = normalizeDomain(d);
    return !!n && !NO_TIENDA.test(n);
  }

  function productsJsonUrl(domain, page) {
    return 'https://' + normalizeDomain(domain) + '/products.json?limit=250' + (page > 1 ? '&page=' + page : '');
  }

  function productUrl(domain, handle) {
    return 'https://' + normalizeDomain(domain) + '/products/' + encodeURIComponent(handle);
  }

  // El texto de una página JSON trae el JSON tal cual (a veces con texto del visor del navegador alrededor)
  function extractJson(text) {
    const s = String(text || '');
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch (e) {
      return null;
    }
  }

  function shopifyReady(text) {
    const s = String(text || '');
    return /"products"\s*:/.test(s) || /(404|not found|no encontrad|password|contraseña|Opening soon|Abriremos pronto)/i.test(s);
  }

  /*
   * Catálogo público de una tienda Shopify (/products.json). Shopify no publica ventas ni stock exacto:
   * se ve precio, precio tachado, si cada variante está disponible y las fechas de creación y publicación.
   */
  function parseShopifyProducts(text) {
    const data = extractJson(text);
    if (!data || !Array.isArray(data.products)) return null;
    return data.products.map((p) => {
      const vs = Array.isArray(p.variants) ? p.variants : [];
      const prices = vs.map((v) => U.parseNum(v.price)).filter((n) => n != null);
      const compare = vs.map((v) => U.parseNum(v.compare_at_price)).filter((n) => n != null && n > 0);
      return {
        id: String(p.id),
        titulo: String(p.title || ''),
        handle: String(p.handle || ''),
        tipo: String(p.product_type || ''),
        creado: p.created_at || null,
        publicado: p.published_at || null,
        actualizado: p.updated_at || null,
        precioMin: prices.length ? Math.min(...prices) : null,
        precioMax: prices.length ? Math.max(...prices) : null,
        tachado: compare.length ? Math.max(...compare) : null,
        variantes: vs.length,
        disponibles: vs.filter((v) => v.available !== false).length,
        disponible: vs.some((v) => v.available !== false),
        imagen: p.images && p.images[0] && p.images[0].src ? String(p.images[0].src) : '',
      };
    });
  }

  /*
   * Compara dos fotos del catálogo de una tienda: productos nuevos, quitados, cambios de precio y de stock.
   * prev/next: arrays de parseShopifyProducts.
   */
  function diffCatalog(prev, next) {
    const a = new Map((prev || []).map((p) => [p.id, p]));
    const b = new Map((next || []).map((p) => [p.id, p]));
    const nuevos = [];
    const quitados = [];
    const precios = [];
    const agotados = [];
    const repuestos = [];
    for (const [id, p] of b) {
      const o = a.get(id);
      if (!o) {
        nuevos.push(p);
        continue;
      }
      if (o.precioMin !== p.precioMin) precios.push({ producto: p, antes: o.precioMin, ahora: p.precioMin });
      if (o.disponible && !p.disponible) agotados.push(p);
      if (!o.disponible && p.disponible) repuestos.push(p);
    }
    for (const [id, p] of a) if (!b.has(id)) quitados.push(p);
    return { nuevos, quitados, precios, agotados, repuestos, cambios: nuevos.length + quitados.length + precios.length + agotados.length + repuestos.length };
  }

  /* Productos de la tienda que se parecen a un corrector de postura (para comparar precio) */
  function postureProducts(list) {
    return (list || []).filter((p) => /postur|corrector|espald|faja|chaleco|columna|hombro/i.test(U.stripAccents(p.titulo + ' ' + p.tipo)));
  }

  function daysSince(iso, today) {
    if (!iso) return null;
    return U.daysBetween(U.dayKeyAR(iso), today || U.todayKeyAR());
  }

  // "123 reseñas", "(45 opiniones)", "87 reviews" → el número más grande que aparezca
  function reviewCount(text) {
    const re = /(\d[\d.,]*)\s*(rese[nñ]as|opiniones|reviews|valoraciones|calificaciones|comentarios)/gi;
    let best = null;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const n = U.parseMoney(m[1]);
      if (n != null && (best == null || n > best)) best = n;
    }
    return best;
  }

  /* ---------- Mercado Libre ---------- */

  function mlReady(text) {
    const s = String(text || '');
    return /(\$\s?\d|resultados|No hay publicaciones|no encontramos)/i.test(s);
  }

  // "+5mil vendidos" → 5000 · "+500 vendidos" → 500 · "+10 mil vendidos" → 10000 · "+1 M vendidos" → 1000000
  function parseVendidos(str) {
    const m = String(str || '')
      .toLowerCase()
      .match(/\+?\s*(\d+(?:[.,]\d+)?)\s*(mil|k|m|mill[oó]n(?:es)?)?\s*vendid/);
    if (!m) return null;
    let n = Number(m[1].replace(',', '.'));
    if (m[2] === 'mil' || m[2] === 'k') n *= 1000;
    else if (m[2]) n *= 1000000; // "m", "millón", "millones"
    return Math.round(n);
  }

  // Todas las menciones de "vendidos" en el texto
  function vendidosEnTexto(text) {
    const out = [];
    const re = /\+?\s*\d+(?:[.,]\d+)?\s*(?:mil|k|m|mill[oó]n(?:es)?)?\s*vendid[oa]s?/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const n = parseVendidos(m[0]);
      if (n != null) out.push(n);
    }
    return out;
  }

  // "1.234 resultados" en la búsqueda de Mercado Libre
  function mlResultCount(text) {
    const m = String(text || '').match(/([\d.]+)\s+resultados/i);
    return m ? U.parseMoney(m[1]) : null;
  }

  function median(nums) {
    const a = (nums || []).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
    if (!a.length) return null;
    const i = Math.floor(a.length / 2);
    return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
  }

  /*
   * Resumen de demanda a partir de las publicaciones extraídas de una búsqueda:
   * listings: [{titulo, precio, opiniones, vendidos, masVendido}]
   */
  function mlSignals(listings, resultados) {
    const L = (listings || []).filter((l) => l && (l.precio || l.titulo));
    const vend = L.map((l) => l.vendidos).filter((n) => n != null);
    const opin = L.map((l) => l.opiniones).filter((n) => n != null);
    const precios = L.map((l) => l.precio).filter((n) => n > 0);
    const masVendidos = L.filter((l) => l.masVendido).length;
    const totalVend = U.sum(vend);
    const totalOpin = U.sum(opin);
    // Demanda 1–5: por vendidos visibles; si no hay, por opiniones (≈ 1 de cada 10 compradores opina)
    const base = vend.length ? totalVend : totalOpin * 10;
    const demanda = base >= 20000 ? 5 : base >= 5000 ? 4 : base >= 1000 ? 3 : base >= 200 ? 2 : 1;
    // Competencia 1–5: cantidad de resultados y de publicaciones con buenas ventas
    const competencia = resultados == null ? (L.length >= 10 ? 4 : 3) : resultados >= 5000 ? 5 : resultados >= 1500 ? 4 : resultados >= 400 ? 3 : resultados >= 100 ? 2 : 1;
    return {
      publicaciones: L.length,
      resultados: resultados == null ? null : resultados,
      vendidosVisibles: vend.length ? totalVend : null,
      opiniones: opin.length ? totalOpin : null,
      masVendidos,
      precioMin: precios.length ? Math.min(...precios) : null,
      precioMediana: median(precios),
      precioMax: precios.length ? Math.max(...precios) : null,
      demanda,
      competencia,
      vende: base >= 1000 ? 'si' : base >= 200 ? 'algo' : 'poco',
    };
  }

  const api = {
    compactText,
    adLibraryReady,
    adLibraryCount,
    adLibraryIds,
    needsLogin,
    adUrl,
    adKey,
    normKey,
    normalizeDomain,
    isStoreDomain,
    productsJsonUrl,
    productUrl,
    extractJson,
    shopifyReady,
    parseShopifyProducts,
    diffCatalog,
    postureProducts,
    daysSince,
    reviewCount,
    mlReady,
    parseVendidos,
    vendidosEnTexto,
    mlResultCount,
    mlSignals,
    median,
  };
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).research = api;
})(typeof window !== 'undefined' ? window : globalThis);
