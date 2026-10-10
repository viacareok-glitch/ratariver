/* Calculadora de ofertas: cuánto deja cada promo (1 unidad, 2x1, 3x2, regalo) contra entrega y con publicidad. */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const P = isNode ? require('./profit.js') : root.VC.profit;

  const DEFAULT_OFERTAS = [
    { id: 'uno', nombre: '1 unidad', unidades: 1, precio: 68990, extra: 0, lift: 0 },
    { id: 'dos', nombre: '2 unidades (oferta actual)', unidades: 2, precio: 72990, extra: 0, lift: 0 },
    { id: '2x1', nombre: '2x1', unidades: 2, precio: 68990, extra: 0, lift: 0 },
    { id: '3x2', nombre: '3x2', unidades: 3, precio: 137980, extra: 0, lift: 0 },
    { id: 'regalo', nombre: '1 unidad + regalo', unidades: 1, precio: 68990, extra: 3000, lift: 0 },
  ];

  /*
   * Economía de una oferta por pedido que entra.
   * margenEntrega: lo que deja un pedido entregado antes de anuncios.
   * esperado: lo que deja en promedio cada pedido que entra (con anulados y devoluciones), antes de anuncios.
   * ganancia: esperado − costo de publicidad por pedido.
   */
  function evaluate(oferta, cfg, rates, cpaBase, envioExtraUnidad) {
    const c = P.normalizeCfg(cfg);
    const r = P.effectiveRates(c, rates);
    const u = Math.max(1, Number(oferta.unidades) || 1);
    const precio = Number(oferta.precio) || 0;
    const extra = Number(oferta.extra) || 0;
    const lift = Number(oferta.lift) || 0;
    const envExtra = (Number(envioExtraUnidad) || 0) * (u - 1);
    const margenEntrega = precio * (1 - c.comisionCobro / 100) - u * c.costoUnidad - extra - c.costoEnvio - envExtra - c.otrosPorPedido;
    const perdidaDevolucion = c.costoDevolucion + c.otrosPorPedido + envExtra;
    const esperado = r.confirmacion * (r.entrega * margenEntrega - (1 - r.entrega) * perdidaDevolucion);
    const cpa = (Number(cpaBase) || 0) / Math.max(0.05, 1 + lift / 100);
    const ganancia = esperado - cpa;
    return {
      oferta,
      unidades: u,
      precio,
      precioUnidad: precio / u,
      margenEntrega,
      perdidaDevolucion,
      esperado,
      cpa,
      ganancia,
      gananciaPorUnidad: ganancia / u,
      cpaEquilibrio: esperado,
      rates: r,
    };
  }

  /*
   * Cuánta conversión extra necesita una oferta para ganar lo mismo que la base.
   * Devuelve la variación relativa (0,25 = necesita 25% más pedidos por peso invertido) o null si no alcanza nunca.
   */
  function liftNeeded(ev, base) {
    const cpaNecesario = ev.esperado - base.ganancia;
    if (cpaNecesario <= 0) return null;
    if (!(base.cpa > 0)) return ev.ganancia >= base.ganancia ? -1 : null;
    return base.cpa / cpaNecesario - 1;
  }

  function compare(ofertas, cfg, rates, cpaBase, envioExtraUnidad) {
    const evs = ofertas.map((o) => evaluate(o, cfg, rates, cpaBase, envioExtraUnidad));
    const base = evs[0];
    const best = evs.reduce((a, b) => (b.ganancia > a.ganancia ? b : a), evs[0]);
    for (const ev of evs) {
      ev.vsBase = ev.ganancia - base.ganancia;
      ev.liftNecesario = ev === base ? 0 : liftNeeded(ev, base);
      ev.mejor = ev === best;
    }
    return { evs, base, best };
  }

  /* Mezcla real de tus pedidos entregados: qué parte lleva 1, 2 o 3+ unidades. */
  function unitMix(orders) {
    const del = orders.filter((o) => o.estado === 'entregado');
    const mix = { 1: 0, 2: 0, 3: 0 };
    for (const o of del) mix[Math.min(3, Math.max(1, o.units))]++;
    const n = del.length;
    return { n, uno: n ? mix[1] / n : null, dos: n ? mix[2] / n : null, tresOMas: n ? mix[3] / n : null };
  }

  const api = { DEFAULT_OFERTAS, evaluate, liftNeeded, compare, unitMix };
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).offers = api;
})(typeof window !== 'undefined' ? window : globalThis);
