/* Ganancia real: ventas contra entrega menos producto, envíos, devoluciones, comisiones, fijos y anuncios. */
(function (root) {
  'use strict';
  const U = typeof module === 'object' && module.exports ? require('./util.js') : root.VC.util;

  const DEFAULT_CFG = {
    costoUnidad: 0,
    costoEnvio: 0,
    costoDevolucion: 0,
    comisionCobro: 0,
    otrosPorPedido: 0,
    fijosMensuales: 0,
    tasaConfirmacion: null,
    tasaEntrega: null,
    cpaMaxManual: null,
  };

  function num(v, d) {
    const n = typeof v === 'number' ? v : U.parseNum(v);
    return Number.isFinite(n) ? n : d;
  }

  function normalizeCfg(cfg) {
    const c = Object.assign({}, DEFAULT_CFG, cfg || {});
    for (const k of Object.keys(DEFAULT_CFG)) {
      c[k] = DEFAULT_CFG[k] === null ? (c[k] === '' || c[k] == null ? null : num(c[k], null)) : num(c[k], 0);
    }
    return c;
  }

  /* Tasas que se usan para proyectar: las que cargó el usuario o, si no, las históricas. */
  function effectiveRates(cfg, rates) {
    const c = normalizeCfg(cfg);
    const pc = c.tasaConfirmacion != null ? c.tasaConfirmacion / 100 : rates && rates.confirmacion != null ? rates.confirmacion : 0.5;
    const pe = c.tasaEntrega != null ? c.tasaEntrega / 100 : rates && rates.entrega != null ? rates.entrega : 0.85;
    return {
      confirmacion: U.clamp(pc, 0, 1),
      entrega: U.clamp(pe, 0, 1),
      origenConfirmacion: c.tasaConfirmacion != null ? 'manual' : rates && rates.confirmacion != null ? 'historico' : 'supuesto',
      origenEntrega: c.tasaEntrega != null ? 'manual' : rates && rates.entrega != null ? 'historico' : 'supuesto',
    };
  }

  function costsReady(cfg) {
    const c = normalizeCfg(cfg);
    return c.costoUnidad > 0;
  }

  /*
   * Peso de cada pedido: probabilidad de terminar entregado (wd) o devuelto (wr).
   * Los entregados/devueltos ya son hechos (peso 1); los abiertos se proyectan con las tasas.
   */
  function weights(o, r, confirmState) {
    switch (o.estado) {
      case 'entregado':
      case 'pagado':
        return { wd: 1, wr: 0, real: true };
      case 'devuelto':
        return { wd: 0, wr: 1, real: true };
      case 'anulado':
        return { wd: 0, wr: 0, real: true };
      case 'en_camino':
        return { wd: r.entrega, wr: 1 - r.entrega, real: false };
      default: {
        let pc = r.confirmacion;
        if (confirmState === 'confirmado') pc = 1;
        else if (confirmState === 'cancelado') pc = 0;
        return { wd: pc * r.entrega, wr: pc * (1 - r.entrega), real: false };
      }
    }
  }

  function emptyBucket() {
    return {
      pedidos: 0,
      anulados: 0,
      entregados: 0,
      devueltos: 0,
      abiertos: 0,
      unidades: 0,
      entregasEsperadas: 0,
      ventas: 0,
      comisiones: 0,
      producto: 0,
      envios: 0,
      otros: 0,
      devoluciones: 0,
      fijos: 0,
      ads: 0,
      ganancia: 0,
      asegurado: { ventas: 0, costos: 0 },
    };
  }

  function addOrder(b, o, w, c) {
    b.pedidos++;
    b.unidades += o.units;
    if (o.estado === 'anulado') b.anulados++;
    else if (o.estado === 'entregado' || o.estado === 'pagado') b.entregados++;
    else if (o.estado === 'devuelto') b.devueltos++;
    else b.abiertos++;
    const ventas = w.wd * o.total;
    const comisiones = ventas * (c.comisionCobro / 100);
    const producto = w.wd * o.units * c.costoUnidad;
    const envios = w.wd * c.costoEnvio;
    const otros = (w.wd + w.wr) * c.otrosPorPedido;
    const devol = w.wr * c.costoDevolucion;
    b.entregasEsperadas += w.wd;
    b.ventas += ventas;
    b.comisiones += comisiones;
    b.producto += producto;
    b.envios += envios;
    b.otros += otros;
    b.devoluciones += devol;
    if (w.real) {
      b.asegurado.ventas += ventas;
      b.asegurado.costos += comisiones + producto + envios + otros + devol;
    }
  }

  function close(b) {
    b.ganancia = b.ventas - b.comisiones - b.producto - b.envios - b.otros - b.devoluciones - b.fijos - b.ads;
    b.contribucion = b.ganancia + b.ads; // lo que deja antes de pagar anuncios
    b.roas = b.ads > 0 ? b.ventas / b.ads : null;
    b.cpaPedido = b.ads > 0 && b.pedidos ? b.ads / b.pedidos : null;
    b.cpaEntrega = b.ads > 0 && b.entregasEsperadas > 0 ? b.ads / b.entregasEsperadas : null;
    b.asegurado.ganancia = b.asegurado.ventas - b.asegurado.costos - b.fijos - b.ads;
    b.margen = b.ventas > 0 ? b.ganancia / b.ventas : null;
    return b;
  }

  function spendOf(g) {
    if (!g) return { tiktok: 0, meta: 0, otros: 0, total: 0 };
    const t = num(g.tiktok, 0);
    const m = num(g.meta, 0);
    const o = num(g.otros, 0);
    return { tiktok: t, meta: m, otros: o, total: t + m + o };
  }

  /*
   * orders: pedidos normalizados · gastos: {AAAA-MM-DD: {tiktok, meta, otros}} · confirm: Map(key → estado)
   */
  function computeProfit({ orders, gastos, cfg, rates, confirm, from, to }) {
    const c = normalizeCfg(cfg);
    const r = effectiveRates(c, rates);
    const days = U.dayRange(from, to);
    const fijosDia = c.fijosMensuales / 30;
    const total = emptyBucket();
    const byDay = new Map(days.map((d) => [d, emptyBucket()]));
    const bySource = new Map();
    const inRange = orders.filter((o) => o.day >= from && o.day <= to);
    for (const o of inRange) {
      const w = weights(o, r, confirm && confirm.get(o.key));
      addOrder(total, o, w, c);
      addOrder(byDay.get(o.day), o, w, c);
      if (!bySource.has(o.source)) bySource.set(o.source, emptyBucket());
      addOrder(bySource.get(o.source), o, w, c);
    }
    const spendTotals = { tiktok: 0, meta: 0, otros: 0, total: 0 };
    for (const d of days) {
      const s = spendOf(gastos && gastos[d]);
      const b = byDay.get(d);
      b.ads = s.total;
      b.fijos = fijosDia;
      b.spend = s;
      for (const k of Object.keys(spendTotals)) spendTotals[k] += s[k];
    }
    total.ads = spendTotals.total;
    total.fijos = fijosDia * days.length;
    total.spend = spendTotals;
    // Gasto por plataforma contra los pedidos con esa UTM
    for (const [src, b] of bySource) {
      b.ads = src === 'tiktok' ? spendTotals.tiktok : src === 'meta' ? spendTotals.meta : 0;
    }
    for (const src of ['tiktok', 'meta']) {
      if (!bySource.has(src) && spendTotals[src] > 0) {
        const b = emptyBucket();
        b.ads = spendTotals[src];
        bySource.set(src, b);
      }
    }
    close(total);
    for (const b of byDay.values()) close(b);
    for (const b of bySource.values()) close(b);
    return {
      cfg: c,
      rates: r,
      total,
      days: days.map((d) => Object.assign({ day: d }, byDay.get(d))),
      sources: [...bySource.entries()].map(([k, b]) => Object.assign({ source: k }, b)).sort((a, b) => b.pedidos - a.pedidos),
      unassignedSpend: spendTotals.otros,
    };
  }

  /*
   * Cuánto podés pagar por cada pedido que entra (lo que la plataforma cuenta como "compra") sin perder plata.
   */
  function breakEven(cfg, rates) {
    const c = normalizeCfg(cfg);
    const r = effectiveRates(c, rates);
    const ticket = (rates && rates.ticketPromedio) || null;
    const unidades = (rates && rates.unidadesPromedio) || 1;
    if (!ticket) return null;
    const margenEntrega = ticket * (1 - c.comisionCobro / 100) - unidades * c.costoUnidad - c.costoEnvio - c.otrosPorPedido;
    const perdidaDevolucion = c.costoDevolucion + c.otrosPorPedido;
    const porPedido = r.confirmacion * (r.entrega * margenEntrega - (1 - r.entrega) * perdidaDevolucion);
    return {
      ticket,
      unidades,
      margenEntrega,
      perdidaDevolucion,
      cpaEquilibrio: porPedido,
      cpaObjetivo: porPedido * 0.7,
      cpaEntregaEquilibrio: margenEntrega - ((1 - r.entrega) / Math.max(r.entrega, 0.01)) * perdidaDevolucion,
      rates: r,
    };
  }

  const api = { DEFAULT_CFG, normalizeCfg, effectiveRates, costsReady, weights, computeProfit, breakEven, spendOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.VC = root.VC || {}).profit = api;
})(typeof window !== 'undefined' ? window : globalThis);
