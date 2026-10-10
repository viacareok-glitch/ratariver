/*
 * Motor de tareas automáticas del panel: escaneo de la competencia, revisión de tiendas, búsqueda de productos
 * ganadores y guiones del día. Cada herramienta registra su tarea; el motor las corre de a una, cuando toca
 * (al abrir el panel, si pasó el tiempo configurado) o cuando el usuario toca "ahora".
 */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const { Store, AI, Browser } = VC.runtime;

  const ORDEN = ['competencia', 'tiendas', 'productos', 'guiones'];

  const DEFAULTS = {
    competencia: { auto: false, cadaHoras: 24, busquedas: VC.competitors.BUSQUEDAS.slice(), guionesTras: true },
    tiendas: { auto: false, cadaHoras: 24, dominios: [] },
    productos: { auto: false, cadaHoras: 168 },
    guiones: { auto: false, cadaHoras: 24, cantidad: 3, clips: 4 },
  };

  const NOMBRES = {
    competencia: 'escaneo de la competencia',
    tiendas: 'revisión de tiendas',
    productos: 'búsqueda de productos ganadores',
    guiones: 'guiones del día',
  };

  const jobs = new Map();
  const subs = new Set();
  let cola = Promise.resolve();
  const enCola = new Map(); // nombre → promesa
  let ctl = null;

  const Auto = {
    ORDEN,
    DEFAULTS,
    NOMBRES,
    cfg: JSON.parse(JSON.stringify(DEFAULTS)),
    estado: {}, // nombre → {ultima, origen, resultado, error}
    running: null,
    progress: {},
    loaded: false,

    /* Registra la tarea de una herramienta. job = {needs: ['browser'|'sample'], run: async (ctx) => resultado} */
    register(name, job) {
      jobs.set(name, job);
    },

    on(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },

    emit(evt) {
      for (const cb of subs) {
        try {
          cb(evt);
        } catch (err) {
          console.error(err);
        }
      }
    },

    async load() {
      const [cfg, estado] = await Promise.all([Store.get('config/automatico'), Store.get('auto/estado')]);
      if (cfg) for (const k of ORDEN) this.cfg[k] = Object.assign({}, DEFAULTS[k], cfg[k] || {});
      if (estado) this.estado = Object.assign({}, estado);
      this.loaded = true;
      this.emit({ type: 'cfg' });
    },

    setCfg(name, patch) {
      this.cfg[name] = Object.assign({}, this.cfg[name], patch);
      this._saveCfg();
      this.emit({ type: 'cfg', job: name });
    },

    _saveCfg: VC.ui.debounce(() => Store.set('config/automatico', JSON.parse(JSON.stringify(Auto.cfg))).catch(VC.ui.storeFail), 600),

    ultima(name) {
      return (this.estado[name] && this.estado[name].ultima) || null;
    },

    due(name) {
      const c = this.cfg[name];
      const u = this.ultima(name);
      return !u || U.hoursSince(u) >= (Number(c && c.cadaHoras) || 24);
    },

    /* ¿Se puede correr acá? Devuelve {ok, motivo}. */
    can(name) {
      const job = jobs.get(name);
      if (!job) return { ok: false, motivo: 'La herramienta todavía no cargó.' };
      for (const n of job.needs || []) {
        if (n === 'browser' && !Browser.available) return { ok: false, motivo: 'Necesita el navegador de Claude: abrí este panel desde la app de escritorio de Claude (Cowork).' };
        if (n === 'sample' && !AI.sample) return { ok: false, motivo: 'Necesita Claude: abrí este panel desde claude.ai o la app de Claude.' };
      }
      return { ok: true, motivo: '' };
    },

    /*
     * Corre una tarea (de a una por vez; si hay otra corriendo, espera). origen: 'manual' | 'auto' | 'cadena'.
     * Devuelve el resultado de la tarea, o null si falló o se canceló.
     */
    run(name, opts) {
      if (enCola.has(name)) return enCola.get(name);
      const p = (cola = cola.then(() => this._run(name, opts || {})).catch(() => null));
      enCola.set(name, p);
      p.finally(() => enCola.delete(name));
      return p;
    },

    async _run(name, opts) {
      const job = jobs.get(name);
      const chk = this.can(name);
      if (!job || !chk.ok) {
        this.emit({ type: 'skip', job: name, motivo: chk.motivo });
        return null;
      }
      ctl = new AbortController();
      this.running = name;
      this.progress[name] = 'Empezando…';
      this.emit({ type: 'start', job: name, origen: opts.origen || 'manual' });
      const ctx = {
        signal: ctl.signal,
        origen: opts.origen || 'manual',
        motivo: opts.motivo || '',
        progress: (text) => {
          this.progress[name] = text;
          this.emit({ type: 'progress', job: name, text });
        },
      };
      let resultado = null;
      let error = '';
      try {
        resultado = await job.run(ctx);
      } catch (err) {
        error = err && err.code === 'cancelled' ? 'Cancelado.' : (err && (err.userMessage || err.message)) || 'Error inesperado.';
        if (err && err.code !== 'cancelled') console.error(err);
      }
      this.running = null;
      this.progress[name] = '';
      const cancelado = ctl.signal.aborted;
      ctl = null;
      this.estado[name] = {
        ultima: cancelado ? this.ultima(name) : new Date().toISOString(),
        origen: ctx.origen,
        resultado: resultado ? small(resultado) : null,
        error: cancelado ? 'Cancelado.' : error,
      };
      Store.set('auto/estado', JSON.parse(JSON.stringify(this.estado))).catch(() => {});
      this.emit({ type: error || cancelado ? 'error' : 'done', job: name, resultado, error: this.estado[name].error, origen: ctx.origen });
      if (resultado && resultado.siguiente && !cancelado) this.run(resultado.siguiente, { origen: 'cadena', motivo: resultado.motivoSiguiente || '' });
      return error || cancelado ? null : resultado;
    },

    stop() {
      if (ctl) ctl.abort();
    },

    /* Al abrir el panel: corre en orden las tareas activadas que ya tocan. */
    async boot() {
      if (!this.loaded) await this.load();
      for (const name of ORDEN) {
        const c = this.cfg[name];
        if (c && c.auto && this.due(name) && this.can(name).ok) await this.run(name, { origen: 'auto' });
      }
    },
  };

  // Lo que se guarda del resultado en auto/estado: solo números y textos cortos
  function small(r) {
    const out = {};
    for (const [k, v] of Object.entries(r || {})) {
      if (k === 'siguiente' || k === 'motivoSiguiente') continue;
      if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string') out[k] = v.slice(0, 400);
    }
    return out;
  }

  VC.auto = Auto;
})(window);
