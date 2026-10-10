/* 5 · Generador de guiones UGC para Flow */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const S = VC.scripts;
  const A = VC.ads;
  const { Store, AI } = VC.runtime;
  const { e, $, App, chip, banner, toast, copyText, prefGet, prefSet, storeFail } = VC.ui;

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
  let el;
  let ctl;

  function mount(section) {
    el = section;
    el.innerHTML =
      '<header class="tool-head"><div><h2>Guiones UGC</h2><p class="lede">Elegí el ángulo y el personaje. Te devuelve guiones partidos en clips de 8 segundos, con la ficha de continuidad y el prompt listo para pegar en Flow.</p></div></header>' +
      '<form id="ugc-form" class="panel ugc-form"></form><div id="ugc-out"></div>';
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
    renderForm();
    renderOut();
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
    out.innerHTML =
      head +
      state.guiones
        .map(
          (g, gi) =>
            '<article class="script"><header class="script-head"><div><h4>' +
            e(g.titulo) +
            '</h4><div class="chips">' +
            (g.gancho ? chip(g.gancho, 'source') : '') +
            chip(g.clips.length * S.CLIP_SECONDS + ' s', 'neutral') +
            '</div>' +
            (g.nota ? '<p class="muted small">' + e(g.nota) + '</p>' : '') +
            '</div><button class="btn ghost" data-act="copiar-guion" data-g="' +
            gi +
            '">Copiar guion completo</button></header>' +
            '<div class="ficha"><div class="panel-head"><span class="eyebrow">Ficha de continuidad</span><button class="btn link" data-act="copiar-ficha" data-g="' +
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
                  '<div class="prompt-box"><div class="panel-head"><span class="eyebrow">Prompt para Flow</span><button class="btn link" data-act="copiar-prompt" data-g="' +
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
    const g = state.guiones[Number(t.dataset.g)];
    switch (t.dataset.act) {
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
        copyText(S.scriptAsText(g), t);
        break;
      case 'copiar-ficha':
        copyText(g.ficha, t);
        break;
      case 'copiar-prompt':
        copyText(g.clips[Number(t.dataset.c)].prompt, t);
        break;
    }
  }

  function onChange(ev) {
    const t = ev.target;
    if (!t.closest('#ugc-form')) return;
    readForm();
    if (t.name === 'angulo' || t.name === 'personaje') renderForm();
  }

  VC.tools = VC.tools || {};
  VC.tools.guiones = { mount, render: renderForm };
})(window);
