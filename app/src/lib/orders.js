/* Pedidos: normaliza lo que devuelve Shopify (GraphQL o CSV exportado) y calcula estados y tasas. */
(function (root) {
  'use strict';
  const U = typeof module === 'object' && module.exports ? require('./util.js') : root.VC.util;

  // Ítems que no son unidades de producto (upsell de envío, seguro, etc.)
  const NON_PRODUCT = /env[ií]o|seguro|shipping|garant[ií]a|prioritario|protecci[oó]n/i;

  const ESTADOS = {
    pendiente: { label: 'Sin despachar', tone: 'neutral' },
    pagado: { label: 'Pagado, sin despachar', tone: 'info' },
    en_camino: { label: 'En camino', tone: 'info' },
    entregado: { label: 'Entregado y cobrado', tone: 'good' },
    anulado: { label: 'Anulado', tone: 'bad' },
    devuelto: { label: 'Devuelto', tone: 'bad' },
  };

  function attr(attrs, ...keys) {
    if (!attrs) return '';
    for (const k of keys) {
      const hit = attrs.find((a) => U.stripAccents(a.key || '').toLowerCase() === U.stripAccents(k).toLowerCase());
      if (hit && hit.value) return String(hit.value).trim();
    }
    return '';
  }

  function classify(o) {
    const fin = String(o.financialStatus || '').toUpperCase();
    const ful = String(o.fulfillmentStatus || '').toUpperCase();
    const shipped = o.fulfilled || (ful !== 'UNFULFILLED' && /FULFILLED|IN_PROGRESS|SHIPPED|DELIVERED/.test(ful));
    const cancelled = !!o.cancelledAt || fin === 'VOIDED';
    if (/REFUNDED/.test(fin)) return 'devuelto';
    if (cancelled) return shipped ? 'devuelto' : 'anulado';
    if (fin === 'PAID') return shipped ? 'entregado' : 'pagado';
    return shipped ? 'en_camino' : 'pendiente';
  }

  function sourceOf(utm) {
    const s = U.stripAccents(utm || '').toLowerCase();
    if (!s) return 'organico';
    if (/tiktok|tt\b/.test(s)) return 'tiktok';
    if (/facebook|^fb|instagram|^ig|meta/.test(s)) return 'meta';
    if (/google|youtube/.test(s)) return 'google';
    return 'otro';
  }

  const SOURCES = {
    tiktok: 'TikTok',
    meta: 'Meta',
    google: 'Google',
    otro: 'Otro',
    organico: 'Sin UTM',
  };

  function addressWarnings(o) {
    const w = [];
    const a1 = (o.address1 || '').trim();
    if (!a1) w.push('Falta la dirección');
    else if (!/\d/.test(a1) && !/manzana|mz|lote|km|ruta|barrio/i.test(a1)) w.push('La dirección no tiene número');
    if (!o.zip) w.push('Falta el código postal');
    if (o.tags.some((t) => /dropi sync error/i.test(t)) || /nota dropi/i.test(o.note || '')) {
      const m = (o.note || '').match(/Nota Dropi:\s*(.+?)\s*(?:--|$)/i);
      const msg = m ? m[1].trim().replace(/^\d+:\s*/, '') : 'error de sincronización';
      w.push('Dropi: ' + (msg.length > 140 ? msg.slice(0, 137) + '…' : msg));
    }
    return w;
  }

  /* Normaliza un nodo de la consulta GraphQL de pedidos. */
  function fromGraphQL(n) {
    const attrs = n.customAttributes || [];
    const sa = n.shippingAddress || {};
    const lines = ((n.lineItems && n.lineItems.nodes) || []).map((li) => ({
      title: li.title,
      quantity: li.quantity || 0,
      price: U.parseNum(li.originalUnitPriceSet && li.originalUnitPriceSet.shopMoney && li.originalUnitPriceSet.shopMoney.amount) || 0,
    }));
    const productLines = lines.filter((l) => !NON_PRODUCT.test(l.title || ''));
    const units = productLines.length ? U.sum(productLines, (l) => l.quantity) : n.subtotalLineItemsQuantity || 1;
    const fulfillments = n.fulfillments || [];
    const deliveredAt = (fulfillments.find((f) => f.deliveredAt) || {}).deliveredAt || null;
    const o = {
      id: n.id,
      key: U.legacyId(n.id),
      name: n.name,
      createdAt: n.createdAt,
      closedAt: n.closedAt || null,
      cancelledAt: n.cancelledAt || null,
      financialStatus: n.displayFinancialStatus,
      fulfillmentStatus: n.displayFulfillmentStatus,
      fulfilled: fulfillments.length > 0,
      shippedAt: fulfillments.length ? fulfillments[0].createdAt : null,
      deliveredAt,
      total: U.parseNum(n.totalPriceSet && n.totalPriceSet.shopMoney && n.totalPriceSet.shopMoney.amount) || 0,
      units,
      lines,
      extras: lines.filter((l) => NON_PRODUCT.test(l.title || '')).map((l) => l.title),
      productTitle: productLines[0] ? productLines[0].title : '',
      firstName: sa.firstName || attr(attrs, 'Nombre') || (sa.name || '').split(' ')[0] || '',
      lastName: sa.lastName || attr(attrs, 'Apellido') || '',
      phoneRaw: attr(attrs, 'WhatsApp', 'Teléfono', 'Telefono', 'Celular') || n.phone || sa.phone || '',
      address1: sa.address1 || attr(attrs, 'Dirección', 'Direccion') || '',
      address2: sa.address2 || '',
      city: sa.city || attr(attrs, 'Ciudad') || '',
      province: sa.province || '',
      zip: sa.zip || attr(attrs, 'Código postal', 'Codigo postal') || '',
      courierNote: attr(attrs, 'Nota para el transportista'),
      note: n.note || '',
      tags: n.tags || [],
      utmSource: attr(attrs, 'UTM source', 'utm_source'),
      utmCampaign: attr(attrs, 'UTM campaign', 'utm_campaign'),
    };
    return finish(o);
  }

  function finish(o) {
    o.estado = classify(o);
    o.day = U.dayKeyAR(o.createdAt);
    o.source = sourceOf(o.utmSource);
    o.phone = U.normalizePhoneAR(o.phoneRaw);
    o.fullName = U.capitalizeName([o.firstName, o.lastName].filter(Boolean).join(' '));
    o.warnings = addressWarnings(o);
    return o;
  }

  /*
   * Normaliza el CSV de "Exportar pedidos" de Shopify (una fila por ítem; los datos del pedido van en la primera).
   */
  function fromShopifyCSV(rows) {
    const byName = new Map();
    for (const r of rows) {
      const name = r['Name'] || r['Nombre'];
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(r);
    }
    const out = [];
    for (const [name, group] of byName) {
      const h = group.find((r) => r['Total']) || group[0];
      const attrsText = h['Note Attributes'] || '';
      const attrs = attrsText
        .split(/\r?\n/)
        .map((l) => {
          const i = l.indexOf(':');
          return i > 0 ? { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : null;
        })
        .filter(Boolean);
      const parseDate = (s) => {
        if (!s) return null;
        const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})?/);
        if (m) return new Date(m[1] + 'T' + m[2] + m[3] + ':' + (m[4] || '00')).toISOString();
        const t = Date.parse(s);
        return Number.isFinite(t) ? new Date(t).toISOString() : null;
      };
      const lines = group
        .filter((r) => r['Lineitem name'])
        .map((r) => ({ title: r['Lineitem name'], quantity: U.parseNum(r['Lineitem quantity']) || 0, price: U.parseNum(r['Lineitem price']) || 0 }));
      const fin = String(h['Financial Status'] || '').toUpperCase().replace(/\s+/g, '_');
      const ful = String(h['Fulfillment Status'] || '').toUpperCase();
      const productLines = lines.filter((l) => !NON_PRODUCT.test(l.title));
      const shipName = h['Shipping Name'] || h['Billing Name'] || '';
      const o = {
        id: 'csv-' + (h['Id'] || name),
        key: String(h['Id'] || name).replace(/[^\w.-]/g, '_'),
        name,
        createdAt: parseDate(h['Created at']),
        closedAt: null,
        cancelledAt: parseDate(h['Cancelled at']),
        financialStatus: fin,
        fulfillmentStatus: ful === 'FULFILLED' ? 'FULFILLED' : ful === 'PARTIAL' ? 'PARTIALLY_FULFILLED' : 'UNFULFILLED',
        fulfilled: ful === 'FULFILLED' || ful === 'PARTIAL',
        shippedAt: parseDate(h['Fulfilled at']),
        deliveredAt: null,
        total: U.parseNum(h['Total']) || 0,
        units: productLines.length ? U.sum(productLines, (l) => l.quantity) : 1,
        lines,
        extras: lines.filter((l) => NON_PRODUCT.test(l.title)).map((l) => l.title),
        productTitle: productLines[0] ? productLines[0].title : '',
        firstName: attr(attrs, 'Nombre') || shipName.split(' ')[0] || '',
        lastName: attr(attrs, 'Apellido') || shipName.split(' ').slice(1).join(' '),
        phoneRaw: attr(attrs, 'WhatsApp') || h['Shipping Phone'] || h['Phone'] || h['Billing Phone'] || '',
        address1: h['Shipping Address1'] || h['Shipping Street'] || '',
        address2: h['Shipping Address2'] || '',
        city: h['Shipping City'] || '',
        province: h['Shipping Province Name'] || h['Shipping Province'] || '',
        zip: (h['Shipping Zip'] || '').replace(/^'/, ''),
        courierNote: attr(attrs, 'Nota para el transportista'),
        note: h['Notes'] || '',
        tags: (h['Tags'] || '').split(',').map((t) => t.trim()).filter(Boolean),
        utmSource: attr(attrs, 'UTM source'),
        utmCampaign: attr(attrs, 'UTM campaign'),
      };
      if (!o.createdAt) continue;
      if (fin === 'PAID' && (h['Paid at'] || '')) o.closedAt = parseDate(h['Paid at']);
      out.push(finish(o));
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }

  /*
   * Tasas históricas a partir de pedidos ya resueltos (se ignoran los de las últimas 48 h, que todavía pueden cambiar).
   *  - confirmacion: de los pedidos resueltos, cuántos se despacharon (no se anularon antes de salir)
   *  - entrega: de los despachados que terminaron, cuántos se entregaron y cobraron
   */
  function historicalRates(orders, now) {
    const cutoff = (now || Date.now()) - 48 * 3600 * 1000;
    const old = orders.filter((o) => Date.parse(o.createdAt) < cutoff);
    const despachados = old.filter((o) => ['en_camino', 'entregado', 'devuelto', 'pagado'].includes(o.estado));
    const anulados = old.filter((o) => o.estado === 'anulado');
    const resueltosEnvio = old.filter((o) => o.estado === 'entregado' || o.estado === 'devuelto');
    const entregados = resueltosEnvio.filter((o) => o.estado === 'entregado');
    const nConf = despachados.length + anulados.length;
    const delivered = orders.filter((o) => o.estado === 'entregado');
    return {
      confirmacion: nConf ? despachados.length / nConf : null,
      entrega: resueltosEnvio.length ? entregados.length / resueltosEnvio.length : null,
      muestraConfirmacion: nConf,
      muestraEntrega: resueltosEnvio.length,
      ticketPromedio: delivered.length ? U.sum(delivered, (o) => o.total) / delivered.length : null,
      unidadesPromedio: delivered.length ? U.sum(delivered, (o) => o.units) / delivered.length : null,
      total: orders.length,
      anulados: orders.filter((o) => o.estado === 'anulado').length,
    };
  }

  // Pedidos repetidos: mismo WhatsApp en más de un pedido abierto
  function duplicateIndex(orders) {
    const byPhone = new Map();
    for (const o of orders) {
      if (!o.phone.wa) continue;
      if (!byPhone.has(o.phone.wa)) byPhone.set(o.phone.wa, []);
      byPhone.get(o.phone.wa).push(o.name);
    }
    const dup = new Map();
    for (const o of orders) {
      const list = byPhone.get(o.phone.wa) || [];
      if (list.length > 1) dup.set(o.id, list.filter((n) => n !== o.name));
    }
    return dup;
  }

  function productPhrase(units, singular, plural) {
    const n = units || 1;
    return n + ' ' + (n === 1 ? singular : plural);
  }

  /* Variables disponibles para las plantillas de WhatsApp. */
  function templateVars(o, cfg) {
    const singular = (cfg && cfg.productoSingular) || 'corrector de postura';
    const plural = (cfg && cfg.productoPlural) || 'correctores de postura';
    return {
      nombre: U.firstName(o.firstName) || 'hola',
      pedido: o.name,
      cantidad: productPhrase(o.units, singular, plural),
      unidades: o.units,
      producto: o.units === 1 ? singular : plural,
      total: U.money(o.total),
      direccion: [o.address1, o.address2].filter(Boolean).join(', '),
      ciudad: o.city,
      provincia: o.province,
      cp: o.zip,
      extras: o.extras.length ? ' + ' + o.extras.join(', ') : '',
      tienda: (cfg && cfg.tienda) || 'ViaCare',
      firma: (cfg && cfg.firma) || '',
    };
  }

  const api = {
    ESTADOS,
    SOURCES,
    NON_PRODUCT,
    classify,
    sourceOf,
    fromGraphQL,
    fromShopifyCSV,
    historicalRates,
    duplicateIndex,
    templateVars,
    addressWarnings,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.VC = root.VC || {}).orders = api;
})(typeof window !== 'undefined' ? window : globalThis);
