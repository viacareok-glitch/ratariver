/* Respuestas para comentarios de TikTok */
(function (root) {
  'use strict';
  const VC = root.VC;
  const CM = VC.comments;
  const { Store, AI } = VC.runtime;
  const { e, $, App, chip, toast, copyText, storeFail, icon, bubble, pageHead, info, more } = VC.ui;

  const state = {
    texto: '',
    items: [], // {comentario, tipo, respuesta, variante, video, ocultar, origen}
    running: false,
    error: '',
    biblioteca: new Map(),
    tono: '',
  };
  let el;
  let ctl;

  function mount(section) {
    el = section;
    el.innerHTML =
      pageHead('Comentarios', 'Pegá los comentarios y te armo una respuesta para cada uno.') +
      '<div id="cm-warn"></div><section class="panel" id="cm-input"></section><div id="cm-summary"></div><div id="cm-list" class="cm-list"></div><section class="panel" id="cm-lib"></section>';
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    App.on((w) => w === 'tienda' && renderWarn());
    Store.watch('respuestas', (m) => {
      state.biblioteca = m;
      renderLib();
    });
    render();
  }

  function render() {
    renderWarn();
    renderInput();
    renderList();
    renderLib();
  }

  function renderWarn() {
    const d = App.tienda;
    const faltan = [!d.demora && 'demora del envío', !d.talles && 'talles'].filter(Boolean);
    $('#cm-warn', el).innerHTML = faltan.length
      ? '<p class="note cm-alert">' + icon('alert') + ' Faltan datos: ' + e(faltan.join(' y ')) + '. <button class="btn link" data-goto="ajustes">Completar</button></p>'
      : '';
  }

  function renderInput() {
    const box = $('#cm-input', el);
    const abierto = !!$('#cm-tono-more[open]', box);
    box.innerHTML =
      '<div class="panel-head"><div class="panel-title">' +
      bubble('message') +
      '<h3><label for="cm-texto">Pegá los comentarios</label></h3>' +
      info('Uno por línea. Podés pegar la lista tal como la copiás de TikTok. Responder rápido genera confianza y más alcance.') +
      '</div></div>' +
      '<textarea id="cm-texto" rows="6" placeholder="¿Es incómodo?&#10;¿Hacen envíos a Córdoba?&#10;¿Sirve de verdad?">' +
      e(state.texto) +
      '</textarea>' +
      '<div class="row-actions">' +
      (state.running
        ? '<button class="btn ghost" data-act="detener">' + icon('stop') + 'Detener</button><span class="cm-run">Escribiendo respuestas…</span>'
        : (AI.sample ? '<button class="btn" data-act="claude">' + icon('sparkles') + 'Responder con Claude</button>' : '') +
          '<button class="btn ' +
          (AI.sample ? 'ghost' : '') +
          '" data-act="plantillas">' +
          (AI.sample ? 'Usar plantillas' : 'Responder') +
          '</button>') +
      '</div>' +
      (state.error ? '<p class="error-text">' + e(state.error) + '</p>' : '') +
      (AI.sample ? more('Tono', '<label class="sr-only" for="cm-tono">Tono</label><input id="cm-tono" placeholder="Ej.: más canchero, sin emojis, tuteo…" value="' + e(state.tono) + '">', 'cm-tono-more') : '');
    if (abierto) $('#cm-tono-more', box).open = true;
  }

  function renderList() {
    const box = $('#cm-list', el);
    const sum = $('#cm-summary', el);
    if (!state.items.length) {
      sum.innerHTML = '';
      box.innerHTML = '';
      return;
    }
    const counts = new Map();
    for (const it of state.items) counts.set(it.tipo, (counts.get(it.tipo) || 0) + 1);
    const top = [...counts.entries()].filter(([k]) => !['positivo', 'otro'].includes(k)).sort((a, b) => b[1] - a[1]);
    const videoTip =
      top.length && top[0][1] >= 2
        ? '<div class="cm-tip">' +
          icon('video') +
          '<span>Lo que más preguntan: <strong>' +
          e(CM.tipo(top[0][0]).label.toLowerCase()) +
          '</strong> (' +
          top[0][1] +
          '). Respondelo con un video.</span><button class="btn soft sm" data-goto="guiones">Armar guion</button></div>'
        : '';
    sum.innerHTML = '<div class="chips">' + [...counts.entries()].map(([k, n]) => chip(CM.tipo(k).label + ' · ' + n, CM.tipo(k).tone)).join('') + '</div>' + videoTip;
    box.innerHTML = state.items
      .map((it, i) => {
        const t = CM.tipo(it.tipo);
        const len = it.respuesta.length;
        return (
          '<article class="cm-card"><div class="cm-top"><p class="cm-q">“' +
          e(it.comentario) +
          '”</p><div class="chips">' +
          chip(t.label, t.tone) +
          (it.video ? chip('Mejor con video', 'source') : '') +
          (it.ocultar ? chip('Ocultar', 'bad') : '') +
          '</div></div><label class="sr-only" for="cm-r-' +
          i +
          '">Respuesta</label><textarea id="cm-r-' +
          i +
          '" data-i="' +
          i +
          '" rows="' +
          (len > 90 ? 3 : 2) +
          '" maxlength="' +
          CM.MAX +
          '">' +
          e(it.respuesta) +
          '</textarea><div class="cm-foot"><span class="cm-count' +
          (len > CM.MAX ? ' is-over' : '') +
          '" id="cm-n-' +
          i +
          '">' +
          len +
          '/' +
          CM.MAX +
          '</span><div class="row-actions"><button class="btn sm" data-act="copiar" data-i="' +
          i +
          '">' +
          icon('copy') +
          '<span class="lbl">Copiar</span></button><button class="btn ghost sm" data-act="otra" data-i="' +
          i +
          '">' +
          icon('refresh') +
          'Otra</button><button class="btn link" data-act="guardar" data-i="' +
          i +
          '">Guardar</button></div></div></article>'
        );
      })
      .join('');
  }

  function renderLib() {
    const box = $('#cm-lib', el);
    if (!box) return;
    const list = [...state.biblioteca.entries()].map(([id, r]) => Object.assign({ id }, r));
    const head =
      '<div class="panel-head"><div class="panel-title">' +
      bubble('star', 'peach') +
      '<div><h3>Biblioteca</h3>' +
      (list.length ? '' : '<p class="small muted">Guardá las respuestas que te gusten para reusarlas.</p>') +
      '</div>' +
      (list.length ? chip(String(list.length), 'neutral') : '') +
      '</div></div>';
    if (!list.length) {
      box.innerHTML = head;
      return;
    }
    const by = new Map();
    for (const r of list) {
      if (!by.has(r.tipo)) by.set(r.tipo, []);
      by.get(r.tipo).push(r);
    }
    box.innerHTML =
      head +
      '<div class="lib">' +
      [...by.entries()]
        .map(
          ([tipo, rs]) =>
            '<div class="lib-group"><span class="eyebrow">' +
            e(CM.tipo(tipo).label) +
            '</span>' +
            rs
              .map(
                (r) =>
                  '<div class="lib-item"><p class="selectable">' +
                  e(r.respuesta) +
                  '</p><div class="row-actions"><button class="btn ghost sm icon-only" data-act="lib-copiar" data-id="' +
                  e(r.id) +
                  '" aria-label="Copiar" title="Copiar">' +
                  icon('copy') +
                  '</button><button class="btn ghost sm icon-only cm-lib-del" data-act="lib-borrar" data-id="' +
                  e(r.id) +
                  '" aria-label="Borrar" title="Borrar">' +
                  icon('trash') +
                  '</button></div></div>'
              )
              .join('') +
            '</div>'
        )
        .join('') +
      '</div>';
  }

  // Copia y muestra "Copiado" sin perder el ícono del botón
  function copiar(text, btn) {
    copyText(text).then((ok) => {
      if (!ok || !btn) return;
      const lbl = btn.querySelector('.lbl');
      if (lbl) {
        if (!lbl.dataset.prev) lbl.dataset.prev = lbl.textContent;
        lbl.textContent = 'Copiado';
        clearTimeout(btn._t);
        btn._t = setTimeout(() => (lbl.textContent = lbl.dataset.prev), 1600);
      } else {
        btn.classList.add('is-done');
        toast('Copiado.', 'good');
        setTimeout(() => btn.classList.remove('is-done'), 1600);
      }
    });
  }

  function plantillas() {
    const coms = CM.splitComments(($('#cm-texto', el) || {}).value || state.texto);
    if (!coms.length) {
      toast('Pegá al menos un comentario.', 'warn');
      return;
    }
    const d = App.datos();
    state.items = coms.slice(0, 80).map((c) => {
      const r = CM.templateReply(c, d, 0);
      return { comentario: c, tipo: r.tipo.id, respuesta: r.respuesta, variante: 0, video: false, ocultar: false, origen: 'plantilla' };
    });
    state.error = '';
    renderInput();
    renderList();
  }

  async function claude() {
    const coms = CM.splitComments(($('#cm-texto', el) || {}).value || state.texto).slice(0, 60);
    if (!coms.length) {
      toast('Pegá al menos un comentario.', 'warn');
      return;
    }
    ctl = new AbortController();
    state.running = true;
    state.error = '';
    renderInput();
    try {
      const data = await AI.sample.json(CM.buildPrompt(coms, App.datos(), state.tono), { signal: ctl.signal, cache: false, modelTier: 'quick' });
      const rs = (data && Array.isArray(data.respuestas) ? data.respuestas : []).filter((r) => r && r.n >= 1 && r.n <= coms.length);
      const byN = new Map(rs.map((r) => [Number(r.n), r]));
      const d = App.datos();
      state.items = coms.map((c, i) => {
        const r = byN.get(i + 1);
        if (!r) {
          const t = CM.templateReply(c, d, 0);
          return { comentario: c, tipo: t.tipo.id, respuesta: t.respuesta, variante: 0, origen: 'plantilla' };
        }
        const tipo = CM.TIPOS.some((t) => t.id === r.tipo) ? r.tipo : CM.classify(c).id;
        return { comentario: c, tipo, respuesta: CM.fit(String(r.respuesta || '')), variante: 0, video: !!r.video, ocultar: !!r.ocultar, origen: 'claude' };
      });
    } catch (err) {
      if (err && err.code !== 'cancelled') state.error = AI.errorText(err);
      if (AI.permanent(err)) AI.sample = null;
    }
    state.running = false;
    renderInput();
    renderList();
  }

  function onInput(ev) {
    const t = ev.target;
    if (t.id === 'cm-texto') state.texto = t.value;
    else if (t.id === 'cm-tono') state.tono = t.value;
    else if (t.dataset.i != null && t.tagName === 'TEXTAREA') {
      const it = state.items[Number(t.dataset.i)];
      it.respuesta = t.value;
      const n = $('#cm-n-' + t.dataset.i, el);
      if (n) {
        n.textContent = t.value.length + '/' + CM.MAX;
        n.classList.toggle('is-over', t.value.length > CM.MAX);
      }
    }
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    const it = t.dataset.i != null ? state.items[Number(t.dataset.i)] : null;
    switch (t.dataset.act) {
      case 'plantillas':
        plantillas();
        break;
      case 'claude':
        claude();
        break;
      case 'detener':
        if (ctl) ctl.abort();
        break;
      case 'copiar':
        copiar(it.respuesta, t);
        break;
      case 'otra': {
        it.variante = (it.variante || 0) + 1;
        it.respuesta = CM.templateReply(it.comentario, App.datos(), it.variante).respuesta;
        it.origen = 'plantilla';
        renderList();
        break;
      }
      case 'guardar': {
        const id = 'r' + Date.now().toString(36);
        const doc = { tipo: it.tipo, respuesta: it.respuesta, ejemplo: it.comentario, creada: new Date().toISOString() };
        state.biblioteca.set(id, doc);
        Store.set('respuestas/' + id, doc).catch(storeFail);
        renderLib();
        toast('Guardada en la biblioteca.', 'good');
        break;
      }
      case 'lib-copiar':
        copiar((state.biblioteca.get(t.dataset.id) || {}).respuesta || '', t);
        break;
      case 'lib-borrar':
        state.biblioteca.delete(t.dataset.id);
        Store.remove('respuestas/' + t.dataset.id).catch(storeFail);
        renderLib();
        break;
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.comentarios = { mount, render };
})(window);
