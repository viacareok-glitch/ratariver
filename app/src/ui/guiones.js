/* 5 · Generador de guiones UGC para Flow: tanda automática y "Elegirlo yo" */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const S = VC.scripts;
  const P = VC.autoplan;
  const { Store, AI } = VC.runtime;
  const { e, $, App, chip, toast, copyText, prefGet, prefSet, storeFail } = VC.ui;
  const A = VC.auto;

  const CADA = [24, 48, 72];

  const state = {
    opts: Object.assign(
      { angulo: 'dolor', anguloLibre: '', personaje: 'oficinista', personajeLibre: '', genero: 'f', clips: 4, cantidad: 3, idiomaPrompt: 'en', oferta: 'Pagás al recibir. Llevando 2 pagás $ 72.990 en total', extra: '' },
      prefGet('ugc-opts', {})
    ),
    guiones: [],
    origen: null,
    fecha: null,
    running: false,
    streamChars: 0,
    error: '',
  };
  // Tanda automática: último documento guardado, pasos en vivo y si el usuario la dejó en cola
  const auto = { doc: null, cargado: false, pasos: [], pedido: false };
  let abierta = prefGet('ugc-auto-abierta', true);
  let el;
  let ctl;

  function mount(section) {
    el = section;
    el.innerHTML =
      '<header class="tool-head"><div><h2>Guiones UGC</h2><p class="lede">Guiones partidos en clips de 8 segundos, con la ficha de continuidad y el prompt listo para pegar en Flow. Dejá que se escriban solos con lo que funciona, o elegí vos el ángulo y el personaje.</p></div></header>' +
      '<section class="panel auto-panel" id="ugc-auto" aria-labelledby="ugc-auto-title"></section><div id="ugc-auto-out"></div>' +
      '<section class="ugc-manual" aria-labelledby="ugc-manual-title"><div class="ugc-manual-head"><h3 id="ugc-manual-title">Elegirlo yo</h3><p class="muted small">Vos elegís ángulo, personaje, lugar, clips y cantidad. Funciona aparte de la tanda automática.</p></div>' +
      '<form id="ugc-form" class="panel ugc-form"></form><div id="ugc-out"></div></section>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('submit', (ev) => {
      ev.preventDefault();
      generate();
    });
    Store.get('guiones/ultimo').then((d) => {
      if (d && Array.isArray(d.guiones) && !state.guiones.length) {
        state.guiones = S.sanitize(d, d.opts || {});
        state.origen = d.origen;
        state.fecha = d.fecha;
        renderOut();
      }
    });
    App.on((w) => (w === 'analisis' || w === 'msgs') && renderForm());
    if (A) A.on(onAuto);
    if (!auto.cargado) cargarTanda();
    renderAuto();
    renderAutoOut();
    renderForm();
    renderOut();
  }

  function render() {
    renderAuto();
    renderForm();
  }

  /* ---------- Tanda automática: interfaz ---------- */

  function cfgAuto() {
    return Object.assign({}, A ? A.DEFAULTS.guiones : {}, A ? A.cfg.guiones : {});
  }

  function cadaTxt(h) {
    h = Number(h) || 24;
    if (h % 24) return h + ' h';
    return h === 24 ? '1 día' : h / 24 + ' días';
  }

  function renderAuto() {
    const box = el && $('#ugc-auto', el);
    if (!box) return;
    if (!box.dataset.ready) {
      box.innerHTML = '<div id="ugc-auto-head"></div><div id="ugc-auto-prog"></div><div id="ugc-auto-plan"></div><div id="ugc-auto-cfg"></div>';
      box.dataset.ready = '1';
    }
    renderAutoHead();
    renderAutoProg();
    renderAutoPlan();
    renderAutoCfg();
  }

  function renderAutoHead() {
    const box = el && $('#ugc-auto-head', el);
    if (!box) return;
    const c = cfgAuto();
    const corriendo = !!A && A.running === 'guiones';
    const otra = A && A.running && !corriendo ? A.NOMBRES[A.running] || A.running : '';
    const est = (A && A.estado.guiones) || {};
    const d = auto.doc;
    const meta = [
      d && d.fecha ? 'Última tanda: ' + U.timeAgo(d.fecha) + ', ' + P.motivoTexto(d.origen, d.motivo) : auto.cargado ? 'Todavía no hay tandas automáticas' : 'Buscando la última tanda…',
      c.auto ? 'Automático: al abrir el panel, cada ' + cadaTxt(c.cadaHoras) : 'Automático apagado',
    ];
    if (A && A.cfg.competencia && A.cfg.competencia.guionesTras) meta.push('También después de un escaneo de la competencia con anuncios nuevos');
    let accion = '';
    if (A && AI.sample) {
      accion = corriendo
        ? '<button type="button" class="btn ghost" data-act="tanda-detener">Detener</button>'
        : '<button type="button" class="btn" data-act="tanda-generar"' + (auto.pedido ? ' disabled' : '') + '>' + (auto.pedido ? 'En cola…' : 'Generar ahora') + '</button>';
    }
    let aviso = '';
    if (!AI.sample)
      aviso =
        '<div class="auto-off"><strong>Los guiones automáticos los escribe Claude.</strong> Abrí el panel desde claude.ai o la app de Claude para que se escriban solos. Mientras tanto, en “Elegirlo yo” podés armarlos con plantillas.</div>';
    let estado = '';
    if (otra) estado = '<p class="small muted">' + (auto.pedido ? 'En cola: la tanda arranca cuando termine la ' + e(otra) + '.' : 'Ahora está corriendo la ' + e(otra) + '. Si tocás “Generar ahora”, queda en cola.') + '</p>';
    else if (!corriendo && est.error) estado = '<p class="error-text">La última tanda no terminó: ' + e(est.error) + '</p>';
    box.innerHTML =
      '<div class="auto-head"><div class="ugc-auto-title"><h3 id="ugc-auto-title">Guiones automáticos</h3><div class="auto-meta">' +
      meta.map((m) => '<span>' + e(m) + '</span>').join('') +
      '</div></div>' +
      (accion ? '<div class="row-actions">' + accion + '</div>' : '') +
      '</div><p class="ugc-auto-lede">Cada tanda elige sola el ángulo (el ganador de tus anuncios o el que más dura en la competencia), rota el personaje y responde la duda que más se repite en tus comentarios.</p>' +
      aviso +
      estado;
  }

  const ST = {
    espera: ['en espera', ''],
    curso: ['en curso…', ''],
    ok: ['listo', 'ok'],
    error: ['error', 'err'],
  };

  function renderAutoProg() {
    const box = el && $('#ugc-auto-prog', el);
    if (!box) return;
    const corriendo = !!A && A.running === 'guiones';
    const est = (A && A.estado.guiones) || {};
    if (!auto.pasos.length || (!corriendo && !est.error)) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<ul class="auto-progress">' +
      auto.pasos
        .map((p) => {
          const st = ST[p.estado] || ST.espera;
          return '<li><span class="st' + (st[1] ? ' ' + st[1] : '') + '">' + e(st[0]) + '</span><span>' + e(p.label) + (p.det ? ' <span class="muted">· ' + e(p.det) + '</span>' : '') + '</span></li>';
        })
        .join('') +
      '</ul>';
  }

  function renderAutoPlan() {
    const box = el && $('#ugc-auto-plan', el);
    if (!box) return;
    const d = auto.doc;
    if (!d || !d.razones.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<div class="ugc-plan"><span class="eyebrow">Por qué la última tanda salió así</span><ul class="ugc-razones">' +
      d.razones.map((r) => '<li>' + e(r) + '</li>').join('') +
      '</ul>' +
      (d.opts && S.ANGULOS[d.opts.angulo] ? '<div class="row-actions"><button type="button" class="btn ghost" data-act="tanda-al-form">Pasar esta configuración al formulario</button></div>' : '') +
      '</div>';
  }

  function renderAutoCfg() {
    const box = el && $('#ugc-auto-cfg', el);
    if (!box || !A) return;
    const c = cfgAuto();
    const dis = A.loaded ? '' : ' disabled';
    const cada = CADA.includes(Number(c.cadaHoras)) ? CADA : CADA.concat(Number(c.cadaHoras) || 24).sort((a, b) => a - b);
    // Si el usuario está usando una opción, conservamos el foco al redibujar
    const act = document.activeElement;
    const keep = act && box.contains(act) && act.dataset ? act.dataset.cfg : '';
    box.innerHTML =
      '<div class="ugc-auto-cfg auto-toggles"><span class="ugc-auto-when"><label><input type="checkbox" data-cfg="auto"' +
      (c.auto ? ' checked' : '') +
      dis +
      '> Escribir guiones nuevos solos al abrir el panel</label><label>cada <select data-cfg="cadaHoras" aria-label="Cada cuántos días"' +
      dis +
      '>' +
      cada.map((h) => '<option value="' + h + '"' + (Number(c.cadaHoras) === h ? ' selected' : '') + '>' + e(cadaTxt(h)) + '</option>').join('') +
      '</select></label></span><label>Guiones por tanda <select data-cfg="cantidad"' +
      dis +
      '>' +
      [1, 2, 3, 4, 5].map((n) => '<option value="' + n + '"' + (Number(c.cantidad) === n ? ' selected' : '') + '>' + n + '</option>').join('') +
      '</select></label><label>Clips por guion <select data-cfg="clips"' +
      dis +
      '>' +
      [3, 4, 5, 6].map((n) => '<option value="' + n + '"' + (Number(c.clips) === n ? ' selected' : '') + '>' + n + ' clips · ' + n * S.CLIP_SECONDS + ' s</option>').join('') +
      '</select></label></div>';
    if (keep) {
      const opt = $('[data-cfg="' + keep + '"]', box);
      if (opt) opt.focus();
    }
  }

  function renderAutoOut() {
    const box = el && $('#ugc-auto-out', el);
    if (!box) return;
    const d = auto.doc;
    if (!d || !d.guiones.length) {
      box.innerHTML = '';
      return;
    }
    const o = d.opts || {};
    const n = d.guiones.length;
    const datos = [
      (S.ANGULOS[o.angulo] || {}).label,
      (S.PERSONAJES[o.personaje] || {}).label,
      o.clips ? o.clips + ' clips · ' + o.clips * S.CLIP_SECONDS + ' s' : '',
      d.fecha ? U.timeAgo(d.fecha) : '',
    ].filter(Boolean);
    box.innerHTML =
      '<details class="ugc-tanda"' +
      (abierta ? ' open' : '') +
      '><summary><span class="ugc-tanda-title">Tanda automática · ' +
      n +
      (n === 1 ? ' guion' : ' guiones') +
      '</span><span class="muted small">' +
      e(datos.join(' · ')) +
      '</span></summary><div class="ugc-tanda-body">' +
      scriptCards(d.guiones, 'auto-') +
      '</div></details>';
    const det = $('details', box);
    det.addEventListener('toggle', () => {
      abierta = det.open;
      prefSet('ugc-auto-abierta', abierta);
    });
  }

  // Lo guardado en 'guiones/auto' listo para mostrar (o null si no sirve)
  function limpiarTanda(d) {
    if (!d || !Array.isArray(d.guiones)) return null;
    return Object.assign({}, d, {
      guiones: S.sanitize(d, d.opts || {}),
      razones: Array.isArray(d.razones) ? d.razones.map(String) : [],
      opts: d.opts && typeof d.opts === 'object' ? d.opts : {},
    });
  }

  function mostrarTanda(d) {
    const t = limpiarTanda(d);
    // No pisamos una tanda más nueva con una lectura que llegó tarde
    if (t && auto.doc && String(auto.doc.fecha || '') > String(t.fecha || '')) return;
    if (t || !auto.doc) auto.doc = t;
    auto.cargado = true;
    if (!el) return;
    renderAutoHead();
    renderAutoPlan();
    renderAutoOut();
  }

  function cargarTanda() {
    return Store.get('guiones/auto').then(mostrarTanda, () => mostrarTanda(null));
  }

  function onAuto(ev) {
    if (!el) return;
    if (ev.type === 'cfg') {
      if (!ev.job || ev.job === 'guiones' || ev.job === 'competencia') renderAutoHead();
      if (!ev.job || ev.job === 'guiones') renderAutoCfg();
      return;
    }
    if (ev.job !== 'guiones') {
      if (ev.type === 'start' || ev.type === 'done' || ev.type === 'error') renderAutoHead();
      return;
    }
    if (ev.type === 'progress') {
      renderAutoProg();
      return;
    }
    if (ev.type === 'skip' && auto.pedido) toast(ev.motivo || 'No se pudo escribir la tanda acá.', 'warn');
    renderAutoHead();
    renderAutoProg();
    if (ev.type === 'done') {
      abierta = true;
      prefSet('ugc-auto-abierta', true);
    }
    if (ev.type === 'done' || ev.type === 'error') cargarTanda();
  }

  function generarAhora() {
    if (!A || auto.pedido || A.running === 'guiones') return;
    auto.pedido = true;
    renderAutoHead();
    A.run('guiones', { origen: 'manual' }).finally(() => {
      auto.pedido = false;
      renderAutoHead();
    });
  }

  // Copia la configuración de la última tanda al formulario de "Elegirlo yo"
  function pasarAlForm() {
    const o = auto.doc && auto.doc.opts;
    if (!o || !S.ANGULOS[o.angulo]) return;
    state.opts = Object.assign({}, state.opts, {
      angulo: o.angulo,
      personaje: S.PERSONAJES[o.personaje] ? o.personaje : state.opts.personaje,
      personajeLibre: '',
      genero: o.genero === 'm' ? 'm' : 'f',
      clips: U.clamp(Number(o.clips) || 4, 3, 6),
      cantidad: U.clamp(Number(o.cantidad) || 3, 1, 5),
      idiomaPrompt: o.idiomaPrompt === 'es' ? 'es' : 'en',
      oferta: o.oferta || state.opts.oferta,
      extra: o.extra || '',
    });
    prefSet('ugc-opts', state.opts);
    renderForm();
    const f = $('#ugc-form', el);
    if (f && f.scrollIntoView) f.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    toast('Listo: la configuración de la tanda quedó en “Elegirlo yo”. Cambiá lo que quieras y escribí.', 'good');
  }

  function renderForm() {
    const o = state.opts;
    const ganador = App.ultimoAnalisis && App.ultimoAnalisis.ganador;
    const angOpts = Object.entries(S.ANGULOS)
      .map(([k, a]) => '<label class="pill-radio' + (o.angulo === k ? ' is-on' : '') + '" for="ang-' + k + '"><input type="radio" name="angulo" id="ang-' + k + '" value="' + k + '"' + (o.angulo === k ? ' checked' : '') + '>' + e(a.label) + (ganador === k ? ' <span class="badge">ganador</span>' : '') + '</label>')
      .join('');
    const per = Object.entries(S.PERSONAJES)
      .map(([k, p]) => '<option value="' + k + '"' + (o.personaje === k ? ' selected' : '') + '>' + e(p.label) + '</option>')
      .join('');
    $('#ugc-form', el).innerHTML =
      (ganador && ganador !== o.angulo && S.ANGULOS[ganador]
        ? '<p class="note">Tu último análisis de creativos marcó <strong>' + e(S.ANGULOS[ganador].label) + '</strong> como ángulo ganador. <button type="button" class="btn link" data-act="usar-ganador" data-v="' + e(ganador) + '">Usarlo</button></p>'
        : '') +
      '<fieldset><legend>Ángulo</legend><div class="pill-row">' +
      angOpts +
      '<label class="pill-radio' +
      (o.angulo === 'libre' ? ' is-on' : '') +
      '" for="ang-libre"><input type="radio" name="angulo" id="ang-libre" value="libre"' +
      (o.angulo === 'libre' ? ' checked' : '') +
      '>Otro</label></div>' +
      (o.angulo === 'libre' ? '<label for="ugc-angulo-libre" class="sr-only">Describí el ángulo</label><input id="ugc-angulo-libre" name="anguloLibre" placeholder="Ej.: regalo para el Día de la Madre, choferes que manejan muchas horas…" value="' + e(o.anguloLibre) + '">' : '<p class="muted small">' + e((S.ANGULOS[o.angulo] || {}).brief || '') + '</p>') +
      '</fieldset>' +
      '<div class="form-grid"><label for="ugc-personaje">Personaje y lugar<select id="ugc-personaje" name="personaje">' +
      per +
      '<option value="libre"' +
      (o.personaje === 'libre' ? ' selected' : '') +
      '>Otro (lo describo)</option></select></label>' +
      '<label for="ugc-clips">Clips por guion<select id="ugc-clips" name="clips">' +
      [3, 4, 5, 6].map((n) => '<option value="' + n + '"' + (Number(o.clips) === n ? ' selected' : '') + '>' + n + ' clips · ' + n * S.CLIP_SECONDS + ' s</option>').join('') +
      '</select></label><label for="ugc-cantidad">Cantidad de guiones<select id="ugc-cantidad" name="cantidad">' +
      [1, 2, 3, 4, 5].map((n) => '<option value="' + n + '"' + (Number(o.cantidad) === n ? ' selected' : '') + '>' + n + '</option>').join('') +
      '</select></label><label for="ugc-idioma">Idioma del prompt<select id="ugc-idioma" name="idiomaPrompt"><option value="en"' +
      (o.idiomaPrompt === 'en' ? ' selected' : '') +
      '>Inglés (mejor en Flow)</option><option value="es"' +
      (o.idiomaPrompt === 'es' ? ' selected' : '') +
      '>Español</option></select></label></div>' +
      (o.personaje === 'libre'
        ? '<div class="form-grid wide"><label for="ugc-personaje-libre">Describí personaje, ropa y lugar<textarea id="ugc-personaje-libre" name="personajeLibre" rows="2" placeholder="Ej.: Hombre de 50, camionero, remera azul, cabina de camión, luz de mediodía">' +
          e(o.personajeLibre) +
          '</textarea></label><label for="ugc-genero">Habla como<select id="ugc-genero" name="genero"><option value="f"' +
          (o.genero === 'f' ? ' selected' : '') +
          '>Mujer</option><option value="m"' +
          (o.genero === 'm' ? ' selected' : '') +
          '>Hombre</option></select></label></div>'
        : '<p class="muted small">' + e((S.PERSONAJES[o.personaje] || S.PERSONAJES.oficinista).es) + '</p>') +
      '<label for="ugc-oferta">Oferta y cierre<input id="ugc-oferta" name="oferta" value="' +
      e(o.oferta) +
      '"></label><label for="ugc-extra">Pedido extra (opcional)<input id="ugc-extra" name="extra" placeholder="Ej.: que el gancho sea una pregunta, que aparezca la caja del producto…" value="' +
      e(o.extra) +
      '"></label>' +
      '<p class="muted small">Producto: ' +
      e(App.msgs.productoGuiones || S.PRODUCTO_DEFAULT) +
      ' <button type="button" class="btn link" data-goto="ajustes">Cambiar</button></p>' +
      '<div class="row-actions">' +
      (state.running
        ? '<button type="button" class="btn ghost" data-act="detener">Detener</button><span class="muted">' + (state.streamChars ? 'Escribiendo… ' + U.int(state.streamChars) + ' caracteres' : 'Pensando los guiones… puede tardar hasta un minuto.') + '</span>'
        : (AI.sample ? '<button type="submit" class="btn">Escribir guiones con Claude</button>' : '') + '<button type="button" class="btn ghost" data-act="plantillas">' + (AI.sample ? 'Usar plantillas (sin IA)' : 'Generar con plantillas') + '</button>') +
      '</div>' +
      (state.error ? '<p class="error-text">' + e(state.error) + '</p>' : '') +
      (!AI.sample ? '<p class="muted small">Abrí el panel desde claude.ai para que Claude escriba guiones a medida. Mientras tanto, las plantillas arman guiones básicos.</p>' : '');
  }

  function readForm() {
    const f = $('#ugc-form', el);
    const fd = new FormData(f);
    const o = Object.assign({}, state.opts);
    for (const k of ['angulo', 'anguloLibre', 'personaje', 'personajeLibre', 'genero', 'clips', 'cantidad', 'idiomaPrompt', 'oferta', 'extra']) {
      if (fd.has(k)) o[k] = String(fd.get(k));
    }
    o.clips = Number(o.clips);
    o.cantidad = Number(o.cantidad);
    state.opts = o;
    prefSet('ugc-opts', o);
    return o;
  }

  function fullOpts() {
    const o = Object.assign({}, state.opts, { producto: App.msgs.productoGuiones || S.PRODUCTO_DEFAULT });
    if (o.angulo === 'libre') o.angulo = o.anguloLibre || 'ángulo libre';
    if (o.personaje !== 'libre') o.personajeLibre = '';
    return o;
  }

  async function generate() {
    readForm();
    const opts = fullOpts();
    if (state.opts.angulo === 'libre' && !state.opts.anguloLibre.trim()) {
      toast('Describí el ángulo que querés probar.', 'warn');
      return;
    }
    if (state.opts.personaje === 'libre' && !state.opts.personajeLibre.trim()) {
      toast('Describí el personaje y el lugar.', 'warn');
      return;
    }
    ctl = new AbortController();
    state.running = true;
    state.streamChars = 0;
    state.error = '';
    renderForm();
    try {
      const data = await AI.sample.json(S.buildPrompt(opts), {
        signal: ctl.signal,
        cache: false,
        onText: ({ text }) => {
          state.streamChars = text.length;
          const m = el.querySelector('#ugc-form .row-actions .muted');
          if (m) m.textContent = 'Escribiendo… ' + U.int(text.length) + ' caracteres';
        },
      });
      const list = S.sanitize(data, opts);
      if (!list.length) throw { code: 'invalid_json' };
      setResult(list, 'claude', opts);
    } catch (err) {
      if (err && err.code !== 'cancelled') state.error = AI.errorText(err);
      if (AI.permanent(err)) AI.sample = null;
    }
    state.running = false;
    renderForm();
  }

  function setResult(list, origen, opts) {
    state.guiones = list;
    state.origen = origen;
    state.fecha = new Date().toISOString();
    renderOut();
    const doc = { guiones: list, origen, fecha: state.fecha, opts: { angulo: opts.angulo, clips: opts.clips, cantidad: opts.cantidad } };
    Store.set('guiones/ultimo', JSON.parse(JSON.stringify(doc))).catch(storeFail);
    const out = $('#ugc-out', el);
    if (out && out.scrollIntoView) out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function renderOut() {
    const out = $('#ugc-out', el);
    if (!state.guiones.length) {
      out.innerHTML =
        '<section class="panel tips"><h3>Cómo usarlos en Flow</h3><ol class="steps"><li>Pegá el prompt del clip 1 y generá 2 o 3 tomas. Elegí la que tenga mejor cara y voz: esa define el personaje.</li><li>Para el clip 2 usá <strong>Extend</strong> sobre esa toma, o tomá su último cuadro como imagen inicial (<strong>Frames to Video</strong>), y pegá el prompt del clip 2.</li><li>Repetí clip por clip. La ficha de continuidad va completa en cada prompt para que no cambie la ropa ni el lugar.</li><li>Al subir a TikTok, activá la etiqueta de contenido generado con IA.</li></ol></section>';
      return;
    }
    const head =
      '<div class="out-head"><h3>' +
      state.guiones.length +
      (state.guiones.length === 1 ? ' guion' : ' guiones') +
      '</h3><span class="muted small">' +
      (state.origen === 'claude' ? 'Escritos por Claude' : 'Armados con plantillas') +
      (state.fecha ? ' · ' + e(U.timeAgo(state.fecha)) : '') +
      '</span></div>';
    out.innerHTML = head + scriptCards(state.guiones, '');
  }

  /*
   * Tarjetas de guion (ficha, clips, prompts y botones de copiar). `pre` va adelante de cada data-act para que los
   * botones de la tanda automática ('auto-') y los del formulario ('') no se pisen.
   */
  function scriptCards(list, pre) {
    return list
      .map(
        (g, gi) =>
          '<article class="script"><header class="script-head"><div><h4>' +
          e(g.titulo) +
          '</h4><div class="chips">' +
          (g.gancho ? chip(g.gancho, 'source') : '') +
          chip(g.clips.length * S.CLIP_SECONDS + ' s', 'neutral') +
          '</div>' +
          (g.nota ? '<p class="muted small">' + e(g.nota) + '</p>' : '') +
          '</div><button class="btn ghost" data-act="' +
          pre +
          'copiar-guion" data-g="' +
          gi +
          '">Copiar guion completo</button></header>' +
          '<div class="ficha"><div class="panel-head"><span class="eyebrow">Ficha de continuidad</span><button class="btn link" data-act="' +
          pre +
          'copiar-ficha" data-g="' +
          gi +
          '">Copiar</button></div><p class="selectable">' +
          e(g.ficha) +
          '</p></div><ol class="clips">' +
          g.clips
            .map(
              (c, ci) =>
                '<li class="clip"><div class="clip-time mono">' +
                c.desde +
                '–' +
                c.hasta +
                ' s</div><div class="clip-body"><div class="clip-meta"><strong>Clip ' +
                c.n +
                '</strong> · ' +
                e(c.plano) +
                '</div><p class="clip-action">' +
                e(c.accion) +
                '</p><p class="clip-dialog">“' +
                e(c.dialogo) +
                '” <span class="' +
                (c.largo ? 'warn-text' : 'muted') +
                ' small">' +
                c.palabras +
                ' palabras' +
                (c.largo ? ' · puede no entrar en 8 s' : '') +
                '</span></p>' +
                (c.texto_pantalla ? '<p class="small"><span class="eyebrow">Texto en pantalla</span> ' + e(c.texto_pantalla) + '</p>' : '') +
                '<div class="prompt-box"><div class="panel-head"><span class="eyebrow">Prompt para Flow</span><button class="btn link" data-act="' +
                pre +
                'copiar-prompt" data-g="' +
                gi +
                '" data-c="' +
                ci +
                '">Copiar prompt</button></div><pre class="selectable">' +
                e(c.prompt) +
                '</pre></div>' +
                (c.continuidad ? '<p class="small continuity"><span class="eyebrow">Empalme</span> ' + e(c.continuidad) + '</p>' : '') +
                '</div></li>'
            )
            .join('') +
          '</ol>' +
          (g.caption ? '<p class="small"><span class="eyebrow">Caption</span> <span class="selectable">' + e(g.caption) + '</span></p>' : '') +
          '</article>'
      )
      .join('');
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    let act = t.dataset.act;
    let lista = state.guiones;
    if (act.startsWith('auto-')) {
      act = act.slice(5);
      lista = (auto.doc && auto.doc.guiones) || [];
    }
    const g = lista[Number(t.dataset.g)];
    switch (act) {
      case 'plantillas': {
        readForm();
        const opts = fullOpts();
        if (!S.ANGULOS[state.opts.angulo]) toast('Las plantillas solo tienen los 4 ángulos base. Uso “Dolor”.', 'warn');
        setResult(S.fallbackScripts(opts), 'plantillas', opts);
        break;
      }
      case 'detener':
        if (ctl) ctl.abort();
        break;
      case 'usar-ganador':
        state.opts.angulo = t.dataset.v;
        prefSet('ugc-opts', state.opts);
        renderForm();
        break;
      case 'copiar-guion':
        if (g) copyText(S.scriptAsText(g), t);
        break;
      case 'copiar-ficha':
        if (g) copyText(g.ficha, t);
        break;
      case 'copiar-prompt': {
        const c = g && g.clips[Number(t.dataset.c)];
        if (c) copyText(c.prompt, t);
        break;
      }
      case 'tanda-generar':
        generarAhora();
        break;
      case 'tanda-detener':
        if (A && A.running === 'guiones') A.stop();
        break;
      case 'tanda-al-form':
        pasarAlForm();
        break;
    }
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.dataset && t.dataset.cfg && A && t.closest('#ugc-auto-cfg')) {
      const k = t.dataset.cfg;
      A.setCfg('guiones', { [k]: k === 'auto' ? t.checked : Number(t.value) });
      return;
    }
    if (!t.closest('#ugc-form')) return;
    readForm();
    if (t.name === 'angulo' || t.name === 'personaje') renderForm();
  }

  /* ---------- Tanda automática: la tarea ---------- */

  function cortarSiCancelo(ctx) {
    if (ctx.signal.aborted) throw { code: 'cancelled' };
  }

  function refrescarProg() {
    if (el) renderAutoProg();
  }

  async function guardar(path, data) {
    try {
      await Store.set(path, data);
    } catch (err) {
      const code = err && err.code;
      throw new Error(
        code === 'invalid_argument'
          ? 'No tenés permiso para guardar cambios en este panel.'
          : code === 'quota_exceeded'
            ? 'Se llenó el espacio del panel. Borrá datos viejos para seguir guardando.'
            : 'No se pudieron guardar los guiones. Revisá la conexión y probá de nuevo.'
      );
    }
  }

  /*
   * Escribe una tanda de guiones con lo que ya sabe el panel: último reporte de anuncios, anuncios de la competencia,
   * dudas de los comentarios y las tandas anteriores. Funciona aunque la pestaña no esté abierta.
   */
  async function escribirTanda(ctx) {
    if (!AI.sample) throw new Error('Claude no está disponible en esta vista.');
    const pasos = [
      { label: 'Juntar tu último reporte de anuncios, la competencia y los comentarios', estado: 'curso', det: '' },
      { label: 'Escribir los guiones con Claude', estado: 'espera', det: '' },
      { label: 'Guardar la tanda', estado: 'espera', det: '' },
    ];
    auto.pasos = pasos;
    let i = 0;
    const avanzar = (det) => {
      pasos[i].estado = 'ok';
      if (det != null) pasos[i].det = det;
      i++;
      if (pasos[i]) pasos[i].estado = 'curso';
      refrescarProg();
    };
    refrescarProg();
    try {
      ctx.progress('Juntando datos…');
      const [analisis, comp, escaneo, resp, prev] = await Promise.all([
        App.ultimoAnalisis ? Promise.resolve(App.ultimoAnalisis) : Store.get('creativos/ultimo'),
        Store.list('competencia'),
        Store.get('escaneos/ultimo'),
        Store.list('respuestas'),
        Store.get('guiones/auto'),
      ]);
      cortarSiCancelo(ctx);
      const c = cfgAuto();
      const pref = prefGet('ugc-opts', {}) || {};
      const p = P.plan({
        ultimoAnalisis: analisis,
        competencia: { ads: [...comp.values()], escaneo },
        objeciones: P.objeciones(resp),
        historial: (prev && prev.historial) || [],
        tienda: App.tienda,
        cfg: { cantidad: c.cantidad, clips: c.clips },
        idioma: pref.idiomaPrompt === 'es' ? 'es' : 'en',
        hoy: U.todayKeyAR(),
      });
      const o = p.opts;
      const angulo = (S.ANGULOS[o.angulo] || {}).label || o.angulo;
      avanzar('Ángulo ' + angulo + ' · ' + ((S.PERSONAJES[o.personaje] || {}).label || o.personaje));
      pasos[1].label = 'Escribir ' + o.cantidad + (o.cantidad === 1 ? ' guion' : ' guiones') + ' de ' + o.clips + ' clips con Claude';
      refrescarProg();

      ctx.progress('Escribiendo ' + (o.cantidad === 1 ? 'el guion' : o.cantidad + ' guiones') + ' (ángulo ' + angulo + ')…');
      const opts = Object.assign({}, o, { producto: App.msgs.productoGuiones || S.PRODUCTO_DEFAULT });
      let aviso = 0;
      let data;
      try {
        data = await AI.sample.json(S.buildPrompt(opts), {
          signal: ctx.signal,
          cache: false,
          onText: ({ text }) => {
            // De a ratos: cada aviso redibuja el panel y la barra de arriba
            if (Date.now() - aviso < 800) return;
            aviso = Date.now();
            pasos[1].det = 'Escribiendo… ' + U.int(text.length) + ' caracteres';
            ctx.progress('Escribiendo guiones… ' + U.int(text.length) + ' caracteres');
          },
        });
      } catch (err) {
        if ((err && err.code === 'cancelled') || ctx.signal.aborted) throw err;
        if (AI.permanent(err)) {
          AI.sample = null;
          if (el) renderAutoHead();
        }
        throw new Error(AI.errorText(err));
      }
      cortarSiCancelo(ctx);
      const list = S.sanitize(data, opts);
      if (!list.length) throw new Error('Claude no devolvió guiones que se puedan usar. Probá de nuevo o bajá la cantidad de guiones por tanda.');
      avanzar(list.length + (list.length === 1 ? ' guion' : ' guiones'));

      ctx.progress('Guardando la tanda…');
      const fecha = new Date().toISOString();
      const doc = P.armarDoc({
        fecha,
        origen: ctx.origen,
        motivo: ctx.motivo,
        razones: p.razones,
        opts: o,
        guiones: list,
        historial: P.sumarHistorial(prev && prev.historial, { fecha, angulo: o.angulo, personaje: o.personaje }),
      });
      await guardar('guiones/auto', JSON.parse(JSON.stringify(doc)));
      avanzar();
      mostrarTanda(doc);
      const n = doc.guiones.length;
      return { novedades: n, guiones: n, angulo: o.angulo, resumen: P.resumen(n, o.angulo) };
    } catch (err) {
      if (pasos[i]) {
        pasos[i].estado = 'error';
        pasos[i].det = (err && err.code === 'cancelled') || ctx.signal.aborted ? 'Cancelado' : (err && err.message) || 'Error inesperado';
      }
      refrescarProg();
      throw err;
    }
  }

  if (A) A.register('guiones', { needs: ['sample'], run: escribirTanda });

  VC.tools = VC.tools || {};
  VC.tools.guiones = { mount, render };
})(window);
