/* Espía de anuncios de la competencia */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const CP = VC.competitors;
  const { Store, AI } = VC.runtime;
  const { e, $, App, chip, emptyState, toast, copyText, storeFail } = VC.ui;

  const state = {
    ads: new Map(),
    texto: '',
    imagenes: [],
    imgLimits: null,
    running: false,
    error: '',
    ideas: { text: '', fecha: null, running: false, error: '' },
  };
  let el;
  let ctl;

  function mount(section) {
    el = section;
    el.innerHTML =
      '<header class="tool-head"><div><h2>Anuncios de la competencia</h2><p class="lede">Buscá en la Biblioteca de anuncios de Meta los correctores que llevan semanas activos: si siguen pautando, les funciona. Pegá o capturá lo que ves y te resume ganchos, ángulos y ofertas.</p></div></header>' +
      '<section class="panel" id="cp-links"></section><section class="panel" id="cp-input"></section><div id="cp-summary"></div><section class="panel" id="cp-ideas"></section><section class="panel" id="cp-table"></section>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', (ev) => {
      if (ev.target.id === 'cp-texto') state.texto = ev.target.value;
    });
    el.addEventListener('submit', onSubmit);
    el.addEventListener('paste', onPaste);
    Store.watch('competencia', (m) => {
      state.ads = m;
      renderData();
    });
    Store.get('ideas/competencia').then((d) => {
      if (d && d.text && !state.ideas.text) {
        state.ideas.text = d.text;
        state.ideas.fecha = d.fecha;
        renderIdeas();
      }
    });
    if (AI.sample && AI.sample.limits) AI.sample.limits().then((l) => ((state.imgLimits = l && l.images ? l.images : null), renderInput())).catch(() => {});
    renderLinks();
    renderInput();
    renderData();
  }

  function render() {
    renderInput();
    renderData();
  }

  function renderLinks() {
    $('#cp-links', el).innerHTML =
      '<h3>1. Buscá en la Biblioteca de anuncios</h3><p class="muted small">Se abre filtrada por Argentina y anuncios activos. Mirá la fecha “Comenzó a circular el…”: los que llevan ' +
      CP.GANADOR_DIAS +
      ' días o más son los que les rinden.</p><div class="row-actions">' +
      CP.BUSQUEDAS.map((q) => '<a class="btn ghost" href="' + e(CP.adLibraryUrl(q)) + '" target="_blank" rel="noopener">' + e(q) + '</a>').join('') +
      '<a class="btn ghost" href="' +
      e(CP.tiktokTopAdsUrl()) +
      '" target="_blank" rel="noopener">TikTok Creative Center</a></div>';
  }

  function renderInput() {
    const box = $('#cp-input', el);
    if (!box) return;
    const canImg = !!state.imgLimits;
    box.innerHTML =
      '<h3>2. Traé lo que encontraste</h3>' +
      (AI.sample
        ? '<p class="muted small">En la página de resultados seleccioná todo (Ctrl+A o Cmd+A), copiá y pegalo acá. ' +
          (canImg ? 'También podés pegar o subir capturas de pantalla (hasta ' + state.imgLimits.maxCount + ').' : '') +
          '</p><label for="cp-texto" class="sr-only">Texto copiado de la Biblioteca de anuncios</label><textarea id="cp-texto" rows="6" placeholder="Pegá acá el texto de la Biblioteca de anuncios…">' +
          e(state.texto) +
          '</textarea>' +
          (canImg
            ? '<div class="row-actions"><label class="btn ghost file-btn">Subir capturas<input type="file" id="cp-imgs" accept="' +
              e(state.imgLimits.mediaTypes.join(',')) +
              '" multiple hidden></label>' +
              (state.imagenes.length ? '<span class="muted small">' + state.imagenes.length + ' captura(s) lista(s)</span><button class="btn link" data-act="quitar-imgs">Quitar</button>' : '') +
              '</div>'
            : '') +
          '<div class="row-actions">' +
          (state.running
            ? '<button class="btn ghost" data-act="detener">Detener</button><span class="muted">Leyendo los anuncios… puede tardar un minuto.</span>'
            : '<button class="btn" data-act="extraer">Extraer anuncios</button>') +
          '</div>' +
          (state.error ? '<p class="error-text">' + e(state.error) + '</p>' : '')
        : '<p class="muted small">Abrí el panel desde claude.ai para que Claude lea el texto o las capturas. Mientras tanto, cargalos a mano.</p>') +
      '<details class="manual"><summary>Cargar un anuncio a mano</summary><form id="cp-form" class="review-form"><div class="form-grid">' +
      inp('anunciante', 'Anunciante') +
      inp('desde', 'Activo desde', 'date') +
      '<label for="cp-f-angulo">Ángulo<select id="cp-f-angulo" name="angulo">' +
      Object.entries(CP.ANGULOS)
        .map(([k, v]) => '<option value="' + k + '">' + e(v) + '</option>')
        .join('') +
      '</select></label>' +
      inp('oferta', 'Oferta') +
      inp('precio', 'Precio') +
      '<label for="cp-f-formato">Formato<select id="cp-f-formato" name="formato"><option>video</option><option>imagen</option><option>carrusel</option></select></label></div>' +
      '<label for="cp-f-gancho">Gancho (primera frase)<input id="cp-f-gancho" name="gancho" required></label><label for="cp-f-nota">Nota<input id="cp-f-nota" name="nota"></label><div class="row-actions"><button class="btn" type="submit">Guardar anuncio</button></div></form></details>';
  }

  function inp(k, label, type) {
    return '<label for="cp-f-' + k + '">' + e(label) + '<input id="cp-f-' + k + '" name="' + k + '"' + (type ? ' type="' + type + '"' : '') + '></label>';
  }

  function adsList() {
    return [...state.ads.entries()].map(([id, a]) => Object.assign({ id }, a));
  }

  function renderData() {
    const s = CP.summarize(adsList());
    const sum = $('#cp-summary', el);
    const table = $('#cp-table', el);
    if (!s.total) {
      sum.innerHTML = '';
      $('#cp-ideas', el).hidden = true;
      table.innerHTML = '<h3>Anuncios guardados</h3>' + emptyState('Todavía no hay anuncios', 'Buscá en la Biblioteca, pegá lo que encontraste y tocá “Extraer anuncios”. Quedan guardados acá para comparar.');
      return;
    }
    $('#cp-ideas', el).hidden = false;
    const top = (arr) => arr.slice(0, 4).map(([k, n]) => chip((CP.ANGULOS[k] || k) + ' · ' + n, 'source')).join('');
    sum.innerHTML =
      '<div class="summary-strip">' +
      stat(s.total, 'anuncios guardados') +
      stat(s.anunciantes, 'anunciantes') +
      stat(s.ganadores, 'activos hace ' + CP.GANADOR_DIAS + '+ días', s.ganadores ? 'good' : '') +
      '</div><div class="panel"><div class="kv"><span class="eyebrow">Ángulos</span><div class="chips">' +
      (top(s.angulos) || '<span class="muted small">—</span>') +
      '</div></div><div class="kv"><span class="eyebrow">Ofertas</span><div class="chips">' +
      (s.ofertas.length ? s.ofertas.slice(0, 6).map(([k, n]) => chip(k + ' · ' + n, 'neutral')).join('') : '<span class="muted small">—</span>') +
      '</div></div></div>';
    table.innerHTML =
      '<div class="panel-head"><h3>Anuncios guardados</h3><button class="btn link" data-act="borrar-todo">Borrar todos</button></div><div class="table-wrap"><table class="table comp"><thead><tr><th>Anunciante</th><th class="num">Días</th><th>Ángulo</th><th>Oferta</th><th class="num">Precio</th><th>Gancho</th><th></th></tr></thead><tbody>' +
      s.ads
        .map(
          (a) =>
            '<tr><th scope="row">' +
            e(a.anunciante || '—') +
            '<div class="muted small">' +
            e(a.formato || '') +
            '</div></th><td class="num">' +
            (a.dias != null ? chip(a.dias + ' d', a.dias >= CP.GANADOR_DIAS ? 'good' : 'neutral') : '—') +
            '</td><td>' +
            e(CP.ANGULOS[a.angulo] || a.angulo || '') +
            '</td><td>' +
            e(a.oferta || '—') +
            '</td><td class="num">' +
            (a.precio ? e(U.money(a.precio)) : '—') +
            '</td><td class="hook-cell">“' +
            e(a.gancho) +
            '”' +
            (a.nota ? '<div class="muted small">' + e(a.nota) + '</div>' : '') +
            '</td><td><button class="btn link" data-act="borrar" data-id="' +
            e(a.id) +
            '" aria-label="Borrar anuncio de ' +
            e(a.anunciante || '') +
            '">Borrar</button></td></tr>'
        )
        .join('') +
      '</tbody></table></div>';
    renderIdeas();
  }

  function stat(v, label, tone) {
    return '<div class="stat' + (tone ? ' tone-' + tone : '') + '"><span class="stat-value">' + e(v) + '</span><span class="stat-label">' + e(label) + '</span></div>';
  }

  function renderIdeas() {
    const box = $('#cp-ideas', el);
    if (!box || box.hidden) return;
    const I = state.ideas;
    box.innerHTML =
      '<div class="panel-head"><h3>Qué aprender y qué probar</h3>' +
      (AI.sample
        ? '<div class="row-actions">' +
          (I.running ? '<button class="btn ghost" data-act="ideas-stop">Detener</button>' : '<button class="btn" data-act="ideas">' + (I.text ? 'Actualizar' : 'Pedir resumen e ideas') + '</button>') +
          (I.text && !I.running ? '<button class="btn ghost" data-act="ideas-copiar">Copiar</button>' : '') +
          '</div>'
        : '') +
      '</div>' +
      (I.text || I.running
        ? '<div class="ia-out' + (I.running && !I.text ? ' is-thinking' : '') + '">' + (I.text ? e(I.text) : 'Pensando…') + '</div>' + (I.fecha && !I.running ? '<p class="muted small">Generado ' + e(U.timeAgo(I.fecha)) + '</p>' : '')
        : '<p class="muted">' + (AI.sample ? 'Claude compara los anuncios guardados y te propone 5 creativos para ViaCare.' : 'Abrí el panel desde claude.ai para pedir el resumen.') + '</p>') +
      (I.error ? '<p class="error-text">' + e(I.error) + '</p>' : '');
  }

  async function extraer() {
    const texto = ($('#cp-texto', el) || {}).value || '';
    if (!texto.trim() && !state.imagenes.length) {
      toast('Pegá el texto de la Biblioteca o subí capturas.', 'warn');
      return;
    }
    ctl = new AbortController();
    state.running = true;
    state.error = '';
    renderInput();
    try {
      const opts = { signal: ctl.signal, cache: false };
      if (state.imagenes.length) opts.images = state.imagenes;
      const data = await AI.sample.json(CP.extractPrompt(texto, state.imagenes.length, U.todayKeyAR()), opts);
      const ads = CP.sanitizeAds(data);
      if (!ads.length) state.error = 'No encontramos anuncios en lo que pegaste. Copiá la página de resultados completa o subí capturas.';
      else {
        const existentes = adsList().map((a) => (a.anunciante + '|' + a.gancho).toLowerCase());
        let nuevos = 0;
        for (const a of ads) {
          if (existentes.includes((a.anunciante + '|' + a.gancho).toLowerCase())) continue;
          const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          a.cargado = new Date().toISOString();
          state.ads.set(id, a);
          nuevos++;
          await Store.set('competencia/' + id, a).catch(storeFail);
        }
        toast(nuevos + ' anuncio(s) nuevo(s) guardado(s).', 'good');
        state.texto = '';
        state.imagenes = [];
      }
    } catch (err) {
      if (err && err.code !== 'cancelled') state.error = err.code === 'images_unavailable' || err.code === 'image_rejected' ? 'No se pudieron enviar las capturas. Probá con otras o pegá el texto.' : AI.errorText(err);
      if (AI.permanent(err)) AI.sample = null;
    }
    state.running = false;
    renderInput();
    renderData();
  }

  async function ideas() {
    ctl = new AbortController();
    state.ideas = { text: '', fecha: null, running: true, error: '' };
    renderIdeas();
    try {
      const s = CP.summarize(adsList());
      const res = await AI.sample(CP.insightPrompt(s.ads, U.todayKeyAR(), App.datos()), {
        signal: ctl.signal,
        cache: false,
        onText: ({ text }) => {
          state.ideas.text = text;
          const out = el.querySelector('#cp-ideas .ia-out');
          if (out) {
            out.classList.remove('is-thinking');
            out.textContent = text;
          }
        },
      });
      state.ideas.text = res.text;
      state.ideas.fecha = new Date().toISOString();
      Store.set('ideas/competencia', { text: res.text, fecha: state.ideas.fecha }).catch(storeFail);
    } catch (err) {
      state.ideas.text = err.text || '';
      if (err.code !== 'cancelled') state.ideas.error = AI.errorText(err);
    }
    state.ideas.running = false;
    renderIdeas();
  }

  function addImages(files) {
    const lim = state.imgLimits;
    if (!lim) return;
    const ok = [...files].filter((f) => lim.mediaTypes.includes(f.type) && f.size <= lim.maxInputBytes);
    state.imagenes = state.imagenes.concat(ok).slice(0, lim.maxCount);
    if (ok.length < files.length) toast('Algunas imágenes no se pudieron usar (tipo o tamaño).', 'warn');
    renderInput();
  }

  function onPaste(ev) {
    if (!state.imgLimits || !ev.clipboardData) return;
    const files = [...ev.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      ev.preventDefault();
      addImages(files);
    }
  }

  function onChange(ev) {
    if (ev.target.id === 'cp-imgs' && ev.target.files) addImages(ev.target.files);
  }

  function onSubmit(ev) {
    const f = ev.target.closest('#cp-form');
    if (!f) return;
    ev.preventDefault();
    const fd = new FormData(f);
    const a = CP.sanitizeAds([Object.fromEntries(fd.entries())])[0];
    if (!a) {
      toast('Escribí al menos el gancho.', 'warn');
      return;
    }
    a.cargado = new Date().toISOString();
    const id = 'a' + Date.now().toString(36);
    state.ads.set(id, a);
    Store.set('competencia/' + id, a).catch(storeFail);
    f.reset();
    renderData();
    toast('Anuncio guardado.', 'good');
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    switch (t.dataset.act) {
      case 'extraer':
        extraer();
        break;
      case 'detener':
      case 'ideas-stop':
        if (ctl) ctl.abort();
        break;
      case 'quitar-imgs':
        state.imagenes = [];
        renderInput();
        break;
      case 'ideas':
        ideas();
        break;
      case 'ideas-copiar':
        copyText(state.ideas.text, t);
        break;
      case 'borrar':
        state.ads.delete(t.dataset.id);
        Store.remove('competencia/' + t.dataset.id).catch(storeFail);
        renderData();
        break;
      case 'borrar-todo':
        if (t.dataset.confirm !== '1') {
          t.dataset.confirm = '1';
          t.textContent = 'Tocá de nuevo para borrar todo';
          setTimeout(() => {
            t.dataset.confirm = '';
            t.textContent = 'Borrar todos';
          }, 4000);
          return;
        }
        for (const id of [...state.ads.keys()]) Store.remove('competencia/' + id).catch(storeFail);
        state.ads = new Map();
        renderData();
        break;
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.competencia = { mount, render };
})(window);
