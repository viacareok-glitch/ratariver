/* Reactivador: arma la lista de clientes que ya pagaron y elige la oferta para cada uno. */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const U = isNode ? require('./util.js') : root.VC.util;

  const OFERTAS = {
    familia: {
      label: 'Segunda unidad para tu familia',
      corto: 'Familia',
      mensaje:
        '¡Hola {nombre}! Te escribimos de {tienda} 😊 ¿Cómo te viene yendo con el corrector?\n\nComo ya sos cliente, te guardamos una oferta: un segundo corrector para alguien de tu familia a {precio_oferta} (en vez de {precio}).{codigo_txt} Pagás cuando te llega, como la vez pasada.\n\n¿Te lo mandamos a la misma dirección?',
    },
    amigo: {
      label: 'Traé un amigo',
      corto: 'Amigo',
      mensaje:
        '¡Hola {nombre}! Te escribimos de {tienda} 😊 Gracias por confiar en nosotros.\n\nSi conocés a alguien que también termina el día con la espalda o el cuello cargados, pasale este mensaje: con tu nombre tiene {beneficio_amigo} en su corrector, y a vos te regalamos {premio}.{codigo_txt}\n\nCualquier cosa nos escribís por acá.',
    },
    recompra: {
      label: 'Volvé a comprar',
      corto: 'Recompra',
      mensaje:
        '¡Hola {nombre}! Somos {tienda} 😊 Hace un tiempo te llevaste tu corrector y queríamos saber cómo te fue.\n\nEsta semana tenemos una oferta solo para clientes: {oferta_libre}.{codigo_txt} Pagás al recibir. ¿Te interesa?',
    },
  };

  const DEFAULT_CFG = {
    minDias: 20, // días desde la compra para escribirle (que ya lo haya usado)
    pausaDias: 30, // no volver a escribirle antes de esto
    precioOferta: 45000,
    beneficioAmigo: '10% de descuento',
    premio: 'un 10% de descuento en tu próxima compra',
    ofertaLibre: '2 correctores con 20% de descuento',
    codigo: '',
    mensajes: {},
  };

  function lastDate(o) {
    return o.closedAt || o.deliveredAt || o.shippedAt || o.createdAt;
  }

  /*
   * Agrupa pedidos por WhatsApp. Un cliente es reactivable si tiene al menos un pedido entregado,
   * ningún pedido abierto y pasaron `minDias` desde su última compra.
   */
  function buildCustomers(orders, opts) {
    const o = Object.assign({ minDias: 20, now: Date.now(), resenas: new Map() }, opts || {});
    const by = new Map();
    for (const ord of orders) {
      const k = ord.phone && ord.phone.wa;
      if (!k) continue;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(ord);
    }
    const out = [];
    for (const [wa, list] of by) {
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const entregados = list.filter((x) => x.estado === 'entregado' || x.estado === 'pagado');
      if (!entregados.length) continue;
      const ultimo = entregados[0];
      const abiertos = list.filter((x) => x.estado === 'pendiente' || x.estado === 'en_camino');
      const resena = entregados.map((x) => o.resenas.get(x.key)).find((r) => r && r.estado === 'recibida') || null;
      const dias = Math.floor(U.hoursSince(lastDate(ultimo), o.now) / 24);
      out.push({
        wa,
        key: wa,
        nombre: U.capitalizeName([ultimo.firstName, ultimo.lastName].filter(Boolean).join(' ')),
        firstName: ultimo.firstName,
        ciudad: ultimo.city,
        provincia: ultimo.province,
        direccion: [ultimo.address1, ultimo.city].filter(Boolean).join(', '),
        phone: ultimo.phone,
        pedidos: list.length,
        compras: entregados.length,
        unidades: U.sum(entregados, (x) => x.units),
        gastado: U.sum(entregados, (x) => x.total),
        ultimaCompra: lastDate(ultimo),
        ultimoPedido: list[0].name,
        ultimoPedidoAt: list[0].createdAt,
        dias,
        abierto: abiertos.length > 0,
        resena,
        listo: abiertos.length === 0 && dias >= o.minDias,
        orders: list,
      });
    }
    return out.sort((a, b) => b.gastado - a.gastado || (a.ultimaCompra < b.ultimaCompra ? 1 : -1));
  }

  /* Oferta sugerida: quien llevó 2+ o dejó buena reseña ya confía → referido; el resto → segunda unidad. */
  function suggestOffer(c) {
    if ((c.resena && Number(c.resena.estrellas) >= 4) || c.unidades >= 2 || c.compras >= 2) return 'amigo';
    return 'familia';
  }

  /* ¿Volvió a comprar después de que le escribimos? (pedido nuevo no anulado con su WhatsApp) */
  function reordered(c, contactoISO) {
    if (!contactoISO) return null;
    const hit = c.orders.find((x) => x.createdAt > contactoISO && x.estado !== 'anulado');
    return hit || null;
  }

  function messageVars(c, cfg, msgs) {
    const conf = Object.assign({}, DEFAULT_CFG, cfg || {});
    const precio = (msgs && msgs.precio1) || 68990;
    return {
      nombre: U.firstName(c.firstName) || 'hola',
      tienda: (msgs && msgs.tienda) || 'ViaCare',
      precio: U.money(precio),
      precio_oferta: U.money(conf.precioOferta),
      beneficio_amigo: conf.beneficioAmigo,
      premio: conf.premio,
      oferta_libre: conf.ofertaLibre,
      codigo: conf.codigo || '',
      codigo_txt: conf.codigo ? ' Usá el código ' + conf.codigo + '.' : '',
      ciudad: c.ciudad || '',
    };
  }

  function message(c, ofertaId, cfg, msgs) {
    const conf = Object.assign({}, DEFAULT_CFG, cfg || {});
    const tpl = (conf.mensajes && conf.mensajes[ofertaId]) || OFERTAS[ofertaId].mensaje;
    return U.fillTemplate(tpl, messageVars(c, conf, msgs));
  }

  const api = { OFERTAS, DEFAULT_CFG, buildCustomers, suggestOffer, reordered, message, messageVars };
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).customers = api;
})(typeof window !== 'undefined' ? window : globalThis);
