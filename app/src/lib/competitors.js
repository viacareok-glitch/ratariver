/* Espía de anuncios: links a la Biblioteca de anuncios de Meta, fechas de circulación y resumen de ganchos/ángulos/ofertas. */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const U = isNode ? require('./util.js') : root.VC.util;

  const BUSQUEDAS = ['corrector postural', 'corrector de postura', 'corrector de espalda', 'faja postural', 'postura espalda', 'dolor de espalda'];
  const GANADOR_DIAS = 21; // un anuncio que sigue activo después de 3 semanas probablemente vende

  const ANGULOS = {
    dolor: 'Dolor',
    medico: 'Médico / experto',
    estetica: 'Estética',
    gym: 'Gym',
    oficina: 'Home office',
    regalo: 'Regalo',
    otro: 'Otro',
  };

  function adLibraryUrl(q, country) {
    return (
      'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=' +
      encodeURIComponent(country || 'AR') +
      '&q=' +
      encodeURIComponent(q) +
      '&search_type=keyword_unordered&media_type=all'
    );
  }

  function tiktokTopAdsUrl() {
    return 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/es';
  }

  const MESES = { ene: 0, jan: 0, feb: 1, mar: 2, abr: 3, apr: 3, may: 4, jun: 5, jul: 6, ago: 7, aug: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11, dec: 11 };

  /* "12 ago 2026", "12 de agosto de 2026", "Aug 12, 2026", "2026-08-12", "12/08/2026" → AAAA-MM-DD */
  function parseDate(str) {
    if (!str) return null;
    const s = U.stripAccents(String(str)).toLowerCase().trim();
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    m = s.match(/(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\.?\s+(?:de\s+)?(\d{4})/);
    if (m && m[2] in MESES) return m[3] + '-' + String(MESES[m[2]] + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0');
    m = s.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && m[1] in MESES) return m[3] + '-' + String(MESES[m[1]] + 1).padStart(2, '0') + '-' + m[2].padStart(2, '0');
    return null;
  }

  function daysActive(desde, today) {
    const d = parseDate(desde);
    if (!d) return null;
    return Math.max(0, U.daysBetween(d, today || U.todayKeyAR()));
  }

  function summarize(ads, today) {
    const withDays = ads.map((a) => Object.assign({}, a, { dias: a.dias != null ? a.dias : daysActive(a.desde, today) }));
    const ganadores = withDays.filter((a) => a.dias != null && a.dias >= GANADOR_DIAS);
    const count = (k) => {
      const m = new Map();
      for (const a of withDays) {
        const v = (a[k] || '').trim();
        if (v) m.set(v, (m.get(v) || 0) + 1);
      }
      return [...m.entries()].sort((x, y) => y[1] - x[1]);
    };
    return {
      total: withDays.length,
      ganadores: ganadores.length,
      anunciantes: new Set(withDays.map((a) => (a.anunciante || '').toLowerCase()).filter(Boolean)).size,
      angulos: count('angulo'),
      ofertas: count('oferta'),
      ads: withDays.sort((a, b) => (b.dias == null ? -1 : b.dias) - (a.dias == null ? -1 : a.dias)),
    };
  }

  function extractPrompt(text, nImages, today) {
    return [
      'Te paso lo que copié o capturé de la Biblioteca de anuncios de Meta buscando correctores de postura en Argentina.',
      nImages ? 'Hay ' + nImages + ' captura(s) de pantalla adjuntas.' : '',
      text ? 'TEXTO COPIADO:\n' + text.slice(0, 60000) : '',
      '',
      'Hoy es ' + today + '. Extraé cada anuncio distinto que veas. Para cada uno:',
      '- anunciante: nombre de la página',
      '- id: el número de "Identificador de la biblioteca" (o "Library ID"); vacío si no está',
      '- dominio: el sitio al que lleva el anuncio si aparece (ej. "POSTURAYA.COM.AR"); vacío si no',
      '- desde: fecha en que empezó a circular, en formato AAAA-MM-DD (si dice "Comenzó a circular el…" o "Started running on…"); vacío si no está',
      '- gancho: la primera frase del texto o del video, tal cual (máximo 20 palabras)',
      '- angulo: uno de dolor | medico | estetica | gym | oficina | regalo | otro',
      '- oferta: la promo en pocas palabras (ej.: "2x1", "envío gratis + pago al recibir", "40% off"); vacío si no hay',
      '- precio: si aparece, el número en pesos sin símbolos; vacío si no',
      '- formato: video | imagen | carrusel',
      '- cta: el botón (Comprar, Más información, Enviar mensaje…)',
      '- nota: qué hace bien o qué se puede aprender, en una oración',
      'No inventes anuncios ni datos que no estén en el material. Si un anuncio aparece repetido (varias versiones), contalo una vez y decilo en la nota.',
      '',
      'Respondé SOLO con JSON: {"anuncios":[{"anunciante":"","id":"","dominio":"","desde":"","gancho":"","angulo":"","oferta":"","precio":"","formato":"","cta":"","nota":""}]}',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  function insightPrompt(ads, today, d) {
    d = d || {};
    const lines = ads
      .slice(0, 120)
      .map((a) => [a.anunciante, a.dias != null ? a.dias + ' días' : 's/f', a.angulo, a.oferta, a.precio, a.formato, '"' + (a.gancho || '') + '"'].join(' | '))
      .join('\n');
    return [
      'Sos estratega de creativos para e-commerce en Argentina. Mi tienda, ViaCare, vende un corrector de postura con pago contra entrega por TikTok y Meta.',
      'Estos son anuncios activos de la competencia (anunciante | días activo | ángulo | oferta | precio | formato | gancho). Los que llevan ' + GANADOR_DIAS + ' días o más probablemente funcionan. Hoy es ' + today + '.',
      lines,
      '',
      'Respondé en español rioplatense, texto plano con guiones, breve:',
      '1. Qué está funcionando: ganchos, ángulos y ofertas que se repiten en los anuncios con más días.',
      '2. Huecos: ángulos u ofertas que nadie está usando y podrían diferenciarme.',
      '3. Precios: cómo me ubico' + (d.precio1 ? ' (mi precio: 1 unidad ' + U.money(d.precio1) + (d.precio2 ? ', 2 unidades ' + U.money(d.precio2) : '') + ')' : '') + '.',
      '4. Cinco ideas de creativos para ViaCare inspiradas en lo que funciona, sin copiar: gancho (primera frase), ángulo y qué se ve en los primeros 3 segundos.',
      'Nada de claims médicos ni promesas de cura.',
    ].join('\n');
  }

  function sanitizeAds(data) {
    const list = Array.isArray(data) ? data : data && Array.isArray(data.anuncios) ? data.anuncios : [];
    return list
      .filter((a) => a && (a.gancho || a.anunciante))
      .map((a) => ({
        anunciante: String(a.anunciante || '').trim(),
        idBiblioteca: String(a.id || a.idBiblioteca || '').replace(/\D/g, ''),
        dominio: String(a.dominio || '')
          .trim()
          .toLowerCase()
          .replace(/^[a-z]+:\/\//, '')
          .replace(/^www\./, '')
          .split(/[/?#\s]/)[0],
        desde: parseDate(a.desde) || '',
        gancho: String(a.gancho || '').trim(),
        angulo: ANGULOS[a.angulo] ? a.angulo : 'otro',
        oferta: String(a.oferta || '').trim(),
        precio: U.parseMoney(a.precio) || null,
        formato: String(a.formato || '').trim().toLowerCase(),
        cta: String(a.cta || '').trim(),
        nota: String(a.nota || '').trim(),
      }));
  }

  const api = { BUSQUEDAS, GANADOR_DIAS, ANGULOS, adLibraryUrl, tiktokTopAdsUrl, parseDate, daysActive, summarize, extractPrompt, insightPrompt, sanitizeAds };
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).competitors = api;
})(typeof window !== 'undefined' ? window : globalThis);
