/* Guiones automáticos: elige ángulo, personaje, oferta y pedido extra con lo que ya sabe el panel. */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const U = isNode ? require('./util.js') : root.VC.util;
  const S = isNode ? require('./scripts.js') : root.VC.scripts;
  const CP = isNode ? require('./competitors.js') : root.VC.competitors;

  const ORDEN = ['dolor', 'medico', 'estetica', 'gym'];
  const GANADOR_VIGENTE = 14; // días que vale el ganador del último reporte de anuncios
  const VISTO_HACE = 45; // un anuncio guardado que no se ve hace más que esto probablemente se apagó
  const TANDAS_SIN_REPETIR = 3;
  const MAX_HISTORIAL = 10;
  const MAX_GANCHOS = 3;
  const MAX_BYTES = 140000;

  // Personajes que encajan con cada ángulo (en orden de preferencia)
  const COMPATIBLES = {
    gym: ['fit_m', 'fit_h'],
    medico: ['oficinista_h', 'senior', 'oficinista'],
    estetica: ['oficinista', 'fit_m', 'senior'],
    dolor: ['oficinista', 'oficinista_h', 'senior', 'joven'],
  };

  // Tipos de comentario (lib/comments.js) como la duda que se le escucha al cliente
  const DUDAS = {
    comodidad: '¿es incómodo? ¿se nota abajo de la ropa?',
    duda: '¿de verdad sirve?',
    precio: '¿cuánto sale?',
    envio: '¿llega a mi zona? ¿cuánto tarda?',
    pago: '¿cómo se paga?',
    talle: '¿qué talle me va?',
    uso: '¿cuántas horas por día se usa?',
    compra: '¿cómo lo compro?',
    reclamo: '¿llega de verdad?',
    salud: '¿lo puedo usar si tengo un problema de columna?',
  };
  const SIN_OBJECION = ['positivo', 'otro'];

  function angLabel(k) {
    return (S.ANGULOS[k] || { label: k }).label;
  }

  function perLabel(k) {
    return (S.PERSONAJES[k] || { label: k }).label;
  }

  function dudaTexto(tipo) {
    return DUDAS[tipo] || String(tipo || '');
  }

  // Texto de una línea, sin comillas dobles (va entre comillas dentro del prompt)
  function linea(s, max) {
    const t = String(s || '')
      .replace(/["“”]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
  }

  function diasDesde(iso, hoy) {
    const d = U.dayKeyAR(iso);
    return d ? U.daysBetween(d, hoy) : null;
  }

  function diasTxt(n) {
    return n === 0 ? 'hoy' : n === 1 ? 'ayer' : 'hace ' + n + ' días';
  }

  function plural(n, uno, varios) {
    return n + ' ' + (n === 1 ? uno : varios);
  }

  // Historial ordenado de más viejo a más nuevo, solo con entradas válidas
  function limpiarHistorial(h) {
    return (Array.isArray(h) ? h : [])
      .filter((x) => x && typeof x === 'object')
      .slice()
      .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
  }

  /* Anuncios de la competencia que llevan GANADOR_DIAS+ días activos y que se vieron hace poco. */
  function anunciosGanadores(ads, hoy) {
    const out = [];
    for (const a of ads || []) {
      if (!a) continue;
      const dias = a.dias != null && Number.isFinite(Number(a.dias)) ? Number(a.dias) : CP.daysActive(a.desde, hoy);
      if (dias == null || dias < CP.GANADOR_DIAS) continue;
      const visto = a.ultimaVez || a.cargado || a.primeraVez;
      const hace = visto ? diasDesde(visto, hoy) : null;
      if (hace != null && hace > VISTO_HACE) continue;
      out.push(Object.assign({}, a, { dias }));
    }
    return out.sort((x, y) => y.dias - x.dias);
  }

  function elegirAngulo(input, hoy, historial) {
    const an = input.ultimoAnalisis;
    let nota = '';
    if (an && an.ganador && S.ANGULOS[an.ganador] && ORDEN.includes(an.ganador)) {
      const hace = an.fecha ? diasDesde(an.fecha, hoy) : null;
      if (hace != null && hace >= 0 && hace <= GANADOR_VIGENTE) {
        return { angulo: an.ganador, fuente: 'analisis', razon: 'Ángulo ' + angLabel(an.ganador) + ': es el ganador de tu último reporte de anuncios (' + diasTxt(hace) + ')' };
      }
      nota = '. El ganador de tu reporte de anuncios (' + angLabel(an.ganador) + ') tiene más de ' + GANADOR_VIGENTE + ' días';
    }

    const comp = input.competencia || {};
    const ganadores = anunciosGanadores(comp.ads, hoy).filter((a) => ORDEN.includes(a.angulo));
    if (ganadores.length) {
      const cuenta = new Map();
      for (const a of ganadores) {
        const c = cuenta.get(a.angulo) || { n: 0, dias: 0 };
        c.n++;
        c.dias += a.dias;
        cuenta.set(a.angulo, c);
      }
      const [angulo, c] = [...cuenta.entries()].sort((x, y) => y[1].n - x[1].n || y[1].dias - x[1].dias || ORDEN.indexOf(x[0]) - ORDEN.indexOf(y[0]))[0];
      const esc = comp.escaneo && comp.escaneo.fecha ? diasDesde(comp.escaneo.fecha, hoy) : null;
      return {
        angulo,
        fuente: 'competencia',
        razon:
          'Ángulo ' +
          angLabel(angulo) +
          ': es el que más se repite en los anuncios de la competencia que llevan ' +
          CP.GANADOR_DIAS +
          '+ días activos (' +
          c.n +
          ' de ' +
          ganadores.length +
          (esc != null && esc >= 0 ? ', escaneo de ' + diasTxt(esc) : '') +
          ')' +
          nota,
      };
    }

    // Rotación: el menos usado en el historial; a igualdad, el que hace más que no se usa
    const usos = new Map(ORDEN.map((k) => [k, { n: 0, ultimo: -1 }]));
    historial.forEach((h, i) => {
      const u = usos.get(h.angulo);
      if (u) {
        u.n++;
        u.ultimo = i;
      }
    });
    const angulo = ORDEN.slice().sort((x, y) => usos.get(x).n - usos.get(y).n || usos.get(x).ultimo - usos.get(y).ultimo || ORDEN.indexOf(x) - ORDEN.indexOf(y))[0];
    return {
      angulo,
      fuente: 'rotacion',
      razon: historial.length
        ? 'Ángulo ' + angLabel(angulo) + ': no hay un ganador claro, así que roto entre los 4 y elijo el que menos usaste últimamente' + nota
        : 'Ángulo ' + angLabel(angulo) + ': todavía no hay un ganador en tus anuncios ni en la competencia, así que arranco la rotación entre los 4' + nota,
    };
  }

  function elegirPersonaje(angulo, historial) {
    const compat = (COMPATIBLES[angulo] || COMPATIBLES.dolor).filter((k) => S.PERSONAJES[k]);
    const ultimoUso = new Map();
    historial.forEach((h, i) => ultimoUso.set(h.personaje, i));
    const recientes = new Set(historial.slice(-TANDAS_SIN_REPETIR).map((h) => h.personaje));
    const orden = (lista) => lista.slice().sort((x, y) => (ultimoUso.has(x) ? ultimoUso.get(x) : -1) - (ultimoUso.has(y) ? ultimoUso.get(y) : -1) || compat.indexOf(x) - compat.indexOf(y));
    const libres = compat.filter((k) => !recientes.has(k));
    if (libres.length) {
      const personaje = orden(libres)[0];
      return {
        personaje,
        razon: historial.length ? 'Personaje ' + perLabel(personaje) + ': encaja con ' + angLabel(angulo) + ' y no lo usaste en las últimas tandas' : 'Personaje ' + perLabel(personaje) + ': encaja con el ángulo ' + angLabel(angulo),
      };
    }
    const personaje = orden(compat)[0];
    return { personaje, razon: 'Personaje ' + perLabel(personaje) + ': de los que encajan con ' + angLabel(angulo) + ', es el que hace más que no usás' };
  }

  function oferta(tienda) {
    const t = tienda || {};
    const p2 = U.parseMoney(t.precio2);
    const p1 = U.parseMoney(t.precio1);
    if (p2 > 0) return { texto: 'Pagás al recibir. Llevando 2 pagás ' + U.money(p2) + ' en total', razon: 'Oferta: 2 unidades a ' + U.money(p2) + ' con pago al recibir, como está en Ajustes' };
    if (p1 > 0) return { texto: 'Pagás al recibir. Sale ' + U.money(p1), razon: 'Oferta: ' + U.money(p1) + ' con pago al recibir, como está en Ajustes' };
    return { texto: 'Pagás al recibir.', razon: '' };
  }

  // Hasta MAX_GANCHOS ganchos distintos, primero los del ángulo elegido y los que llevan más días
  function ganchosInspiracion(ads, angulo, hoy) {
    const lista = anunciosGanadores(ads, hoy)
      .filter((a) => String(a.gancho || '').trim())
      .sort((x, y) => (y.angulo === angulo) - (x.angulo === angulo) || y.dias - x.dias);
    const vistos = new Set();
    const out = [];
    for (const a of lista) {
      const k = U.stripAccents(String(a.gancho)).toLowerCase().replace(/[^a-z0-9ñ]+/g, '');
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      out.push(linea(a.gancho, 140));
      if (out.length >= MAX_GANCHOS) break;
    }
    return out;
  }

  function dudaPrincipal(objeciones) {
    const lista = (Array.isArray(objeciones) ? objeciones : []).filter((o) => o && o.tipo && !SIN_OBJECION.includes(o.tipo) && Number(o.n) > 0);
    if (!lista.length) return null;
    return lista.slice().sort((x, y) => Number(y.n) - Number(x.n) || !!y.ejemplo - !!x.ejemplo)[0];
  }

  /*
   * Arma la configuración de la próxima tanda automática.
   * input: {ultimoAnalisis, competencia: {ads, escaneo}, objeciones: [{tipo, n, ejemplo}], historial: [{fecha, angulo, personaje}],
   *         tienda, cfg: {cantidad, clips}, idioma, hoy}
   * Devuelve {opts (para VC.scripts.buildPrompt, sin producto), razones: [frases cortas]}.
   */
  function plan(input) {
    input = input || {};
    const hoy = input.hoy || U.todayKeyAR();
    const historial = limpiarHistorial(input.historial);
    const cfg = input.cfg || {};
    const cantidad = U.clamp(Math.round(Number(cfg.cantidad)) || 3, 1, 5);
    const clips = U.clamp(Math.round(Number(cfg.clips)) || 4, 3, 6);
    const razones = [];

    const ang = elegirAngulo(input, hoy, historial);
    razones.push(ang.razon);
    const per = elegirPersonaje(ang.angulo, historial);
    razones.push(per.razon);

    const of = oferta(input.tienda);
    const extra = [];
    const ganchos = ganchosInspiracion((input.competencia || {}).ads, ang.angulo, hoy);
    if (ganchos.length) {
      extra.push('Ganchos de anuncios de la competencia que llevan ' + CP.GANADOR_DIAS + '+ días activos, como inspiración, sin copiar: ' + ganchos.map((g) => '"' + g + '"').join('; ') + '.');
      razones.push('Sumé ' + plural(ganchos.length, 'gancho', 'ganchos') + ' de anuncios de la competencia con ' + CP.GANADOR_DIAS + '+ días como inspiración, sin copiarlos');
    }
    const duda = dudaPrincipal(input.objeciones);
    if (duda) {
      const txt = dudaTexto(duda.tipo);
      const ej = linea(duda.ejemplo, 120);
      extra.push(
        (cantidad > 1 ? 'Uno de los guiones' : 'El guion') +
          ' responde la duda más repetida en los comentarios: ' +
          txt +
          (ej ? " (ej.: '" + ej + "')" : '') +
          (duda.tipo === 'salud' ? ' Sin promesas de salud: que lo consulte con su kinesiólogo/a.' : '.')
      );
      razones.push((cantidad > 1 ? 'Un guion' : 'El guion') + " responde '" + txt + "', la duda más repetida en tus comentarios (" + plural(Number(duda.n), 'vez', 'veces') + ')');
    }
    if (of.razon) razones.push(of.razon);

    const preset = S.PERSONAJES[per.personaje];
    return {
      opts: {
        angulo: ang.angulo,
        anguloLibre: '',
        personaje: per.personaje,
        personajeLibre: '',
        genero: preset ? preset.g : 'f',
        clips,
        cantidad,
        idiomaPrompt: input.idioma === 'es' ? 'es' : 'en',
        oferta: of.texto,
        extra: extra.join(' '),
      },
      razones,
      fuente: ang.fuente,
    };
  }

  /* Agrupa la biblioteca de respuestas (Map o lista de {tipo, ejemplo, creada}) en objeciones por tipo. */
  function objeciones(docs) {
    const lista = docs instanceof Map ? [...docs.values()] : Array.isArray(docs) ? docs : [];
    const por = new Map();
    for (const d of lista) {
      if (!d || !d.tipo || SIN_OBJECION.includes(d.tipo)) continue;
      const o = por.get(d.tipo) || { tipo: d.tipo, n: 0, ejemplo: '', creada: '' };
      o.n++;
      const ej = String(d.ejemplo || '').trim();
      if (ej && (!o.ejemplo || String(d.creada || '') > o.creada)) {
        o.ejemplo = ej;
        o.creada = String(d.creada || '');
      }
      por.set(d.tipo, o);
    }
    return [...por.values()].map(({ tipo, n, ejemplo }) => ({ tipo, n, ejemplo })).sort((a, b) => b.n - a.n);
  }

  /* Suma la tanda nueva al historial y deja las últimas MAX_HISTORIAL. */
  function sumarHistorial(prev, entrada) {
    return limpiarHistorial(prev)
      .concat([{ fecha: entrada.fecha, angulo: entrada.angulo, personaje: entrada.personaje }])
      .slice(-MAX_HISTORIAL);
  }

  function bytes(o) {
    const s = JSON.stringify(o);
    return typeof Buffer !== 'undefined' ? Buffer.byteLength(s, 'utf8') : new Blob([s]).size;
  }

  function cortarTextos(g, max) {
    const c = (s) => (String(s || '').length > max ? String(s).slice(0, max) + '…' : s);
    return Object.assign({}, g, {
      ficha: c(g.ficha),
      nota: c(g.nota),
      caption: c(g.caption),
      clips: (g.clips || []).map((x) => Object.assign({}, x, { prompt: c(x.prompt), accion: c(x.accion), continuidad: c(x.continuidad) })),
    });
  }

  /* Documento 'guiones/auto' por debajo de MAX_BYTES: primero acorta textos larguísimos y, si no alcanza, saca guiones del final. */
  function armarDoc(d, maxBytes) {
    const max = maxBytes || MAX_BYTES;
    let doc = {
      fecha: d.fecha,
      origen: d.origen || 'manual',
      motivo: String(d.motivo || '').slice(0, 60),
      razones: (d.razones || []).slice(0, 10).map((r) => String(r).slice(0, 300)),
      opts: Object.assign({}, d.opts),
      guiones: (d.guiones || []).slice(0, 5),
      historial: (d.historial || []).slice(-MAX_HISTORIAL),
    };
    delete doc.opts.producto;
    if (bytes(doc) <= max) return doc;
    for (const lim of [6000, 3000, 1500]) {
      doc = Object.assign({}, doc, { guiones: doc.guiones.map((g) => cortarTextos(g, lim)) });
      if (bytes(doc) <= max) return doc;
    }
    while (doc.guiones.length > 1 && bytes(doc) > max) doc = Object.assign({}, doc, { guiones: doc.guiones.slice(0, -1) });
    return doc;
  }

  /* Por qué se escribió la tanda, para mostrar en el panel. */
  function motivoTexto(origen, motivo) {
    if (origen === 'auto') return 'se escribió sola al abrir el panel';
    if (origen === 'cadena') return motivo === 'competencia' ? 'se escribió después del escaneo de la competencia, que encontró anuncios nuevos' : 'se escribió después de otra tarea automática';
    return 'la pediste con “Generar ahora”';
  }

  function resumen(n, angulo) {
    return 'Escribí ' + n + (n === 1 ? ' guion nuevo' : ' guiones nuevos') + ' (ángulo ' + angLabel(angulo) + ')';
  }

  const api = {
    ORDEN,
    COMPATIBLES,
    DUDAS,
    GANADOR_VIGENTE,
    MAX_HISTORIAL,
    MAX_BYTES,
    plan,
    anunciosGanadores,
    objeciones,
    sumarHistorial,
    armarDoc,
    motivoTexto,
    resumen,
    dudaTexto,
    bytes,
  };
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).autoplan = api;
})(typeof window !== 'undefined' ? window : globalThis);
