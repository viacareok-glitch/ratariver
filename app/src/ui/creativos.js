/* 3 · Analizador de creativos (reportes de TikTok Ads y Meta Ads) */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const A = VC.ads;
  const P = VC.profit;
  const O = VC.orders;
  const { Store, Shop, AI } = VC.runtime;
  const { e, $, $$, App, chip, banner, toast, copyText, storeFail, icon, bubble, pageHead, info, more } = VC.ui;

  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  const EJEMPLO = [
    'Ad name,Cost,Impressions,Clicks (destination),Complete payment,2-second video views,Video views at 100%',
    'EJEMPLO dolor_confesion_v1,84000,31000,620,9,10500,1400',
    'EJEMPLO dolor_pregunta_v2,52000,22000,350,4,6900,800',
    'EJEMPLO medico_kinesiologa_v1,61000,26000,410,3,7800,1100',
    'EJEMPLO estetica_remera_v1,48000,24000,190,0,4100,300',
    'EJEMPLO gym_press_v1,39000,15000,240,1,5200,500',
    'EJEMPLO gym_espejo_v2,12000,5200,40,0,700,60',
    'EJEMPLO dolor_demo_v3,9000,4100,70,0,1600,210',
  ].join('\n');

  const state = {
    file: null,
    headers: [],
    rows: [],
    map: {},
    plataforma: null,
    ads: [],
    overrides: {},
    cpaMax: null,
    ejemplo: false,
    filtro: null,
    ia: { running: false, text: '', error: '' },
  };
  let el;
  let ctl;

  function mount(section) {
    el = section;
    el.innerHTML =
      pageHead('Creativos', 'Subí el reporte y te digo qué apagar y qué escalar.') +
      '<div id="cr-drop"></div><div id="cr-body"></div>';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('dragover', (ev) => {
      if (ev.target.closest('.dropzone')) {
        ev.preventDefault();
        ev.target.closest('.dropzone').classList.add('is-over');
      }
    });
    el.addEventListener('dragleave', (ev) => ev.target.closest('.dropzone') && ev.target.closest('.dropzone').classList.remove('is-over'));
    el.addEventListener('drop', (ev) => {
      const dz = ev.target.closest('.dropzone');
      if (!dz) return;
      ev.preventDefault();
      dz.classList.remove('is-over');
      if (ev.dataTransfer.files[0]) loadFile(ev.dataTransfer.files[0]);
    });
    Store.get('creativos/angulos').then((d) => {
      state.overrides = (d && d.map) || {};
      render();
    });
    App.on((w) => w === 'cfg' && render());
    Shop.onChange(() => state.rows.length && render());
    render();
  }

  function suggestedCpa() {
    const manual = P.normalizeCfg(App.cfg).cpaMaxManual;
    if (manual > 0) return { value: manual, origen: 'Ajustes' };
    const be = P.breakEven(App.cfg, O.historicalRates(Shop.orders));
    if (be && P.costsReady(App.cfg) && be.cpaEquilibrio > 0) return { value: Math.round(be.cpaEquilibrio), origen: 'Ganancia real' };
    return { value: null, origen: null };
  }

  function angleOf(a) {
    return state.overrides[a.nombre] || A.detectAngle(a.nombre);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (root.XLSX) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar el lector de Excel. Exportá el reporte como CSV.'));
      document.head.appendChild(s);
    });
  }

  async function loadFile(file) {
    try {
      let headers;
      let rows;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        await loadScript(XLSX_URL);
        const wb = root.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const matrix = root.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
        const hi = matrix.findIndex((r) => r.filter((c) => String(c).trim()).length >= 3);
        headers = (matrix[hi] || []).map((h) => String(h).trim());
        rows = matrix.slice(hi + 1).map((r) => {
          const o = {};
          headers.forEach((h, i) => (o[h] = r[i] == null ? '' : r[i]));
          return o;
        });
      } else {
        const parsed = U.parseCSV(await VC.ui.readFileText(file));
        headers = parsed.headers;
        rows = parsed.rows;
      }
      setData(file.name, headers, rows, false);
    } catch (err) {
      toast(err.message || 'No se pudo leer el archivo.', 'bad');
    }
  }

  function setData(name, headers, rows, ejemplo) {
    state.file = name;
    state.headers = headers;
    state.rows = rows;
    state.map = A.detectMapping(headers);
    state.plataforma = A.detectPlatform(headers);
    state.ejemplo = ejemplo;
    state.filtro = null;
    state.ia = { running: false, text: '', error: '' };
    recompute();
    if (!state.map.nombre || !state.map.gasto) toast('Faltan columnas: revisalas en “Columnas detectadas”.', 'warn');
    else saveSummary();
  }

  function recompute() {
    state.ads = state.map.nombre ? A.aggregate(state.rows, state.map) : [];
    render();
  }

  function cpaMax() {
    return state.cpaMax != null ? state.cpaMax : suggestedCpa().value;
  }

  function analysis() {
    const max = cpaMax();
    const ads = state.ads.map((a) => Object.assign({}, a, { angulo: angleOf(a), decision: A.decide(a, max) }));
    ads.sort((x, y) => A.ACCIONES[x.decision.accion].orden - A.ACCIONES[y.decision.accion].orden || y.gasto - x.gasto);
    const angles = A.byAngle(state.ads, angleOf);
    return { ads, angles, ganador: A.winner(angles), max };
  }

  function angleLabel(k) {
    return (A.ANGLES[k] && A.ANGLES[k].label) || 'Sin ángulo';
  }

  const ACC_ICON = { escalar: 'trending', mantener: 'check', revisar: 'refresh', esperar: 'clock', apagar: 'stop', sin_cpa: 'info' };

  function exportHelp() {
    return (
      '<div class="cr-howto"><div><h4>TikTok Ads</h4><ol class="steps"><li>Campañas → pestaña <strong>Anuncios</strong>.</li><li>Rango: últimos 3 a 7 días.</li><li>Columnas: costo, impresiones, clics, pagos completados y vistas de 2 s y al 100%.</li><li>Exportar → CSV o Excel.</li></ol></div>' +
      '<div><h4>Meta Ads</h4><ol class="steps"><li>Administrador → pestaña <strong>Anuncios</strong>.</li><li>Elegí el rango de fechas.</li><li>Columnas: importe gastado, impresiones, clics en el enlace, compras, vistas de 3 s y ThruPlays.</li><li>Informes → Exportar → CSV.</li></ol></div></div>' +
      '<p class="note">Poné el ángulo en el nombre del anuncio y lo detecto solo: <span class="mono">dolor</span>, <span class="mono">medico</span>, <span class="mono">estetica</span> o <span class="mono">gym</span>.</p>'
    );
  }

  // Ids de los <details> abiertos, para no cerrarlos al redibujar
  function openIds(box) {
    return $$('details[id][open]', box).map((d) => d.id);
  }

  function reopen(box, ids) {
    for (const id of ids) {
      const d = box.querySelector('#' + id);
      if (d) d.open = true;
    }
  }

  // Si un "change" llega mientras se redibuja (al sacar un campo con foco), se redibuja después
  let dibujando = false;
  let otraVez = false;

  function render() {
    if (!el) return;
    if (dibujando) {
      otraVez = true;
      return;
    }
    dibujando = true;
    try {
      dibujar();
    } finally {
      dibujando = false;
    }
    if (otraVez) {
      otraVez = false;
      setTimeout(render, 0);
    }
  }

  function dibujar() {
    const drop = $('#cr-drop', el);
    const body = $('#cr-body', el);
    if (!state.file) {
      drop.innerHTML =
        '<label class="dropzone cr-drop" for="cr-file"><input type="file" id="cr-file" accept=".csv,.xlsx,.xls,text/csv">' +
        bubble('upload') +
        '<span class="dz-title">Soltá el reporte acá</span><span class="dz-sub">o tocá para elegirlo · CSV o Excel de TikTok o Meta</span></label>';
      body.innerHTML =
        '<div class="row-actions cr-start"><button class="btn soft" data-act="ejemplo">' +
        icon('play') +
        'Ver un ejemplo</button></div>' +
        more('Cómo exportar el reporte', exportHelp(), 'cr-howto');
      return;
    }
    const keep = openIds(el);
    const sug = suggestedCpa();
    const an = analysis();
    const counts = {};
    for (const a of an.ads) counts[a.decision.accion] = (counts[a.decision.accion] || 0) + 1;
    if (state.filtro && !counts[state.filtro]) state.filtro = null;
    const plat = state.plataforma === 'tiktok' ? 'TikTok' : state.plataforma === 'meta' ? 'Meta' : 'Otra plataforma';
    const faltaCol = !state.map.nombre || !state.map.gasto;

    // Barra del reporte: archivo (se puede cambiar o soltar otro), CPA máximo y columnas
    let cpaHint = '';
    if (sug.value && state.cpaMax != null && state.cpaMax !== sug.value) cpaHint = '<button class="btn link" data-act="cpa-sugerido">Usar ' + e(U.money(sug.value)) + '</button>';
    else if (sug.origen && state.cpaMax == null) cpaHint = '<span class="muted small">de ' + e(sug.origen) + '</span>';
    drop.innerHTML =
      '<section class="panel cr-bar"><div class="cr-bar-row"><label class="dropzone is-compact cr-file" for="cr-file"><input type="file" id="cr-file" accept=".csv,.xlsx,.xls,text/csv">' +
      bubble('upload') +
      '<span class="cr-file-txt"><span class="dz-title">' +
      e(state.file) +
      (state.ejemplo ? ' ' + chip('Ejemplo', 'peach') : '') +
      '</span><span class="dz-sub">' +
      e(plat + ' · ' + an.ads.length + (an.ads.length === 1 ? ' anuncio' : ' anuncios')) +
      ' · <span class="cr-change">Cambiar</span></span></span></label><div class="cr-cpa"><span class="cr-cpa-label"><label for="cr-cpa">CPA máximo</label>' +
      info('Lo máximo que podés pagar en anuncios por pedido sin perder plata. Ya descuenta los pedidos que se anulan y los que vuelven: la plataforma cuenta el pedido, no la entrega.') +
      '</span><input type="text" inputmode="numeric" id="cr-cpa" class="num-input" value="' +
      (an.max ? e(U.int(an.max)) : '') +
      '" placeholder="25.000">' +
      cpaHint +
      '</div></div>' +
      more('Columnas detectadas', colsHtml(), 'cr-cols') +
      '</section>';
    if (faltaCol) {
      const d = $('#cr-cols', drop);
      if (d) d.open = true;
    }

    if (faltaCol) {
      body.innerHTML = banner('bad', 'No encontré la columna del <strong>nombre</strong> o del <strong>gasto</strong>. Elegila en “Columnas detectadas”.');
      reopen(el, keep);
      return;
    }
    let html = '';
    if (!state.map.compras) html += banner('warn', 'No hay columna de compras: decido solo por CTR y retención.');
    if (!an.max) html += banner('warn', 'Falta tu <strong>CPA máximo</strong> para decidir.', '<button class="btn" data-goto="ajustes">Cargar costos</button>');

    // Cuántos anuncios van a cada acción (tocar una tarjeta filtra la lista)
    if (an.max && an.ads.length) {
      html +=
        '<div class="cr-tiles" role="group" aria-label="Filtrar por acción">' +
        ['escalar', 'mantener', 'revisar', 'esperar', 'apagar']
          .map((k) => {
            const acc = A.ACCIONES[k];
            const on = state.filtro === k;
            return (
              '<button type="button" class="cr-tile tone-' +
              acc.tone +
              (on ? ' is-on' : '') +
              (counts[k] ? '' : ' is-zero') +
              '" data-act="filtro" data-v="' +
              k +
              '" aria-pressed="' +
              on +
              '"' +
              (counts[k] ? '' : ' disabled') +
              '><span class="cr-tile-n">' +
              (counts[k] || 0) +
              '</span><span class="cr-tile-l">' +
              icon(ACC_ICON[k]) +
              e(acc.label) +
              '</span></button>'
            );
          })
          .join('') +
        '</div>';
    }

    // Ángulos
    const g = an.ganador;
    let winTxt = '<span class="muted">Todavía no hay datos para elegir un ganador.</span>';
    if (g && g.criterio === 'cpa')
      winTxt =
        'Gana <strong>' +
        e(angleLabel(g.angulo)) +
        '</strong>: ' +
        e(U.money(g.cpa)) +
        ' por venta' +
        (g.vsPromedio != null && g.vsPromedio < 0 ? ', ' + e(U.pct(-g.vsPromedio)) + ' más barato' : '') +
        '. Hacé más variantes.';
    else if (g) winTxt = 'Señal temprana: <strong>' + e(angleLabel(g.angulo)) + '</strong> tiene el mejor CTR (' + e(U.pct(g.ctr, 2)) + '), todavía sin ventas.';
    if (an.angles.length) {
      html +=
        '<section class="panel"><div class="panel-head"><div class="panel-title">' +
        bubble('trending', 'good') +
        '<div><h3>Ángulos</h3><p class="small cr-win">' +
        winTxt +
        '</p></div></div>' +
        (g && A.ANGLES[g.angulo] ? '<button class="btn soft sm" data-goto="guiones">' + icon('video') + 'Hacer guiones</button>' : '') +
        '</div><div class="cr-angles">' +
        an.angles
          .map((x) => {
            const win = g && x.angulo === g.angulo;
            return (
              '<article class="cr-angle' +
              (win ? ' is-winner' : '') +
              '"><div class="cr-angle-top"><h4>' +
              e(angleLabel(x.angulo)) +
              '</h4>' +
              (win ? chip('Ganador', 'good') : '<span class="muted small">' + x.anuncios + (x.anuncios === 1 ? ' anuncio' : ' anuncios') + '</span>') +
              '</div><div class="cr-angle-cpa">' +
              (x.cpa != null ? '<span class="cr-big">' + e(U.money(x.cpa)) + '</span><span class="muted small">por venta</span>' : '<span class="cr-big is-none">—</span><span class="muted small">sin ventas</span>') +
              '</div>' +
              nums([
                ['Gasto', U.money(x.gasto)],
                ['Ventas', U.int(x.compras)],
                ['CTR', U.pct(x.ctr, 2)],
                ['Gancho', U.pct(x.hookRate)],
              ]) +
              '</article>'
            );
          })
          .join('') +
        '</div></section>';
    }

    // Anuncios
    const lista = state.filtro ? an.ads.filter((a) => a.decision.accion === state.filtro) : an.ads;
    const angKeys = Object.keys(A.ANGLES).concat('otro');
    html +=
      '<section class="panel"><div class="panel-head"><div class="panel-title">' +
      bubble('grid') +
      '<h3>' +
      (state.filtro ? e(A.ACCIONES[state.filtro].label) : 'Cada anuncio') +
      '</h3>' +
      chip(String(lista.length), 'neutral') +
      '</div>' +
      (state.filtro ? '<button class="btn link" data-act="filtro" data-v="">Ver todos</button>' : '') +
      '</div>' +
      (lista.length
        ? '<ul class="cr-ads">' +
          lista
            .map((a) => {
              const acc = A.ACCIONES[a.decision.accion];
              const i = an.ads.indexOf(a);
              return (
                '<li class="cr-ad tone-' +
                acc.tone +
                '"><div class="cr-ad-main"><div class="cr-ad-head">' +
                chip(acc.label, acc.tone) +
                '<span class="ad-name">' +
                e(a.nombre) +
                '</span></div>' +
                (a.decision.accion !== 'sin_cpa' ? '<p class="ad-why">' + e(a.decision.motivo) + '</p>' : '') +
                '<label class="cr-ad-ang" for="ang-' +
                i +
                '">Ángulo<select id="ang-' +
                i +
                '" class="mini-select" data-ad="' +
                e(a.nombre) +
                '">' +
                angKeys.map((k) => '<option value="' + k + '"' + (k === a.angulo ? ' selected' : '') + '>' + e(angleLabel(k)) + '</option>').join('') +
                '</select></label></div>' +
                nums([
                  ['Gasto', U.money(a.gasto)],
                  ['Ventas', U.int(a.compras)],
                  ['CPA', a.cpa != null ? U.money(a.cpa) : '—'],
                  ['CTR', U.pct(a.ctr, 2)],
                  ['Gancho', U.pct(a.hookRate)],
                ]) +
                '</li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="muted">No hay anuncios para mostrar.</p>') +
      '</section>';

    // Claude
    let iaAct = '';
    if (AI.sample) {
      if (state.ia.running) iaAct = '<button class="btn ghost" data-act="ia-stop">' + icon('stop') + 'Detener</button>';
      else if (state.ia.text) iaAct = '<button class="btn ghost sm" data-act="ia-copiar">' + icon('copy') + '<span class="lbl">Copiar</span></button><button class="btn ghost sm" data-act="ia">' + icon('refresh') + 'De nuevo</button>';
      else iaAct = '<button class="btn" data-act="ia">' + icon('sparkles') + 'Pedir lectura</button>';
    }
    html +=
      '<section class="panel" id="cr-ia"><div class="panel-head"><div class="panel-title">' +
      bubble('sparkles', 'source') +
      '<div><h3>Lectura de Claude</h3>' +
      (state.ia.text || state.ia.running ? '' : '<p class="small muted">Qué está pasando y 5 ganchos nuevos para probar.</p>') +
      '</div></div>' +
      (iaAct ? '<div class="row-actions">' + iaAct + '</div>' : '') +
      '</div>' +
      (AI.sample
        ? state.ia.text || state.ia.running
          ? '<div class="ia-out' + (state.ia.running && !state.ia.text ? ' is-thinking' : '') + '">' + (state.ia.text ? e(state.ia.text) : 'Pensando…') + '</div>'
          : ''
        : '<div class="note">' + icon('sparkles') + ' Necesita Claude. ' + info('Abrí el panel desde claude.ai o la app de Claude para pedirle una lectura del reporte.') + '</div>') +
      (state.ia.error ? '<p class="error-text">' + e(state.ia.error) + '</p>' : '') +
      '</section>';

    body.innerHTML = html;
    reopen(el, keep);
  }

  function nums(list) {
    return '<dl class="cr-nums">' + list.map(([k, v]) => '<div><dt>' + e(k) + '</dt><dd>' + e(v) + '</dd></div>').join('') + '</dl>';
  }

  function colsHtml() {
    const fields = { nombre: 'Nombre del anuncio', gasto: 'Gasto', impresiones: 'Impresiones', clics: 'Clics', compras: 'Compras', valor: 'Valor de compras', hook: 'Vistas de 2-3 s', completas: 'Vistas completas' };
    return (
      '<div class="map-grid">' +
      Object.entries(fields)
        .map(
          ([k, label]) =>
            '<label for="map-' +
            k +
            '">' +
            e(label) +
            '<select id="map-' +
            k +
            '" data-map="' +
            k +
            '"><option value="">(no usar)</option>' +
            state.headers.map((h) => '<option' + (state.map[k] === h ? ' selected' : '') + '>' + e(h) + '</option>').join('') +
            '</select></label>'
        )
        .join('') +
      '</div>'
    );
  }

  // Copia y muestra "Copiado" sin perder el ícono del botón
  function copiar(text, btn) {
    copyText(text).then((ok) => {
      const lbl = btn && btn.querySelector('.lbl');
      if (!ok || !lbl) return;
      if (!lbl.dataset.prev) lbl.dataset.prev = lbl.textContent;
      lbl.textContent = 'Copiado';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => (lbl.textContent = lbl.dataset.prev), 1600);
    });
  }

  function summaryRows(an) {
    return an.angles.map((x) => ({ angulo: x.angulo, gasto: Math.round(x.gasto), compras: x.compras, cpa: x.cpa ? Math.round(x.cpa) : null, ctr: x.ctr, hookRate: x.hookRate }));
  }

  function saveSummary() {
    if (state.ejemplo) return;
    const an = analysis();
    const doc = {
      fecha: new Date().toISOString(),
      archivo: state.file,
      plataforma: state.plataforma,
      cpaMax: an.max || null,
      ganador: an.ganador ? an.ganador.angulo : null,
      angulos: summaryRows(an),
      acciones: an.ads.slice(0, 60).map((a) => ({ nombre: a.nombre, angulo: a.angulo, accion: a.decision.accion, gasto: Math.round(a.gasto), compras: a.compras })),
    };
    App.ultimoAnalisis = doc;
    App.emit('analisis');
    Store.set('creativos/ultimo', doc).catch(storeFail);
  }

  async function askClaude() {
    const an = analysis();
    const ticket = O.historicalRates(Shop.orders).ticketPromedio;
    const tabla = an.ads
      .slice(0, 80)
      .map((a) => [a.nombre, angleLabel(a.angulo), Math.round(a.gasto), a.compras, a.cpa ? Math.round(a.cpa) : '-', U.pct(a.ctr, 2), U.pct(a.hookRate), A.ACCIONES[a.decision.accion].label].join(' | '))
      .join('\n');
    const angs = an.angles.map((x) => [angleLabel(x.angulo), Math.round(x.gasto), x.compras, x.cpa ? Math.round(x.cpa) : '-', U.pct(x.ctr, 2), U.pct(x.hookRate)].join(' | ')).join('\n');
    const prompt = [
      'Sos media buyer de e-commerce en Argentina. La tienda vende un corrector de postura con pago contra entrega' + (ticket ? ' (ticket promedio de los pedidos entregados: ' + U.money(ticket) + ')' : '') + '. Plataforma del reporte: ' + (state.plataforma || 'desconocida') + '.',
      'CPA máximo por pedido para no perder: ' + (an.max ? U.money(an.max) : 'sin dato') + '. La plataforma cuenta pedidos, no entregas.',
      '',
      'ÁNGULOS (ángulo | gasto ARS | ventas | CPA | CTR | gancho 2-3 s):',
      angs,
      '',
      'ANUNCIOS (nombre | ángulo | gasto ARS | ventas | CPA | CTR | gancho | decisión por reglas):',
      tabla,
      '',
      'Respondé en español rioplatense, sin markdown (texto plano con guiones), en este orden y breve:',
      '1. Lectura en 3 líneas: qué está pasando.',
      '2. Si alguna decisión por reglas te parece equivocada, cuál y por qué (si no, decilo).',
      '3. Por qué creés que funciona el mejor ángulo y qué patrón ves en los ganchos que retienen.',
      '4. Cinco ganchos nuevos (primera frase del video, máximo 12 palabras) para testear del ángulo ganador. Sin promesas de cura ni claims médicos.',
      '5. Cómo repartir el presupuesto mañana.',
    ].join('\n');
    ctl = new AbortController();
    state.ia = { running: true, text: '', error: '' };
    render();
    try {
      const res = await AI.sample(prompt, { signal: ctl.signal, cache: false, onText: ({ text }) => {
        state.ia.text = text;
        const out = el.querySelector('#cr-ia .ia-out');
        if (out) {
          out.classList.remove('is-thinking');
          out.textContent = text;
        }
      } });
      state.ia.text = res.text + (res.truncated ? '\n\n(La respuesta se cortó por largo.)' : '');
    } catch (err) {
      state.ia.text = err.text || '';
      if (err.code !== 'cancelled') state.ia.error = AI.errorText(err);
      if (AI.permanent(err)) AI.sample = null;
    }
    state.ia.running = false;
    render();
  }

  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t || !el.contains(t)) return;
    const act = t.dataset.act;
    if (act === 'ejemplo') {
      const p = U.parseCSV(EJEMPLO);
      setData('reporte-ejemplo.csv', p.headers, p.rows, true);
    } else if (act === 'cpa-sugerido') {
      state.cpaMax = null;
      render();
    } else if (act === 'ia') askClaude();
    else if (act === 'ia-stop') ctl && ctl.abort();
    else if (act === 'ia-copiar') copiar(state.ia.text, t);
    else if (act === 'filtro') {
      state.filtro = t.dataset.v && t.dataset.v !== state.filtro ? t.dataset.v : null;
      render();
    }
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.id === 'cr-file' && t.files && t.files[0]) loadFile(t.files[0]);
    else if (t.id === 'cr-cpa') {
      const v = U.parseMoney(t.value);
      state.cpaMax = v > 0 ? v : null;
      render();
      saveSummary();
    } else if (t.dataset.ad) {
      state.overrides[t.dataset.ad] = t.value;
      if (!state.ejemplo) Store.set('creativos/angulos', { map: Object.assign({}, state.overrides) }).catch(storeFail);
      render();
      saveSummary();
    } else if (t.dataset.map) {
      state.map[t.dataset.map] = t.value || undefined;
      recompute();
      saveSummary();
    }
  }

  VC.tools = VC.tools || {};
  VC.tools.creativos = { mount, render };
})(window);
