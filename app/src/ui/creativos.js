/* 3 · Analizador de creativos (reportes de TikTok Ads y Meta Ads) */
(function (root) {
  'use strict';
  const VC = root.VC;
  const U = VC.util;
  const A = VC.ads;
  const P = VC.profit;
  const O = VC.orders;
  const { Store, Shop, AI } = VC.runtime;
  const { e, $, App, chip, banner, emptyState, toast, copyText, storeFail } = VC.ui;

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
    ia: { running: false, text: '', error: '' },
  };
  let el;
  let ctl;

  function mount(section) {
    el = section;
    el.innerHTML =
      '<header class="tool-head"><div><h2>Analizador de creativos</h2><p class="lede">Subí el reporte de anuncios de TikTok o Meta. Te dice qué apagar, qué mantener, qué escalar y qué ángulo vende mejor, usando tu CPA máximo real.</p></div></header>' +
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
    state.ia = { running: false, text: '', error: '' };
    recompute();
    if (!state.map.nombre || !state.map.gasto) toast('No reconocimos todas las columnas. Revisalas en “Columnas detectadas”.', 'warn');
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

  function render() {
    if (!el) return;
    $('#cr-drop', el).innerHTML =
      '<label class="dropzone' +
      (state.file ? ' is-compact' : '') +
      '" for="cr-file"><input type="file" id="cr-file" accept=".csv,.xlsx,.xls,text/csv"><span class="dz-title">' +
      (state.file ? 'Cambiar reporte' : 'Arrastrá el reporte acá o tocá para elegirlo') +
      '</span><span class="dz-sub">CSV o Excel exportado de TikTok Ads Manager o del Administrador de anuncios de Meta, a nivel anuncio.</span></label>';
    const body = $('#cr-body', el);
    if (!state.file) {
      body.innerHTML =
        '<div class="grid-2"><section class="panel"><h3>Cómo exportar de TikTok</h3><ol class="steps"><li>Ads Manager → Campañas → pestaña <strong>Anuncios</strong>.</li><li>Elegí el rango de fechas (los últimos 3 a 7 días).</li><li>Columnas: Costo, Impresiones, Clics (destino), Pago completado, Reproducciones de video de 2 segundos y al 100%.</li><li>Exportar → CSV o Excel.</li></ol></section>' +
        '<section class="panel"><h3>Cómo exportar de Meta</h3><ol class="steps"><li>Administrador de anuncios → pestaña <strong>Anuncios</strong>.</li><li>Elegí el rango de fechas.</li><li>Columnas: Importe gastado, Impresiones, Clics en el enlace, Compras, Reproducciones de video de 3 segundos y ThruPlays.</li><li>Informes → Exportar datos de la tabla → CSV.</li></ol></section></div>' +
        '<p class="note">Para que el ángulo se detecte solo, poné la palabra en el nombre del anuncio: <span class="mono">dolor</span>, <span class="mono">medico</span>, <span class="mono">estetica</span> o <span class="mono">gym</span> (por ejemplo <span class="mono">dolor_confesion_v2</span>). Si no, lo elegís a mano.</p>' +
        '<div class="row-actions"><button class="btn ghost" data-act="ejemplo">Ver con un reporte de ejemplo</button></div>';
      return;
    }
    const sug = suggestedCpa();
    const an = analysis();
    const counts = {};
    for (const a of an.ads) counts[a.decision.accion] = (counts[a.decision.accion] || 0) + 1;
    const plat = state.plataforma === 'tiktok' ? 'TikTok' : state.plataforma === 'meta' ? 'Meta' : 'Plataforma desconocida';

    let html = '';
    if (state.ejemplo) html += banner('info', '<strong>Datos de ejemplo.</strong> No son tus anuncios: subí tu reporte para ver tus números.');
    html +=
      '<div class="toolbar cr-meta"><div class="chips">' +
      chip(plat, 'source') +
      chip(state.file, 'neutral') +
      chip(an.ads.length + ' anuncios', 'neutral') +
      '</div><label class="field-inline" for="cr-cpa">CPA máximo por pedido <input type="text" inputmode="numeric" id="cr-cpa" class="num-input" value="' +
      (an.max ? e(U.int(an.max)) : '') +
      '" placeholder="ej. 25.000"></label>' +
      (sug.value && state.cpaMax != null && state.cpaMax !== sug.value ? '<button class="btn link" data-act="cpa-sugerido">Usar ' + e(U.money(sug.value)) + ' (' + e(sug.origen) + ')</button>' : sug.origen ? '<span class="muted small">Calculado en ' + e(sug.origen) + '</span>' : '') +
      '</div>';
    if (!an.max) html += banner('warn', 'Sin CPA máximo no se puede decidir. Cargá tus costos en Ajustes o escribí acá cuánto podés pagar como máximo por pedido.', '<button class="btn" data-goto="ajustes">Cargar costos</button>');
    if (!state.map.nombre || !state.map.gasto) html += banner('bad', 'No encontramos la columna del nombre del anuncio o la del gasto. Elegilas en “Columnas detectadas”.');
    else if (!state.map.compras) html += banner('warn', 'No encontramos una columna de compras o conversiones: solo se puede juzgar por CTR y retención.');

    html +=
      '<div class="decision-strip">' +
      ['escalar', 'mantener', 'revisar', 'esperar', 'apagar']
        .map((k) => '<div class="dstat tone-' + A.ACCIONES[k].tone + '"><span class="stat-value">' + (counts[k] || 0) + '</span><span class="stat-label">' + e(A.ACCIONES[k].label) + '</span></div>')
        .join('') +
      '</div>';

    // Ángulos
    const g = an.ganador;
    let winTxt = 'Todavía no hay datos suficientes para elegir un ángulo ganador.';
    if (g && g.criterio === 'cpa')
      winTxt = '<strong>Ángulo ganador: ' + e(angleLabel(g.angulo)) + '.</strong> Vende a ' + e(U.money(g.cpa)) + ' por pedido' + (g.vsPromedio != null && g.vsPromedio < 0 ? ', ' + e(U.pct(-g.vsPromedio)) + ' más barato que el promedio' : '') + '. Hacé más variantes de ese ángulo.';
    else if (g) winTxt = '<strong>Señal temprana: ' + e(angleLabel(g.angulo)) + '.</strong> Todavía sin ventas suficientes, pero tiene el mejor CTR (' + e(U.pct(g.ctr, 2)) + ').';
    html +=
      '<section class="panel"><h3>Ángulos</h3><p>' +
      winTxt +
      '</p><div class="table-wrap"><table class="table"><thead><tr><th>Ángulo</th><th class="num">Anuncios</th><th class="num">Gasto</th><th class="num">Ventas</th><th class="num">CPA</th><th class="num">CTR</th><th class="num">Gancho 2-3 s</th></tr></thead><tbody>' +
      an.angles
        .map(
          (x) =>
            '<tr' +
            (g && x.angulo === g.angulo ? ' class="is-winner"' : '') +
            '><th scope="row">' +
            e(angleLabel(x.angulo)) +
            (g && x.angulo === g.angulo ? ' ' + chip('Ganador', 'good') : '') +
            '</th><td class="num">' +
            x.anuncios +
            '</td><td class="num">' +
            e(U.money(x.gasto)) +
            '</td><td class="num">' +
            e(U.int(x.compras)) +
            '</td><td class="num">' +
            e(x.cpa != null ? U.money(x.cpa) : '—') +
            '</td><td class="num">' +
            e(U.pct(x.ctr, 2)) +
            '</td><td class="num">' +
            e(U.pct(x.hookRate)) +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table></div></section>';

    // Anuncios
    html +=
      '<section class="panel"><h3>Qué hacer con cada anuncio</h3><div class="table-wrap"><table class="table ads"><thead><tr><th>Anuncio</th><th>Acción</th><th class="num">Gasto</th><th class="num">Ventas</th><th class="num">CPA</th><th class="num">CTR</th><th class="num">Gancho</th></tr></thead><tbody>' +
      an.ads
        .map((a, i) => {
          const acc = A.ACCIONES[a.decision.accion];
          return (
            '<tr><td class="ad-cell"><div class="ad-name">' +
            e(a.nombre) +
            '</div><label class="sr-only" for="ang-' +
            i +
            '">Ángulo</label><select id="ang-' +
            i +
            '" class="mini-select" data-ad="' +
            e(a.nombre) +
            '">' +
            Object.keys(A.ANGLES)
              .concat('otro')
              .map((k) => '<option value="' + k + '"' + (k === a.angulo ? ' selected' : '') + '>' + e(angleLabel(k)) + '</option>')
              .join('') +
            '</select><div class="ad-why">' +
            e(a.decision.motivo) +
            '</div></td><td>' +
            chip(acc.label, acc.tone) +
            '</td><td class="num">' +
            e(U.money(a.gasto)) +
            '</td><td class="num">' +
            e(U.int(a.compras)) +
            '</td><td class="num">' +
            e(a.cpa != null ? U.money(a.cpa) : '—') +
            '</td><td class="num">' +
            e(U.pct(a.ctr, 2)) +
            '</td><td class="num">' +
            e(U.pct(a.hookRate)) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div><p class="muted small">Contra entrega: la plataforma cuenta el pedido, no la entrega. El CPA máximo ya descuenta los pedidos que se anulan y los que vuelven.</p></section>';

    // Claude
    html +=
      '<section class="panel" id="cr-ia"><div class="panel-head"><h3>Lectura de Claude</h3>' +
      (AI.sample
        ? '<div class="row-actions">' + (state.ia.running ? '<button class="btn ghost" data-act="ia-stop">Detener</button>' : '<button class="btn" data-act="ia">' + (state.ia.text ? 'Volver a analizar' : 'Pedir lectura y nuevos ganchos') + '</button>') + (state.ia.text && !state.ia.running ? '<button class="btn ghost" data-act="ia-copiar">Copiar</button>' : '') + '</div>'
        : '') +
      '</div>' +
      (AI.sample
        ? '<div class="ia-out' + (state.ia.running && !state.ia.text ? ' is-thinking' : '') + '">' + (state.ia.text ? e(state.ia.text) : state.ia.running ? 'Pensando…' : '<span class="muted">Claude lee la tabla, explica por qué gana el ángulo y te propone 5 ganchos nuevos para testear.</span>') + '</div>' + (state.ia.error ? '<p class="error-text">' + e(state.ia.error) + '</p>' : '')
        : '<p class="muted">Abrí el panel desde claude.ai para pedirle a Claude una lectura del reporte.</p>') +
      '</section>';

    // Mapeo de columnas
    const fields = { nombre: 'Nombre del anuncio', gasto: 'Gasto', impresiones: 'Impresiones', clics: 'Clics', compras: 'Compras / conversiones', valor: 'Valor de compras', hook: 'Vistas de 2-3 s', completas: 'Vistas completas' };
    html +=
      '<details class="panel"><summary>Columnas detectadas</summary><div class="map-grid">' +
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
      '</div></details>';
    body.innerHTML = html;
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
    else if (act === 'ia-copiar') copyText(state.ia.text, t);
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.id === 'cr-file' && t.files && t.files[0]) loadFile(t.files[0]);
    else if (t.id === 'cr-cpa') {
      const v = U.parseNum(t.value);
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
