/* Buscador del próximo producto: compara candidatos por margen, demanda, competencia y afinidad con el cliente del corrector. */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const U = isNode ? require('./util.js') : root.VC.util;
  const P = isNode ? require('./profit.js') : root.VC.profit;

  /*
   * Candidatos de partida. Precios de referencia: publicaciones de Mercado Libre Argentina relevadas por
   * MejoresCompras en octubre de 2026 (cambian seguido). Los puntajes 1–5 son estimaciones para arrancar: ajustalos.
   * demanda/afinidad/video: más es mejor · competencia/riesgo: más es peor.
   */
  const REF_FECHA = 'oct 2026';
  const CANDIDATOS = [
    { id: 'almohada', nombre: 'Almohada cervical viscoelástica', busqueda: 'almohada cervical viscoelastica', refMin: 16500, refMax: 78500, demanda: 4, competencia: 4, afinidad: 5, video: 4, riesgo: 2, envioExtra: 3000, nota: 'Mismo dolor (cuello) que el corrector. Voluminosa: el envío sale más caro.' },
    { id: 'masajeador', nombre: 'Masajeador cervical eléctrico (shiatsu)', busqueda: 'masajeador cervical electrico shiatsu', refMin: 34000, refMax: 70000, demanda: 4, competencia: 3, afinidad: 5, video: 5, riesgo: 3, envioExtra: 0, nota: 'Muy demostrable en video y de ticket alto. Electrónico: más fallas y reclamos.' },
    { id: 'pistola', nombre: 'Pistola de masaje muscular', busqueda: 'pistola masajeadora muscular', refMin: 28000, refMax: 76000, demanda: 4, competencia: 4, afinidad: 3, video: 5, riesgo: 3, envioExtra: 0, nota: 'Encaja con el ángulo gym. Muchos vendedores en Mercado Libre.' },
    { id: 'lumbar', nombre: 'Almohadón lumbar para silla', busqueda: 'almohadon lumbar silla ergonomico', refMin: null, refMax: null, demanda: 3, competencia: 3, afinidad: 5, video: 3, riesgo: 2, envioExtra: 2000, nota: 'Para el mismo cliente de home office. Sin precios de referencia relevados.' },
    { id: 'plantillas', nombre: 'Plantillas ortopédicas', busqueda: 'plantillas ortopedicas', refMin: 16000, refMax: 30000, demanda: 3, competencia: 3, afinidad: 3, video: 3, riesgo: 4, envioExtra: 0, nota: 'Livianas y baratas de enviar, pero con talles: más cambios.' },
    { id: 'soporte', nombre: 'Soporte de notebook', busqueda: 'soporte notebook aluminio', refMin: 8000, refMax: 51000, demanda: 3, competencia: 5, afinidad: 4, video: 3, riesgo: 1, envioExtra: 0, nota: 'Postura frente a la compu, pero hay muchísima oferta barata.' },
    { id: 'faja', nombre: 'Faja lumbar', busqueda: 'faja lumbar', refMin: null, refMax: null, demanda: 3, competencia: 4, afinidad: 4, video: 2, riesgo: 3, envioExtra: 0, nota: 'Mismo cliente con dolor lumbar. Talles y poca diferencia visual.' },
  ];

  const PESOS = { margen: 30, demanda: 20, competencia: 15, afinidad: 15, video: 10, riesgo: 10 };

  function mlUrl(q) {
    return 'https://listado.mercadolibre.com.ar/' + encodeURIComponent(U.stripAccents(q).toLowerCase().trim().replace(/\s+/g, '-'));
  }
  function trendsUrl(q) {
    return 'https://trends.google.com/trends/explore?geo=AR&q=' + encodeURIComponent(q);
  }

  /*
   * Economía de un candidato vendido por anuncios (con CPA) y a clientes actuales por WhatsApp (sin anuncios).
   */
  function economics(p, cfg, rates, cpa) {
    const c = P.normalizeCfg(cfg);
    const r = P.effectiveRates(c, rates);
    const precio = Number(p.precio) || 0;
    const costo = Number(p.costo) || 0;
    if (!precio || !costo) return null;
    const envio = c.costoEnvio + (Number(p.envioExtra) || 0);
    const margenEntrega = precio * (1 - c.comisionCobro / 100) - costo - envio - c.otrosPorPedido;
    const perdida = c.costoDevolucion + (Number(p.envioExtra) || 0) + c.otrosPorPedido;
    const esperado = r.confirmacion * (r.entrega * margenEntrega - (1 - r.entrega) * perdida);
    const conAnuncios = esperado - (Number(cpa) || 0);
    // A un cliente que ya compró se le escribe por WhatsApp: no hay CPA y casi siempre confirma
    const aCliente = r.entrega * margenEntrega - (1 - r.entrega) * perdida;
    return { precio, costo, margenEntrega, esperado, conAnuncios, aCliente, markup: precio / costo };
  }

  function margenScore(conAnuncios) {
    if (conAnuncios == null) return null;
    return U.clamp(1 + (conAnuncios / 20000) * 4, 1, 5); // $0 → 1 · $20.000 o más por pedido → 5
  }

  function score(p, cfg, rates, cpa) {
    const eco = economics(p, cfg, rates, cpa);
    const parts = {
      margen: eco ? margenScore(eco.conAnuncios) : null,
      demanda: Number(p.demanda) || 3,
      competencia: 6 - (Number(p.competencia) || 3),
      afinidad: Number(p.afinidad) || 3,
      video: Number(p.video) || 3,
      riesgo: 6 - (Number(p.riesgo) || 3),
    };
    let total = 0;
    let peso = 0;
    for (const [k, w] of Object.entries(PESOS)) {
      if (parts[k] == null) continue;
      total += w * ((parts[k] - 1) / 4);
      peso += w;
    }
    return { eco, parts, puntaje: peso ? Math.round((total / peso) * 100) : 0, completo: parts.margen != null };
  }

  function claudePrompt(list, d) {
    const rows = list.map((p) => '- ' + p.nombre + (p.refMin ? ' (Mercado Libre: ' + U.money(p.refMin) + ' a ' + U.money(p.refMax) + ')' : '')).join('\n');
    return [
      'Tengo una tienda online en Argentina (ViaCare) que vende un corrector de postura a ' + U.money(d.precio1 || 68990) + ' con pago contra entrega, por anuncios de TikTok y Meta. Mis clientes: gente de 25 a 60 años con dolor de espalda o cuello por trabajar sentada o usar el celular.',
      'Quiero sumar un segundo producto para venderle al mismo cliente y para anunciar.',
      'Candidatos:',
      rows,
      '',
      'Para cada uno estimá del 1 al 5: demanda en Argentina, competencia (5 = mucha), afinidad con mi cliente del corrector, qué tan bien se muestra en un video corto, y riesgo operativo (5 = muchas devoluciones, talles, fallas o envío caro).',
      'Sugerí un precio de venta para contra entrega en Argentina (en pesos), el mejor ángulo de anuncio y un combo con el corrector.',
      'No tenés acceso a internet: basate en lo que sabés y aclaralo en "dudas" cuando no estés seguro.',
      '',
      'Respondé SOLO con JSON: {"productos":[{"nombre":"(igual que en la lista)","demanda":3,"competencia":3,"afinidad":3,"video":3,"riesgo":3,"precio_sugerido":0,"angulo":"…","combo":"…","dudas":"…"}],"recomendacion":"2-3 oraciones"}',
    ].join('\n');
  }

  const api = { REF_FECHA, CANDIDATOS, PESOS, mlUrl, trendsUrl, economics, score, margenScore, claudePrompt };
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).products = api;
})(typeof window !== 'undefined' ? window : globalThis);
