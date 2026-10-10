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
      // Guarda el contenido con su ícono y lo devuelve después del aviso
      if (!btn.dataset.html) btn.dataset.html = btn.innerHTML;
      const original = btn.dataset.html;
      btn.innerHTML = (ok ? icon('check') + 'Copiado' : 'Seleccioná y copiá');
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => {
        btn.innerHTML = original;
        delete btn.dataset.html;
      }, 1600);
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

  function emptyState(title, body, actions, iconName) {
    return (
      '<div class="empty">' +
      (iconName ? bubble(iconName) : '') +
      '<h3>' +
      e(title) +
      '</h3>' +
      (body ? '<p>' + body + '</p>' : '') +
      (actions ? '<div class="row-actions">' + actions + '</div>' : '') +
      '</div>'
    );
  }

  /* ---------- Íconos (trazos de 24 px, estilo lineal) ---------- */
  const ICONS = {
    home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M15.5 15h2"/><path d="M6 6l9.5-3 1 3"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 13.8a6.5 6.5 0 0 1 3.5 6.2"/>',
    chart: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.4" height="7" rx="1"/><rect x="10.3" y="5.5" width="3.4" height="12.5" rx="1"/><rect x="15.6" y="13.5" width="3.4" height="4.5" rx="1"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    message: '<path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20l1.4-4.9a8 8 0 1 1 15.6-3.6z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>',
    video: '<rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="m15.5 10.3 6-3.3v10l-6-3.3"/>',
    tag: '<path d="M20.4 13.4 13.4 20.4a2 2 0 0 1-2.8 0L3.5 13.3V3.5h9.8l7.1 7.1a2 2 0 0 1 0 2.8z"/><circle cx="8" cy="8" r="1.6"/>',
    box: '<path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5"/><path d="M12 12v9"/>',
    sliders: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.4-4.4L4 8.5"/><path d="M4 3.5v5h5"/><path d="M4 13a8 8 0 0 0 14.4 4.4l1.6-1.9"/><path d="M20 20.5v-5h-5"/>',
    play: '<path d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
    sparkles: '<path d="M11 3.5 12.9 9l5.6 1.9-5.6 2L11 18.5 9.1 13 3.5 11l5.6-2z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6h.01"/>',
    chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
    chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.9 13h9.2l.9-13"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18.5 14v4.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5H10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    alert: '<path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>',
    zap: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z"/>',
    store: '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M3.5 9a2.8 2.8 0 0 0 5.7 0 2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.7 0"/><path d="M5 11.5V20h14v-8.5"/><path d="M10 20v-5h4v5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    upload: '<path d="M12 15.5V4"/><path d="m7 8.5 5-5 5 5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>',
    trending: '<path d="m3 16.5 6-6 4 4 8-8"/><path d="M15 6.5h6v6"/>',
    send: '<path d="M21 3 10.5 13.5"/><path d="M21 3 14.5 21l-4-7.5L3 9.5z"/>',
    gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8.5h14V12"/><path d="M12 8v12.5"/><path d="M12 8C10.5 4 7 4 7 6.3 7 8 12 8 12 8zM12 8c1.5-4 5-4 5-1.7C17 8 12 8 12 8z"/>',
    truck: '<path d="M2.5 6.5h11v10h-11z"/><path d="M13.5 10h4l3 3.5v3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  };

  function icon(name, cls) {
    const body = ICONS[name] || ICONS.info;
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  }

  function bubble(name, tone) {
    return '<span class="ico-bubble' + (tone ? ' tone-' + tone : '') + '">' + icon(name) + '</span>';
  }

  /* Encabezado de herramienta: título, una línea corta y acciones a la derecha */
  function pageHead(title, sub, actions) {
    return (
      '<header class="tool-head"><div><h2>' +
      e(title) +
      '</h2>' +
      (sub ? '<p class="lede">' + sub + '</p>' : '') +
      '</div>' +
      (actions ? '<div class="tool-actions">' + actions + '</div>' : '') +
      '</header>'
    );
  }

  /* Ayuda plegable: un "?" que muestra la explicación solo si la piden */
  function info(html, label) {
    return '<details class="info"><summary aria-label="' + e(label || 'Más información') + '">' + icon('info') + '</summary><div class="info-pop">' + html + '</div></details>';
  }

  /* "Más opciones" plegable */
  function more(label, html, id) {
    return '<details class="more"' + (id ? ' id="' + e(id) + '"' : '') + '><summary>' + icon('chevronRight') + e(label) + '</summary>' + html + '</details>';
  }

  /* Interruptor (checkbox con estilo). attrs: atributos extra para el input (data-*) */
  function toggle(id, checked, label, attrs) {
    return '<label class="switch" for="' + e(id) + '"><input type="checkbox" id="' + e(id) + '"' + (checked ? ' checked' : '') + (attrs ? ' ' + attrs : '') + '><span class="track"></span><span>' + e(label) + '</span></label>';
  }

  // Cierra las ayudas "?" abiertas al tocar afuera
  document.addEventListener('click', (ev) => {
    for (const d of document.querySelectorAll('details.info[open]')) if (!d.contains(ev.target)) d.open = false;
  });

  // Al abrir un "?", acomoda la explicación para que no se salga de la pantalla
  document.addEventListener(
    'toggle',
    (ev) => {
      const d = ev.target;
      if (!d || !d.classList || !d.classList.contains('info') || !d.open) return;
      const pop = d.querySelector('.info-pop');
      if (!pop) return;
      pop.style.left = '';
      pop.style.right = '';
      const r = pop.getBoundingClientRect();
      const margen = 12;
      const ancho = document.documentElement.clientWidth;
      let dx = 0;
      if (r.right > ancho - margen) dx = ancho - margen - r.right;
      if (r.left + dx < margen) dx = margen - r.left;
      if (dx) pop.style.left = (parseFloat(getComputedStyle(pop).left) || 0) + dx + 'px';
    },
    true
  );

  const WA_ICON =
    '<svg class="ico fill" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';

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
            (o.count != null ? ' <span class="seg-count' + (Number(o.count) === 0 ? ' is-zero' : '') + '">' + e(o.count) + '</span>' : '') +
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

  VC.ui = { icon, bubble, pageHead, info, more, toggle, ICONS, e, $, $$, App, DEFAULT_MSGS, DEFAULT_TIENDA, toast, copyText, chip, banner, emptyState, waButton, WA_ICON, kpi, seg, shopStatusBanner, debounce, prefGet, prefSet, readFileText, storeFail };
})(window);
