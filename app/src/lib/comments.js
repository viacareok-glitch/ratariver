/* Respuestas para comentarios de TikTok: clasifica el comentario y propone una respuesta corta con tu tono. */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const U = isNode ? require('./util.js') : root.VC.util;

  const MAX = 150; // largo máximo de un comentario en TikTok

  // Orden = prioridad cuando un comentario encaja en varios tipos
  const TIPOS = [
    { id: 'reclamo', label: 'Reclamo', tone: 'bad', re: /(nunca (me )?lleg|no me lleg|no lleg[oó]|reclamo|me estafaron|no responden|no contestan|p[eé]simo|horrible|me lleg[oó] (roto|mal|fallado))/ },
    { id: 'salud', label: 'Salud', tone: 'warn', re: /(escoliosis|hernia|embaraz|lesi[oó]n|operad|cirug|artrosis|lordosis|cifosis|disco|ci[aá]tic|traumat|kinesi|fractura|osteopor)/ },
    { id: 'positivo', label: 'Positivo', tone: 'good', re: /(^|\s)(me lleg[oó]( ya)?( y| re| super| s[uú]per| excelente| genial| hermoso|!|$)|lo tengo|lo uso|lo compr[eé]|me sirvi[oó]|lo recomiendo|recomendad[oa])/ },
    { id: 'compra', label: 'Quiere comprar', tone: 'good', re: /(c[oó]mo (lo )?(compro|pido|consigo|hago)|d[oó]nde (lo )?(compro|consigo|venden)|lo quiero|quiero (uno|dos|el|lo|comprar)|me interesa|link|pas[aá] (el )?link|info\b|informaci[oó]n|me lo mand)/ },
    { id: 'envio', label: 'Envío', tone: 'info', re: /(env[ií]o|env[ií]an|mandan|hacen env|llega|llegan|tarda|demora|c[oó]rdoba|rosario|mendoza|tucum[aá]n|salta|neuqu[eé]n|mar del plata|la plata|santa fe|interior|provincia|patagonia|chaco|corrientes|misiones|jujuy|san juan|san luis|entre r[ií]os|bah[ií]a blanca|caba|capital)/ },
    { id: 'pago', label: 'Pago', tone: 'info', re: /(contra ?entrega|pago|pagar|efectivo|tarjeta|cuotas|transferencia|mercado ?pago|al recibir)/ },
    { id: 'precio', label: 'Precio', tone: 'info', re: /(precio|cu[aá]nto (sale|cuesta|vale|est[aá]|es)|\$|valor|caro|barato|cu[aá]nto)/ },
    { id: 'talle', label: 'Talle', tone: 'info', re: /(talle|medida|talla|xl|xxl|gord|flac|panza|busto|peso|mido|kilos|grandote|petis|hombre|mujer|unisex)/ },
    { id: 'comodidad', label: 'Comodidad', tone: 'info', re: /(inc[oó]modo|molesta|lastima|aprieta|calor|se nota|abajo de la ropa|debajo de la ropa|roza|pica|transpira|duele usarlo|c[oó]modo)/ },
    { id: 'uso', label: 'Uso', tone: 'info', re: /(cu[aá]ntas horas|todo el d[ií]a|dormir|cu[aá]nto tiempo|se lava|lavar|para chicos|para nenes|ni[ñn]os|adolescente)/ },
    { id: 'duda', label: 'Duda si sirve', tone: 'warn', re: /(sirve|funciona|de verdad|en serio|verso|chamuyo|estafa|trucho|mentira|curro|chino|temu|shein|aliexpress|m[aá]s barato|ia\b|inteligencia artificial|actriz|actor)/ },
    { id: 'positivo', label: 'Positivo', tone: 'good', re: /(me encant|lo tengo|lo uso|me lleg[oó]|lo compr[eé]|excelente|re bueno|recomiendo|genial|me sirvi[oó]|buen[ií]simo|❤|😍|🔥|👏)/ },
  ];
  const OTRO = { id: 'otro', label: 'Otro', tone: 'neutral' };

  function classify(text) {
    const s = U.stripAccents(String(text || '')).toLowerCase();
    const raw = String(text || '').toLowerCase();
    const pregunta = /[?¿]/.test(raw);
    for (const t of TIPOS) {
      if (pregunta && t.id === 'positivo') continue; // "¿lo tengo que usar todo el día?" no es un elogio
      if (t.re.test(s) || t.re.test(raw)) return t;
    }
    return OTRO;
  }

  function tipo(id) {
    return TIPOS.find((t) => t.id === id) || OTRO;
  }

  // Lugar mencionado ("¿llega a Córdoba?") para personalizar la respuesta de envío
  function lugar(text) {
    const m = String(text || '').match(/\b(?:a|en|para|hasta)\s+((?:[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)(?:\s+(?:del|de|la)?\s*[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)*)/);
    return m ? m[1] : '';
  }

  function fit(s) {
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length <= MAX) return s;
    const cut = s.slice(0, MAX - 1);
    return cut.slice(0, cut.lastIndexOf(' ')) + '…';
  }

  /*
   * Respuesta de plantilla según el tipo. `d` son los datos de la tienda (precio1, precio2, envio, pago, demora, talles).
   * variant rota entre redacciones para no repetir la misma frase en todos los comentarios.
   */
  function templateReply(text, d, variant) {
    const t = classify(text);
    const v = Number(variant) || 0;
    const p1 = d.precio1 ? U.money(d.precio1) : '';
    const p2 = d.precio2 ? U.money(d.precio2) : '';
    const precio = p1 ? p1 + (p2 ? ' y llevando 2 pagás ' + p2 : '') : '';
    const envio = d.envio || 'Enviamos a todo el país';
    const pago = d.pago || 'pagás cuando te llega';
    const demora = d.demora ? ' Tarda ' + d.demora + '.' : '';
    const donde = lugar(text);
    const opts = {
      reclamo: ['Uh, perdón por eso. Escribinos por WhatsApp con tu número de pedido y lo resolvemos hoy mismo 🙏', 'Lamentamos mucho la demora. Mandanos tu número de pedido por WhatsApp y lo vemos ya.'],
      salud: ['Para casos como el tuyo lo mejor es consultarlo con tu médico o kinesiólogo antes de usarlo. Cualquier duda te ayudamos 🙌', 'Con esa condición, consultalo primero con tu profesional de confianza. Te pasamos toda la info si la necesitás.'],
      compra: ['¡Genial! Lo pedís desde el link del perfil y ' + pago + ' 🙌', 'Está en el link de nuestro perfil. Completás tus datos y ' + pago + '.'],
      envio: [(donde ? '¡Sí! Llegamos a ' + donde + '. ' : '') + envio + ' y ' + pago + '.' + demora, envio + (donde ? ', ' + donde + ' incluido' : '') + '. ' + cap(pago) + ' 📦' + demora],
      pago: ['Sí, ' + pago + '. No tenés que adelantar nada 🙌', cap(pago) + ', sin pagar nada antes. Lo pedís desde el link del perfil.'],
      precio: [precio ? 'Sale ' + precio + '. Y ' + pago + ' 🙌' : 'Te pasamos el precio por mensaje privado. ' + cap(pago) + '.', precio ? 'Está ' + precio + ', y ' + pago + '. Link en el perfil.' : 'Escribinos por privado y te pasamos el precio. ' + cap(pago) + '.'],
      talle: [d.talles ? d.talles + '. Si tenés dudas con tu medida, escribinos y te asesoramos.' : 'Se regula con las tiras para que quede a tu medida. Si querés, escribinos y te asesoramos.', 'Se ajusta con las tiras. Pasanos tu talle de remera por privado y te decimos 👌'],
      comodidad: ['Es liviano y se regula: lo podés usar debajo de la remera y no se nota. Arrancá con ratitos cortos 🙌', 'Se ajusta a tu cuerpo y va debajo de la ropa. Lo ideal es empezar con un rato por día e ir sumando.'],
      uso: ['Te recomendamos empezar con 1 o 2 horas por día e ir sumando. No es para dormir 😉', 'Arrancá con ratitos de 1 hora y subí de a poco. Se usa de día, mientras trabajás o estás sentado/a.'],
      duda: ['Te ayuda a recordar la postura: tira los hombros suavemente hacia atrás. Y como ' + pago + ', lo ves antes de pagar 🙌', 'Entendemos la duda. Por eso ' + pago + ': lo recibís, lo ves y recién ahí pagás.'],
      positivo: ['¡Gracias! Nos alegra un montón que te sirva 🙌', '¡Qué lindo leer esto! Gracias por elegirnos 💙'],
      otro: ['¡Gracias por comentar! Cualquier duda escribinos por privado 🙌', 'Gracias por escribir. Si tenés alguna pregunta, contestamos por acá o por privado.'],
    }[t.id];
    return { tipo: t, respuesta: fit(opts[v % opts.length]) };
  }

  function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /* Separa lo pegado en comentarios: uno por línea, ignorando líneas de interfaz de TikTok (fechas, "Responder", contadores). */
  function splitComments(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 2)
      .filter((l) => !/^(responder|reply|ver \d+ respuestas?|view \d+ repl(y|ies)|\d+[smhdw]|hace \d+|\d{1,2}-\d{1,2}|\d+(\.\d+)?k?|me gusta|like|creador|creator|autor)$/i.test(l));
  }

  function buildPrompt(comments, d, extra) {
    const datos = [
      d.precio1 ? 'Precio: ' + U.money(d.precio1) + (d.precio2 ? '; 2 unidades: ' + U.money(d.precio2) : '') : '',
      'Envío: ' + (d.envio || 'a todo el país'),
      'Pago: ' + (d.pago || 'al recibir (contra entrega)'),
      d.demora ? 'Demora: ' + d.demora : '',
      d.talles ? 'Talles: ' + d.talles : '',
      d.garantia ? 'Cambios/garantía: ' + d.garantia : '',
    ]
      .filter(Boolean)
      .join('\n');
    return [
      'Sos community manager de ' + (d.tienda || 'ViaCare') + ', una tienda argentina que vende un corrector de postura con pago contra entrega por anuncios de TikTok.',
      'Escribí una respuesta para cada comentario.',
      '',
      'DATOS DE LA TIENDA (usá solo estos, no inventes plazos, talles ni garantías):',
      datos,
      extra ? 'TONO EXTRA: ' + extra : '',
      '',
      'REGLAS',
      '- Español rioplatense con voseo, cálido y breve. Máximo ' + MAX + ' caracteres por respuesta. Como mucho un emoji.',
      '- Nada de promesas de cura ni claims médicos. Si mencionan una condición de salud, sugerí consultarlo con su médico o kinesiólogo.',
      '- Ante escepticismo, recordá que pagan al recibir, sin discutir.',
      '- Reclamos: pedí disculpas y que escriban por WhatsApp con su número de pedido. Nunca discutas en público.',
      '- Insultos o spam: respuesta vacía y "ocultar": true.',
      '- "video": true si conviene responder con un video (una objeción que se repite y se explica mejor mostrando el producto).',
      '',
      'COMENTARIOS (uno por línea, numerados):',
      comments.map((c, i) => i + 1 + '. ' + c).join('\n'),
      '',
      'Respondé SOLO con JSON: {"respuestas":[{"n":1,"tipo":"precio|envio|pago|compra|talle|comodidad|uso|duda|salud|reclamo|positivo|otro","respuesta":"…","video":false,"ocultar":false}]}',
    ]
      .filter((l) => l !== '')
      .join('\n')
      .replace(/\n(DATOS|REGLAS|COMENTARIOS|Respondé)/g, '\n\n$1');
  }

  const api = { MAX, TIPOS, OTRO, classify, tipo, templateReply, splitComments, buildPrompt, fit, lugar };
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).comments = api;
})(typeof window !== 'undefined' ? window : globalThis);
