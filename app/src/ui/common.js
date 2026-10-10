/* Piezas de interfaz compartidas y estado global del panel. */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const { Store } = VC.runtime;

  const e = U.escapeHtml;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];

  const DEFAULT_MSGS = {
    tienda: 'ViaCare',
    firma: '',
    productoSingular: 'corrector de postura ViaCare',
    productoPlural: 'correctores de postura ViaCare',
    confirmacion:
      '¡Hola {nombre}! 👋 Te escribimos de {tienda} por tu pedido {pedido}.\n\n🛒 {cantidad}{extras}\n💵 Total: {total} (pagás al recibir)\n📍 Envío a: {direccion}, {ciudad}, {provincia} (CP {cp})\n\n¿Nos confirmás que los datos están bien para despacharlo? Respondé *SÍ* y sale hoy mismo 🙌',
    recordatorio:
      'Hola {nombre}, ¿pudiste ver nuestro mensaje? 😊 Para despachar tu pedido {pedido} ({cantidad}) necesitamos tu confirmación. Si ya no lo querés, avisanos y lo cancelamos sin problema.',
    direccion:
      'Hola {nombre}, te escribimos de {tienda} por tu pedido {pedido}. Para que el correo no tenga problemas, ¿nos pasás la dirección completa con número, entre calles y localidad? Tenemos: {direccion}, {ciudad}, {provincia} (CP {cp}).',
    resena:
      '¡Hola {nombre}! Somos {tienda} 😊 ¿Cómo te está yendo con el corrector? Ya pasaron unos días y nos encantaría saber tu opinión sincera: ¿qué notaste desde que lo usás?\n\nSi te animás, mandanos una foto usándolo (puede ser sobre la ropa y sin mostrar la cara). Con tu permiso la publicamos en la tienda con tu nombre de pila. ¡Gracias por elegirnos!',
    resenaRecordatorio: 'Hola {nombre}, ¿pudiste probar bien el corrector? Tu opinión, aunque sea cortita, nos ayuda un montón para mejorar. ¡Gracias!',
    productoGuiones: '',
    etiquetarShopify: true,
    diasResena: 4,
  };

  // Datos que usan las respuestas a comentarios, el reactivador y la calculadora de ofertas
  const DEFAULT_TIENDA = {
    precio1: 68990,
    precio2: 72990,
    envio: 'Enviamos a todo el país',
    pago: 'pagás en efectivo cuando te llega',
    demora: '',
    talles: '',
    garantia: '',
  };

  const App = {
    cfg: Object.assign({}, VC.profit.DEFAULT_CFG),
    msgs: Object.assign({}, DEFAULT_MSGS),
    tienda: Object.assign({}, DEFAULT_TIENDA),
    confirm: new Map(), // key pedido → {estado, ...}
    resenas: new Map(),
    ultimoAnalisis: null,
    subs: new Set(),
    on(cb) {
      this.subs.add(cb);
      return () => this.subs.delete(cb);
    },
    emit(what) {
      for (const cb of this.subs) {
        try {
          cb(what);
        } catch (err) {
          console.error(err);
        }
      }
    },
    saveCfg: debounce(function () {
      Store.set('config/negocio', Object.assign({}, App.cfg)).catch(storeFail);
    }, 700),
    saveMsgs: debounce(function () {
      Store.set('config/mensajes', Object.assign({}, App.msgs)).catch(storeFail);
    }, 700),
    saveTienda: debounce(function () {
      Store.set('config/tienda', Object.assign({}, App.tienda)).catch(storeFail);
    }, 700),
    // Nombre de la tienda + datos de venta, para plantillas
    datos() {
      return Object.assign({ tienda: App.msgs.tienda }, App.tienda);
    },
    confirmStates() {
      const m = new Map();
      for (const [k, v] of this.confirm) m.set(k, v.estado);
      return m;
    },
  };

  function storeFail(err) {
    if (err && err.code === 'invalid_argument') toast('No tenés permiso para guardar cambios en este panel.', 'bad');
    else if (err && err.code === 'quota_exceeded') toast('Se llenó el espacio del panel. Borrá datos viejos para seguir guardando.', 'bad');
    else toast('No se pudo guardar. Revisá la conexión y probá de nuevo.', 'bad');
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  let toastTimer;
  function toast(msg, tone) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.className = 'toast tone-' + (tone || 'neutral');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3800);
  }

  async function copyText(text, btn) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch (e2) {
        ok = false;
      }
      ta.remove();
    }
    if (btn) {
      const prev = btn.dataset.label || btn.textContent;
      btn.dataset.label = prev;
      btn.textContent = ok ? 'Copiado' : 'Seleccioná y copiá';
      setTimeout(() => (btn.textContent = prev), 1600);
    }
    if (!ok) toast('Tu navegador no dejó copiar. Seleccioná el texto y copialo a mano.', 'warn');
    return ok;
  }

  function chip(label, tone, extra) {
    return '<span class="chip tone-' + (tone || 'neutral') + '"' + (extra || '') + '>' + e(label) + '</span>';
  }

  function banner(tone, html, actions) {
    return '<div class="banner tone-' + tone + '"><div class="banner-text">' + html + '</div>' + (actions ? '<div class="banner-actions">' + actions + '</div>' : '') + '</div>';
  }

  function emptyState(title, body, actions) {
    return '<div class="empty"><h3>' + e(title) + '</h3><p>' + body + '</p>' + (actions ? '<div class="row-actions">' + actions + '</div>' : '') + '</div>';
  }

  const WA_ICON =
    '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';

  function waButton(href, label, act, key, variant) {
    if (!href) return '<button class="btn" disabled title="El teléfono no es válido">' + WA_ICON + e(label) + '</button>';
    return (
      '<a class="btn ' +
      (variant || 'wa') +
      '" href="' +
      e(href) +
      '" target="_blank" rel="noopener" data-act="' +
      e(act) +
      '" data-key="' +
      e(key) +
      '">' +
      WA_ICON +
      e(label) +
      '</a>'
    );
  }

  function kpi(label, value, sub, tone) {
    return (
      '<div class="kpi' +
      (tone ? ' tone-' + tone : '') +
      '"><div class="kpi-label">' +
      e(label) +
      '</div><div class="kpi-value">' +
      value +
      '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
      '</div>'
    );
  }

  function seg(name, options, current) {
    return (
      '<div class="seg" role="group" aria-label="' +
      e(name) +
      '">' +
      options
        .map(
          (o) =>
            '<button type="button" class="seg-btn' +
            (o.value === current ? ' is-on' : '') +
            '" aria-pressed="' +
            (o.value === current) +
            '" data-seg="' +
            e(name) +
            '" data-value="' +
            e(o.value) +
            '">' +
            e(o.label) +
            (o.count != null ? ' <span class="seg-count">' + e(o.count) + '</span>' : '') +
            '</button>'
        )
        .join('') +
      '</div>'
    );
  }

  function shopStatusBanner(err, onRetryAct) {
    if (!err) return '';
    const actions =
      (err.canManage ? '<button class="btn ghost" data-act="permisos">Abrir permisos</button>' : '') +
      '<button class="btn ghost" data-act="' +
      (onRetryAct || 'reintentar') +
      '">Reintentar</button>' +
      '<label class="btn ghost file-btn">Importar CSV de pedidos<input type="file" accept=".csv,text/csv" data-act="importar-csv" hidden></label>';
    return banner('bad', e(err.message), actions);
  }

  function prefGet(k, d) {
    try {
      const v = localStorage.getItem('vc-pref:' + k);
      return v == null ? d : JSON.parse(v);
    } catch (err) {
      return d;
    }
  }

  function prefSet(k, v) {
    try {
      localStorage.setItem('vc-pref:' + k, JSON.stringify(v));
    } catch (err) {
      /* ignorar */
    }
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  VC.ui = { e, $, $$, App, DEFAULT_MSGS, DEFAULT_TIENDA, toast, copyText, chip, banner, emptyState, waButton, WA_ICON, kpi, seg, shopStatusBanner, debounce, prefGet, prefSet, readFileText, storeFail };
})(window);
