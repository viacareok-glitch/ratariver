/*
 * Conexiones del panel: datos guardados (db del artifact o, si no hay, este navegador),
 * Shopify (conector de claude.ai) y Claude (para guiones y análisis).
 */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const SERVER = 'Shopify';

  function use(name) {
    try {
      return root.claude && typeof root.claude.use === 'function' ? root.claude.use(name).catch(() => null) : Promise.resolve(null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  /* ---------------- Datos guardados ---------------- */

  const listeners = new Map(); // ruta de colección → Set(cb)
  const Store = {
    mode: 'pending', // 'db' | 'local'
    readOnly: false,
    db: null,
    cache: new Map(), // ruta de doc → datos
    queues: new Map(),

    async init() {
      const db = await use('db');
      if (db) {
        this.db = db;
        this.mode = 'db';
      } else {
        this.mode = 'local';
      }
      return this.mode;
    },

    _localKey(path) {
      return 'vc:' + path;
    },

    _localGet(path) {
      try {
        const raw = localStorage.getItem(this._localKey(path));
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    _localSet(path, data) {
      try {
        if (data == null) localStorage.removeItem(this._localKey(path));
        else localStorage.setItem(this._localKey(path), JSON.stringify(data));
      } catch (e) {
        /* almacenamiento bloqueado: queda solo en memoria */
      }
    },

    _localCollection(col) {
      const out = new Map();
      try {
        const prefix = this._localKey(col + '/');
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
            out.set(k.slice(prefix.length), JSON.parse(localStorage.getItem(k)));
          }
        }
      } catch (e) {
        /* ignorar */
      }
      for (const [p, d] of this.cache) {
        if (p.startsWith(col + '/') && !p.slice(col.length + 1).includes('/')) out.set(p.slice(col.length + 1), d);
      }
      return out;
    },

    _emit(path) {
      const col = path.split('/').slice(0, -1).join('/');
      const set = listeners.get(col);
      if (set && this.mode === 'local') {
        const data = this._localCollection(col);
        for (const cb of set) cb(data);
      }
    },

    async get(path) {
      if (this.cache.has(path)) return this.cache.get(path);
      let data = null;
      if (this.mode === 'db') {
        try {
          const snap = await this.db.doc(path).get();
          data = snap.exists ? snap.data() : null;
        } catch (e) {
          data = null;
        }
      } else {
        data = this._localGet(path);
      }
      if (data) this.cache.set(path, data);
      return data;
    },

    /* Escribe el documento completo. Las escrituras a un mismo documento van de a una. */
    set(path, data) {
      this.cache.set(path, data);
      const prev = this.queues.get(path) || Promise.resolve();
      const next = prev
        .catch(() => {})
        .then(async () => {
          if (this.mode === 'db') {
            try {
              await this.db.doc(path).set(data);
            } catch (e) {
              if (e && e.code === 'invalid_argument') this.readOnly = true;
              throw e;
            }
          } else {
            this._localSet(path, data);
            this._emit(path);
          }
        });
      this.queues.set(path, next);
      return next;
    },

    /* Mezcla campos sobre lo último conocido del documento. */
    async patch(path, partial) {
      const cur = this.cache.has(path) ? this.cache.get(path) : await this.get(path);
      const data = Object.assign({}, cur || {}, partial);
      return this.set(path, data);
    },

    async remove(path) {
      this.cache.delete(path);
      if (this.mode === 'db') await this.db.doc(path).delete();
      else {
        this._localSet(path, null);
        this._emit(path);
      }
    },

    /* Escucha una colección completa: cb(Map id → datos). Devuelve la función para dejar de escuchar. */
    watch(col, cb, onError) {
      if (this.mode === 'db') {
        return this.db.collection(col).onSnapshot(
          (snap) => {
            const m = new Map();
            for (const d of snap.docs) {
              const data = d.data();
              m.set(d.id, data);
              this.cache.set(col + '/' + d.id, data);
            }
            cb(m);
          },
          (e) => onError && onError(e)
        );
      }
      if (!listeners.has(col)) listeners.set(col, new Set());
      listeners.get(col).add(cb);
      setTimeout(() => cb(this._localCollection(col)), 0);
      return () => listeners.get(col).delete(cb);
    },

    watchDoc(path, cb) {
      if (this.mode === 'db') {
        return this.db.doc(path).onSnapshot(
          (snap) => {
            const data = snap.exists ? snap.data() : null;
            if (data) this.cache.set(path, data);
            cb(data);
          },
          () => {}
        );
      }
      setTimeout(() => cb(this._localGet(path) || this.cache.get(path) || null), 0);
      return () => {};
    },
  };

  /* ---------------- Shopify ---------------- */

  const ORDER_FIELDS = `
      id
      name
      createdAt
      closedAt
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      phone
      tags
      note
      customAttributes { key value }
      totalPriceSet { shopMoney { amount } }
      subtotalLineItemsQuantity
      shippingAddress { firstName lastName name phone address1 address2 city province zip }
      lineItems(first: 10) { nodes { title quantity originalUnitPriceSet { shopMoney { amount } } } }
      fulfillments(first: 5) { status displayStatus createdAt deliveredAt }`;

  const ORDERS_QUERY =
    'query Pedidos($first: Int!, $query: String, $after: String) {\n  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {\n    pageInfo { hasNextPage endCursor }\n    nodes {' +
    ORDER_FIELDS +
    '\n    }\n  }\n}';

  const TAGS_MUTATION =
    'mutation Etiquetar($id: ID!, $add: [String!]!, $remove: [String!]!) {\n  tagsAdd(id: $id, tags: $add) { userErrors { field message } }\n  tagsRemove(id: $id, tags: $remove) { userErrors { field message } }\n}';

  const SHOP_ERRORS = {
    needs_reauth: 'Shopify pide que te vuelvas a conectar. Abrí claude.ai → Configuración → Conectores y reconectá Shopify.',
    server_not_connected: 'No encontramos el conector de Shopify en tu cuenta. Agregalo en claude.ai → Configuración → Conectores, o importá el CSV de pedidos.',
    selection_required: 'Tenés más de un conector de Shopify. Elegí cuál usar en el aviso de claude.ai y recargá.',
    not_in_manifest: 'No le diste permiso a esta página para usar Shopify. Habilitalo en Permisos.',
    blocked_by_policy: 'Tu organización bloquea Shopify en esta página.',
    approval_required: 'Shopify necesita tu aprobación para esta acción.',
    server_unavailable: 'Shopify no respondió. Probá de nuevo en un minuto.',
    not_granted: 'Esta vista no tiene acceso a Shopify. Abrí el panel desde claude.ai o importá el CSV de pedidos.',
    capability_disabled: 'Esta vista no tiene acceso a Shopify. Abrí el panel desde claude.ai o importá el CSV de pedidos.',
    consent_required: 'Falta tu permiso para usar Shopify en esta página.',
  };

  function shopError(e) {
    const code = (e && e.code) || 'upstream_error';
    return {
      code,
      message: SHOP_ERRORS[code] || (code === 'tool_error' ? 'Shopify devolvió un error: ' + (e.message || '') : 'No pudimos hablar con Shopify (' + code + '). Probá de nuevo.'),
      retryable: !!(e && e.retryable),
      canManage: code === 'not_in_manifest' || code === 'consent_required',
    };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const Shop = {
    mcp: null,
    mode: 'pending', // 'live' | 'csv' | 'none'
    orders: [], // últimos pedidos (más nuevos primero)
    loadedAt: null,
    oldestCovered: null, // día más viejo cubierto por completo
    complete: false, // se trajo todo el historial
    error: null,
    loading: null,
    subs: new Set(),

    async init() {
      this.mcp = await use('mcp');
      this.mode = this.mcp ? 'live' : 'none';
      return this.mode;
    },

    onChange(cb) {
      this.subs.add(cb);
      return () => this.subs.delete(cb);
    },

    _notify() {
      for (const cb of this.subs) {
        try {
          cb(this);
        } catch (e) {
          console.error(e);
        }
      }
    },

    async _call(tool, input, opts, isRead) {
      try {
        const res = await this.mcp.callTool(SERVER, tool, input, opts);
        return res.payload;
      } catch (e) {
        if (isRead && e && e.retryable) {
          await sleep(Math.min(e.retryAfterMs || 1500 + Math.random() * 1500, 8000));
          const res = await this.mcp.callTool(SERVER, tool, input, opts);
          return res.payload;
        }
        throw e;
      }
    },

    async gql(query, variables, fresh) {
      const input = { query, variables };
      if (variables && variables.first) input.first = variables.first;
      if (variables && variables.after) input.after = variables.after;
      const payload = await this._call('graphql_query', input, { cache: fresh ? { refresh: true, staleTime: 60000 } : { staleTime: 60000 } }, true);
      const data = typeof payload === 'string' ? safeJSON(payload) : payload;
      if (!data || typeof data !== 'object') throw { code: 'tool_error', message: String(payload).slice(0, 200) };
      if (data.errors && !data.data) throw { code: 'tool_error', message: (data.errors[0] && data.errors[0].message) || 'error de GraphQL' };
      return data.data || data;
    },

    /*
     * Trae pedidos desde `sinceDay` (AAAA-MM-DD, hora AR) hasta hoy, o los últimos `maxPages`×50 si sinceDay es null.
     */
    async fetchOrders({ sinceDay, maxPages, fresh }) {
      const query = sinceDay ? "created_at:>='" + U.dayStartUTC(sinceDay) + "'" : null;
      const out = [];
      let after = null;
      let complete = false;
      for (let page = 0; page < (maxPages || 10); page++) {
        const vars = { first: 50, query, after };
        const data = await this.gql(ORDERS_QUERY, vars, fresh);
        const conn = data.orders;
        if (!conn) throw { code: 'tool_error', message: 'Respuesta inesperada de Shopify' };
        for (const n of conn.nodes || []) out.push(VC.orders.fromGraphQL(n));
        if (!conn.pageInfo || !conn.pageInfo.hasNextPage) {
          complete = true;
          break;
        }
        after = conn.pageInfo.endCursor;
      }
      return { orders: out, complete };
    },

    _merge(list) {
      const by = new Map(this.orders.map((o) => [o.id, o]));
      for (const o of list) by.set(o.id, o);
      this.orders = [...by.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    /*
     * Asegura tener cargados los pedidos desde `sinceDay`. Primero intenta con los últimos 300 pedidos
     * (alcanza para las tasas históricas y, en una tienda chica, para todo).
     */
    async ensure(sinceDay, { fresh } = {}) {
      if (this.mode === 'csv') return this.orders;
      if (this.mode !== 'live') throw { code: 'not_granted' };
      const covered = () => this.complete || (this.oldestCovered && sinceDay && this.oldestCovered <= sinceDay);
      if (!fresh && this.loadedAt && covered()) return this.orders;
      if (this.loading) {
        await this.loading.catch(() => {});
        if (!fresh && covered()) return this.orders;
      }
      this.loading = (async () => {
        this.error = null;
        this._notify();
        if (fresh || !this.loadedAt) {
          const { orders, complete } = await this.fetchOrders({ maxPages: 6, fresh });
          this.orders = [];
          this._merge(orders);
          this.complete = complete;
          this.oldestCovered = orders.length ? orders[orders.length - 1].day : null;
          if (!complete && this.oldestCovered) this.oldestCovered = U.addDays(this.oldestCovered, 1);
        }
        if (sinceDay && !covered()) {
          const { orders } = await this.fetchOrders({ sinceDay, maxPages: 20, fresh });
          this._merge(orders);
          this.oldestCovered = sinceDay;
        }
        this.loadedAt = Date.now();
      })();
      try {
        await this.loading;
      } catch (e) {
        this.error = shopError(e);
        throw this.error;
      } finally {
        this.loading = null;
        this._notify();
      }
      return this.orders;
    },

    importCSV(text) {
      const { rows } = U.parseCSV(text);
      const list = VC.orders.fromShopifyCSV(rows);
      if (!list.length) throw new Error('No encontramos pedidos en el archivo. Usá Shopify → Pedidos → Exportar → CSV para Excel.');
      this.mode = 'csv';
      this.orders = list;
      this.complete = true;
      this.loadedAt = Date.now();
      this.error = null;
      this._notify();
      return list;
    },

    /* Crea un código de descuento porcentual para toda la tienda, activo desde ahora. */
    async createDiscount({ code, percentage, title }) {
      if (this.mode !== 'live') throw { code: 'not_granted' };
      const payload = await this._call(
        'create-discount',
        { title: title || code, code, percentage, startsAt: new Date().toISOString(), customerEligibility: 'all_customers' },
        { cache: false },
        false
      );
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    },

    async setTags(order, add, remove) {
      if (this.mode !== 'live' || !/^gid:/.test(order.id)) return { skipped: true };
      const payload = await this._call('graphql_mutation', { query: TAGS_MUTATION, variables: { id: order.id, add, remove } }, { cache: false }, false);
      const data = typeof payload === 'string' ? safeJSON(payload) : payload;
      const errs = data && data.data ? [].concat(data.data.tagsAdd ? data.data.tagsAdd.userErrors : [], data.data.tagsRemove ? data.data.tagsRemove.userErrors : []) : [];
      if (data && data.errors && !data.data) throw { code: 'tool_error', message: data.errors[0] && data.errors[0].message };
      if (errs.length) throw { code: 'tool_error', message: errs[0].message };
      order.tags = order.tags.filter((t) => !remove.includes(t)).concat(add.filter((t) => !order.tags.includes(t)));
      return { ok: true };
    },
  };

  function safeJSON(s) {
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  /* ---------------- Claude ---------------- */

  const AI_ERRORS = {
    not_granted: 'No diste permiso para usar Claude en esta página.',
    sampling_disabled: 'Claude no está disponible para esta cuenta.',
    rate_limited: 'Llegaste al límite de uso por ahora. Probá en unos minutos.',
    session_expired: 'Tu sesión venció. Volvé a iniciar sesión en claude.ai.',
    refused: 'Claude no quiso responder ese pedido. Cambiá el texto e intentá de nuevo.',
    invalid_json: 'La respuesta vino incompleta. Probá de nuevo o pedí menos guiones.',
    empty_completion: 'Claude no devolvió texto. Probá con un pedido más simple.',
    prompt_too_large: 'Hay demasiados datos para enviar. Probá con menos filas.',
  };

  const AI = {
    sample: null,
    async init() {
      this.sample = await use('sample');
      return !!this.sample;
    },
    errorText(e) {
      const code = (e && e.code) || 'upstream_error';
      return AI_ERRORS[code] || 'Se cortó la conexión con Claude. Probá de nuevo.';
    },
    permanent(e) {
      return ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e && e.code);
    },
  };

  async function managePermissions() {
    const p = await use('permissions');
    if (p && p.manage) {
      try {
        await p.manage();
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  VC.runtime = { Store, Shop, AI, use, managePermissions, ORDERS_QUERY, TAGS_MUTATION };
})(window);
