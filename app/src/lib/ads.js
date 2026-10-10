/* Analizador de creativos: lee reportes de TikTok Ads / Meta Ads y decide qué apagar, mantener o escalar. */
(function (root) {
  'use strict';
  const U = typeof module === 'object' && module.exports ? require('./util.js') : root.VC.util;

  function norm(h) {
    return U.stripAccents(h)
      .toLowerCase()
      .replace(/\((ars|usd|clp|mxn|cop|eur|\$)\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Por cada campo, patrones en orden de preferencia (se toma la primera columna que coincida)
  const FIELDS = {
    nombre: [/^(ad name|nombre del anuncio|anuncio|nombre de anuncio)$/],
    campana: [/^(campaign name|nombre de la campana|campana)$/],
    conjunto: [/^(ad set name|ad group name|nombre del conjunto de anuncios|nombre del grupo de anuncios|conjunto de anuncios|grupo de anuncios)$/],
    gasto: [/^(amount spent|importe gastado|cost|coste|costo|gasto|spend|total cost|coste total|costo total)$/],
    impresiones: [/^(impressions|impresiones)$/],
    clics: [
      /^(link clicks|clics en el enlace|clicks \(destination\)|clics \(destino\)|clics en enlace)$/,
      /^(clicks \(all\)|clics \(todos\)|clicks|clics)$/,
    ],
    compras: [
      /^(purchases|compras|complete payment|pago completado|pagos completados|purchase|compra)$/,
      /^(website purchases|compras en el sitio web|conversions|conversiones)$/,
      /^(results|resultados)$/,
    ],
    valor: [
      /^(purchases conversion value|valor de conversion de compras|total complete payment value|valor total de pago completado|valor de pago completado|purchase value|valor de compra)$/,
    ],
    hook: [
      /^(2-second video views|reproducciones de video de 2 segundos|reproducciones de 2 segundos|visualizaciones de video de 2 segundos)$/,
      /^(3-second video plays|reproducciones de video de 3 segundos|reproducciones de 3 segundos)$/,
      /^(6-second video views|reproducciones de video de 6 segundos)$/,
    ],
    completas: [
      /^(video views at 100%|video plays at 100%|reproducciones de video hasta el 100%|reproducciones de video al 100 ?%|visualizaciones de video al 100 ?%)$/,
      /^(thruplays|thruplay)$/,
    ],
  };

  function detectPlatform(headers) {
    const hs = headers.map(norm);
    if (hs.some((h) => /complete payment|pago completado|clicks \(destination\)|clics \(destino\)|2-second|2 segundos|ad group/.test(h))) return 'tiktok';
    if (hs.some((h) => /amount spent|importe gastado|thruplay|link clicks|clics en el enlace|3-second|3 segundos|conjunto de anuncios|ad set/.test(h))) return 'meta';
    return 'desconocida';
  }

  function detectMapping(headers) {
    const hs = headers.map((h) => ({ raw: h, n: norm(h) }));
    const map = {};
    for (const [field, patterns] of Object.entries(FIELDS)) {
      for (const p of patterns) {
        const hit = hs.find((h) => p.test(h.n));
        if (hit) {
          map[field] = hit.raw;
          break;
        }
      }
    }
    return map;
  }

  const ANGLES = {
    dolor: { label: 'Dolor', words: ['dolor', 'duele', 'contractura', 'cervical', 'lumbar', 'espalda', 'cuello', 'pain', 'molestia'] },
    medico: { label: 'Médico', words: ['medico', 'doctor', 'dr', 'dra', 'kinesi', 'kine', 'fisio', 'traumato', 'especialista', 'profesional', 'experto'] },
    estetica: { label: 'Estética', words: ['estetica', 'look', 'joroba', 'figura', 'elegan', 'autoestima', 'aesthetic', 'belleza', 'verse', 'ropa', 'antes despues'] },
    gym: { label: 'Gym', words: ['gym', 'gimnasio', 'entren', 'fit', 'deporte', 'crossfit', 'pesas', 'workout', 'training'] },
  };

  function detectAngle(name) {
    const s = ' ' + U.stripAccents(name).toLowerCase().replace(/[_\-|/[\]().,]+/g, ' ') + ' ';
    let best = null;
    for (const [key, a] of Object.entries(ANGLES)) {
      for (const w of a.words) {
        const re = w.length <= 3 ? new RegExp('\\s' + w + '\\s') : new RegExp(w);
        const m = s.match(re);
        if (m && (best === null || m.index < best.idx)) best = { key, idx: m.index };
      }
    }
    return best ? best.key : 'otro';
  }

  function isTotalRow(name) {
    return !name || /^(total|totales|resultados generales|results from|resultados de)\b/i.test(U.stripAccents(name).trim());
  }

  /* Agrupa filas por anuncio (los reportes por día traen varias filas por anuncio). */
  function aggregate(rows, map) {
    const by = new Map();
    for (const r of rows) {
      const name = (r[map.nombre] || '').trim();
      if (isTotalRow(name)) continue;
      if (!by.has(name)) {
        by.set(name, { nombre: name, campana: r[map.campana] || '', conjunto: r[map.conjunto] || '', gasto: 0, impresiones: 0, clics: 0, compras: 0, valor: 0, hook: 0, completas: 0, filas: 0 });
      }
      const a = by.get(name);
      a.filas++;
      for (const f of ['gasto', 'impresiones', 'clics', 'compras', 'valor', 'hook', 'completas']) {
        if (map[f]) a[f] += U.parseNum(r[map[f]]) || 0;
      }
    }
    return [...by.values()].filter((a) => a.gasto > 0 || a.impresiones > 0).map(derive);
  }

  function derive(a) {
    a.ctr = a.impresiones ? a.clics / a.impresiones : null;
    a.cpc = a.clics ? a.gasto / a.clics : null;
    a.cpm = a.impresiones ? (a.gasto / a.impresiones) * 1000 : null;
    a.cpa = a.compras ? a.gasto / a.compras : null;
    a.roas = a.gasto && a.valor ? a.valor / a.gasto : null;
    a.hookRate = a.impresiones && a.hook ? a.hook / a.impresiones : null;
    a.holdRate = a.hook && a.completas ? a.completas / a.hook : null;
    a.conv = a.clics ? a.compras / a.clics : null;
    return a;
  }

  /*
   * Decisión por anuncio. cpaMax = lo máximo que podés pagar por pedido sin perder (de Ganancia real).
   * Reglas pensadas para contra entrega: la plataforma cuenta el pedido, no la entrega.
   */
  function decide(a, cpaMax) {
    const M = U.money;
    if (!(cpaMax > 0)) return { accion: 'sin_cpa', motivo: 'Cargá tus costos o un CPA máximo para poder decidir.' };
    const veces = a.gasto / cpaMax;
    if (a.compras === 0) {
      if (a.gasto >= 1.5 * cpaMax) return { accion: 'apagar', motivo: 'Gastó ' + M(a.gasto) + ' sin ventas (' + veces.toFixed(1).replace('.', ',') + '× tu CPA máximo).' };
      if (a.impresiones >= 4000 && a.ctr != null && a.ctr < 0.005) return { accion: 'apagar', motivo: 'CTR de ' + U.pct(a.ctr, 2) + ' con ' + U.int(a.impresiones) + ' impresiones: el anuncio no frena el scroll.' };
      if (a.impresiones >= 4000 && a.hookRate != null && a.hookRate < 0.15) return { accion: 'apagar', motivo: 'Solo ' + U.pct(a.hookRate) + ' mira más de 2 segundos: cambiá el gancho.' };
      if (a.gasto >= 0.75 * cpaMax && a.ctr != null && a.ctr >= 0.012) return { accion: 'esperar', motivo: 'Sin ventas todavía, pero buen CTR (' + U.pct(a.ctr, 2) + '). Dale hasta ' + M(1.5 * cpaMax) + '.' };
      return { accion: 'esperar', motivo: 'Faltan datos: gastó ' + M(a.gasto) + ' de los ' + M(1.5 * cpaMax) + ' que necesita para decidir.' };
    }
    const ratio = a.cpa / cpaMax;
    if (a.compras >= 3 && ratio <= 0.7) return { accion: 'escalar', motivo: a.compras + ' ventas a ' + M(a.cpa) + ' (' + U.pct(1 - ratio) + ' debajo de tu máximo). Subí presupuesto 20–30% cada 48 h.' };
    if (a.compras >= 2 && ratio <= 0.5) return { accion: 'escalar', motivo: a.compras + ' ventas a ' + M(a.cpa) + ', la mitad de tu máximo. Escalá de a poco y mirá que se sostenga.' };
    if (ratio <= 1) return { accion: 'mantener', motivo: 'Rentable (' + M(a.cpa) + ' por venta) pero con poco volumen o poco margen. Dejalo correr.' };
    if (ratio <= 1.3 && a.gasto < 3 * cpaMax) return { accion: 'revisar', motivo: 'CPA de ' + M(a.cpa) + ', ' + U.pct(ratio - 1) + ' arriba de tu máximo. Probá otro gancho antes de apagarlo.' };
    return { accion: 'apagar', motivo: 'CPA de ' + M(a.cpa) + ': perdés plata en cada venta (máximo ' + M(cpaMax) + ').' };
  }

  const ACCIONES = {
    escalar: { label: 'Escalar', tone: 'good', orden: 0 },
    mantener: { label: 'Mantener', tone: 'info', orden: 1 },
    revisar: { label: 'Revisar', tone: 'warn', orden: 2 },
    esperar: { label: 'Esperar datos', tone: 'neutral', orden: 3 },
    apagar: { label: 'Apagar', tone: 'bad', orden: 4 },
    sin_cpa: { label: 'Sin CPA', tone: 'neutral', orden: 5 },
  };

  function byAngle(ads, angleOf) {
    const by = new Map();
    for (const a of ads) {
      const k = angleOf(a);
      if (!by.has(k)) by.set(k, { angulo: k, anuncios: 0, gasto: 0, impresiones: 0, clics: 0, compras: 0, valor: 0, hook: 0, completas: 0 });
      const g = by.get(k);
      g.anuncios++;
      for (const f of ['gasto', 'impresiones', 'clics', 'compras', 'valor', 'hook', 'completas']) g[f] += a[f];
    }
    return [...by.values()].map(derive).sort((a, b) => b.gasto - a.gasto);
  }

  /* Ángulo ganador: el de menor CPA con al menos 2 ventas; si nadie vendió, el de mejor CTR con volumen. */
  function winner(angles) {
    const conVentas = angles.filter((g) => g.compras >= 2 && g.angulo !== 'otro');
    if (conVentas.length) {
      const best = conVentas.slice().sort((a, b) => a.cpa - b.cpa)[0];
      const totalG = U.sum(angles, (g) => g.gasto);
      const totalC = U.sum(angles, (g) => g.compras);
      const prom = totalC ? totalG / totalC : null;
      return { angulo: best.angulo, criterio: 'cpa', cpa: best.cpa, vsPromedio: prom ? best.cpa / prom - 1 : null };
    }
    const conVolumen = angles.filter((g) => g.impresiones >= 3000 && g.ctr != null && g.angulo !== 'otro');
    if (conVolumen.length) {
      const best = conVolumen.slice().sort((a, b) => b.ctr - a.ctr)[0];
      return { angulo: best.angulo, criterio: 'ctr', ctr: best.ctr };
    }
    return null;
  }

  const api = { FIELDS, ANGLES, ACCIONES, norm, detectPlatform, detectMapping, detectAngle, aggregate, derive, decide, byAngle, winner, isTotalRow };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.VC = root.VC || {}).ads = api;
})(typeof window !== 'undefined' ? window : globalThis);
