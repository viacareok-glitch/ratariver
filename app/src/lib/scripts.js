/* Guiones UGC para Flow (Veo): clips de 8 segundos con continuidad resuelta. */
(function (root) {
  'use strict';
  const U = typeof module === 'object' && module.exports ? require('./util.js') : root.VC.util;

  const CLIP_SECONDS = 8;
  const MAX_WORDS = 20; // ~2,5 palabras por segundo en voz natural

  const ANGULOS = {
    dolor: {
      label: 'Dolor',
      brief: 'La persona sufre dolor o tensión de espalda/cuello por horas sentada o con el celular. Se identifica con el problema, prueba el corrector y siente alivio y menos tensión con el uso diario.',
    },
    medico: {
      label: 'Médico',
      brief: 'Tono explicativo y creíble: la persona cuenta lo que le explicó su kinesiólogo/a sobre la postura (hombros adelantados, cervicales cargadas) y cómo el corrector le sirve de recordatorio. NO se presenta como médico ni muestra credenciales.',
    },
    estetica: {
      label: 'Estética',
      brief: 'Verse mejor: hombros hacia atrás, porte más erguido, la ropa queda mejor, más seguridad. Comparación de postura natural (sin exagerar cambios corporales).',
    },
    gym: {
      label: 'Gym',
      brief: 'Persona que entrena: la mala postura de la oficina le arruina la técnica y le carga la espalda. Usa el corrector durante el día para llegar mejor al entrenamiento.',
    },
  };

  const PERSONAJES = {
    oficinista: {
      g: 'f',
      label: 'Mujer 35, home office',
      es: 'Mujer argentina de 35 años, pelo castaño lacio atado en una colita baja, remera lisa gris clara, maquillaje natural. Escritorio de home office con notebook, taza y una planta; luz natural de ventana desde la izquierda.',
      en: 'A 35-year-old Argentine woman, straight brown hair in a low ponytail, plain light grey t-shirt, natural makeup. Home-office desk with a laptop, a mug and a plant; soft natural window light from the left.',
    },
    oficinista_h: {
      g: 'm',
      label: 'Hombre 45, oficina',
      es: 'Hombre argentino de 45 años, barba corta con canas, camisa celeste arremangada. Oficina luminosa con escritorio y monitor; luz fría de oficina.',
      en: 'A 45-year-old Argentine man, short greying beard, light-blue shirt with rolled sleeves. Bright office with a desk and monitor; cool office lighting.',
    },
    senior: {
      g: 'f',
      label: 'Mujer 55, casa',
      es: 'Mujer argentina de 55 años, pelo corto rubio ceniza, sweater bordó liviano, anteojos colgando del cuello. Cocina-comedor de casa con mesa de madera; luz cálida de tarde.',
      en: 'A 55-year-old Argentine woman, short ash-blonde hair, light burgundy sweater, reading glasses hanging on her neck. Home kitchen-dining room with a wooden table; warm afternoon light.',
    },
    joven: {
      g: 'm',
      label: 'Chico 24, estudiante/gamer',
      es: 'Chico argentino de 24 años, pelo oscuro despeinado, buzo negro liso. Habitación con escritorio, monitor y luces LED violetas de fondo; luz del monitor en la cara.',
      en: 'A 24-year-old Argentine guy, messy dark hair, plain black hoodie. Bedroom desk setup with a monitor and purple LED strip lights behind; monitor light on his face.',
    },
    fit_m: {
      g: 'f',
      label: 'Mujer 28, gym',
      es: 'Mujer argentina de 28 años, pelo largo oscuro en colita alta, top deportivo negro y calza gris. Gimnasio con mancuernas y espejo; luz cenital.',
      en: 'A 28-year-old Argentine woman, long dark hair in a high ponytail, black sports top and grey leggings. Gym with dumbbells and a mirror; overhead lighting.',
    },
    fit_h: {
      g: 'm',
      label: 'Hombre 32, gym',
      es: 'Hombre argentino de 32 años, pelo corto, musculosa gris oscuro. Gimnasio con barras y discos; luz cenital.',
      en: 'A 32-year-old Argentine man, short hair, dark grey tank top. Gym with barbells and plates; overhead lighting.',
    },
  };

  const PRODUCTO_DEFAULT =
    'corrector de postura ViaCare: arnés ajustable tipo chaleco, negro, con dos tiras que pasan por los hombros y se cruzan en la espalda; se usa debajo o encima de la remera';

  function wordCount(s) {
    return String(s || '').trim().split(/\s+/).filter(Boolean).length;
  }

  /* Prompt para Claude: devuelve JSON con los guiones. */
  function buildPrompt(opts) {
    const a = ANGULOS[opts.angulo] || { label: opts.angulo, brief: opts.anguloLibre || opts.angulo };
    const per = opts.personajeLibre || (PERSONAJES[opts.personaje] || PERSONAJES.oficinista)[opts.idiomaPrompt === 'es' ? 'es' : 'en'];
    const idioma = opts.idiomaPrompt === 'es' ? 'español' : 'inglés';
    const clips = U.clamp(Number(opts.clips) || 4, 2, 8);
    const n = U.clamp(Number(opts.cantidad) || 3, 1, 5);
    return [
      'Sos guionista de anuncios UGC para TikTok y Reels de una tienda argentina. Escribí ' + n + ' guiones distintos para generar con Google Flow (Veo), que crea clips de video de ' + CLIP_SECONDS + ' segundos con audio.',
      '',
      'PRODUCTO: ' + (opts.producto || PRODUCTO_DEFAULT) + '.',
      'OFERTA: ' + (opts.oferta || 'Pagás al recibir.') + '.',
      'ÁNGULO: ' + a.label + '. ' + a.brief,
      'PERSONAJE Y LUGAR BASE: ' + per,
      opts.extra ? 'PEDIDO EXTRA: ' + opts.extra : '',
      '',
      'REGLAS DEL GUION',
      '- Cada guion tiene exactamente ' + clips + ' clips de ' + CLIP_SECONDS + ' s (total ' + clips * CLIP_SECONDS + ' s). Video vertical 9:16, estilo selfie grabado con el celular, sin look publicitario.',
      '- El clip 1 abre con un gancho fuerte en los primeros 2 segundos. El último clip cierra con la oferta y una llamada a la acción.',
      '- Diálogo en español rioplatense con voseo, natural, como habla la gente. Máximo ' + MAX_WORDS + ' palabras por clip para que entre en ' + CLIP_SECONDS + ' segundos.',
      '- Los ' + n + ' guiones usan ganchos y estructuras distintas entre sí (por ejemplo: confesión, pregunta, error común, demostración, reacción).',
      '',
      'CONTINUIDAD (lo más importante)',
      '- Escribí una "ficha" de continuidad por guion, en ' + idioma + ': rasgos físicos exactos, ropa, cómo se ve el producto puesto, lugar, luz, tipo de cámara y la voz (edad, tono, acento argentino). Mismo personaje en todos los clips.',
      '- El "prompt" de cada clip debe ser autosuficiente y estar en ' + idioma + ': empieza copiando la ficha completa palabra por palabra, después describe la escena, la acción, el movimiento de cámara y el audio ambiente, e incluye el diálogo exacto entre comillas indicando "spoken in Argentine Spanish" (o "hablado en español rioplatense"). Terminá cada prompt con: no subtitles, no on-screen text, no music (o su equivalente en español).',
      '- Del clip 2 en adelante, el prompt arranca desde la pose y el encuadre exactos en que terminó el clip anterior. En "continuidad" explicá en español cómo empalmar (por ejemplo: "Usá el último cuadro del clip 1 como imagen inicial en Flow (Frames to Video / Extend)").',
      '- Nada de saltos de vestuario, peinado, lugar o luz entre clips salvo que el guion lo pida explícitamente.',
      '',
      'POLÍTICAS DE TIKTOK Y META (obligatorio)',
      '- Sin promesas de cura ni resultados garantizados: nada de "elimina el dolor", "cura", "para siempre". Usá "me ayuda", "siento menos tensión", "me acuerda de enderezarme".',
      '- Nadie dice ser médico ni muestra credenciales, guardapolvo o consultorio. Para autoridad, el personaje cuenta lo que le dijo su kinesiólogo/a.',
      '- Sin antes/después con cambios corporales exagerados. Sin dramatizar con sangre, lesiones ni ambulancias.',
      '',
      'FORMATO: respondé SOLO con JSON válido, sin texto antes ni después, con esta forma:',
      '{"guiones":[{"titulo":"…","gancho":"tipo de gancho en 2-4 palabras","ficha":"…","clips":[{"n":1,"plano":"tipo de plano y cámara, en español","accion":"qué pasa, en español","dialogo":"…","texto_pantalla":"texto corto para sumar en edición o vacío","prompt":"…","continuidad":"…"}],"caption":"texto del posteo con 2-3 hashtags","nota":"por qué debería funcionar, una oración"}]}',
    ]
      .filter((l) => l !== '')
      .join('\n')
      .replace(/\n(REGLAS|CONTINUIDAD|POLÍTICAS|FORMATO)/g, '\n\n$1');
  }

  /* Valida y completa lo que devuelve Claude para que la interfaz no se rompa con un campo faltante. */
  function sanitize(data, opts) {
    const list = Array.isArray(data) ? data : data && Array.isArray(data.guiones) ? data.guiones : [];
    return list
      .filter((g) => g && Array.isArray(g.clips) && g.clips.length)
      .map((g, i) => ({
        titulo: String(g.titulo || 'Guion ' + (i + 1)),
        gancho: String(g.gancho || ''),
        ficha: String(g.ficha || ''),
        caption: String(g.caption || ''),
        nota: String(g.nota || ''),
        angulo: opts && opts.angulo,
        clips: g.clips.map((c, j) => ({
          n: j + 1,
          desde: j * CLIP_SECONDS,
          hasta: (j + 1) * CLIP_SECONDS,
          plano: String(c.plano || ''),
          accion: String(c.accion || ''),
          dialogo: String(c.dialogo || ''),
          texto_pantalla: String(c.texto_pantalla || ''),
          prompt: String(c.prompt || ''),
          continuidad: String(c.continuidad || ''),
          palabras: wordCount(c.dialogo),
          largo: wordCount(c.dialogo) > MAX_WORDS,
        })),
      }));
  }

  /* ---------- Generador sin IA (plantillas) para cuando Claude no está disponible ---------- */

  const BANCO = {
    dolor: {
      ganchos: [
        ['Confesión', 'Te juro que pensé que este dolor de espalda era normal después de ocho horas sentada.'],
        ['Pregunta', '¿A vos también te duele el cuello cuando terminás de trabajar? Mirá esto.'],
        ['Error común', 'Yo me masajeaba el cuello todas las noches y el problema era otro.'],
      ],
      medio: [
        'Me pasaba horas encorvada con la compu y a la tarde no aguantaba la tensión en los hombros.',
        'Me lo pongo a la mañana, se ajusta en segundos y ni se nota abajo de la remera.',
        'Ahora cuando me empiezo a encorvar lo siento y me enderezo sola. Llego al final del día mucho más liviana.',
        'Lo uso un rato por día, no todo el día. Es como un recordatorio para la espalda.',
      ],
    },
    medico: {
      ganchos: [
        ['Consejo', 'Mi kinesióloga me dijo algo que me cambió la forma de sentarme.'],
        ['Dato', 'Cuando bajás la cabeza para mirar el celu, el cuello carga mucho más peso del que pensás.'],
        ['Error común', 'El problema no es la silla, me explicó mi kinesiólogo. Son los hombros hacia adelante.'],
      ],
      medio: [
        'Me explicó que con los hombros adelantados la espalda y el cuello trabajan de más todo el día.',
        'Me recomendó algo que me recuerde la postura mientras trabajo. Probé este corrector.',
        'Tira los hombros suavemente hacia atrás y cuando me encorvo lo noto enseguida.',
        'Se regula con estas tiras y lo uso un rato por día, como me sugirieron.',
      ],
    },
    estetica: {
      ganchos: [
        ['Reacción', 'Mirá la diferencia en cómo me queda la remera solo con pararme derecha.'],
        ['Confesión', 'En todas las fotos salía encorvada y no entendía por qué.'],
        ['Demostración', 'Misma ropa, misma persona. Lo único que cambió es la postura.'],
      ],
      medio: [
        'Tenía los hombros siempre para adelante y me veía cansada aunque no lo estuviera.',
        'Me pongo el corrector abajo de la ropa, ajusto las tiras y listo, no se ve.',
        'Ahora me paro más derecha sin pensarlo y la ropa me queda de otra manera.',
        'Me siento más segura, hasta en las videollamadas se nota.',
      ],
    },
    gym: {
      ganchos: [
        ['Error común', 'Entrenaba cuatro veces por semana y la postura de la oficina me arruinaba todo.'],
        ['Pregunta', '¿Llegás al gym con la espalda cargada de estar sentado todo el día?'],
        ['Confesión', 'Mi técnica en el press estaba mal y no era por falta de fuerza.'],
      ],
      medio: [
        'Ocho horas encorvado en la compu y después querés hacer remo con la espalda perfecta. No da.',
        'Uso el corrector mientras trabajo, me mantiene los hombros atrás sin pensar.',
        'Llego al entrenamiento con la postura más activada y lo siento en cada ejercicio.',
        'Es liviano, se ajusta rápido y lo uso un rato por día.',
      ],
    },
  };

  const CIERRES = [
    'Lo pedí desde la página y lo pagás cuando te llega. Tocá el link y fijate.',
    'Lo mejor: lo pagás al recibirlo. El link está acá abajo.',
    'Si te pasa lo mismo, pedilo ahora y pagás cuando te llega a tu casa.',
  ];

  const PLANOS = [
    'Primer plano, selfie a la altura de los ojos, cámara en mano',
    'Plano medio, celular apoyado, leve movimiento de cámara',
    'Plano detalle de las manos ajustando las tiras, luego vuelve a plano medio',
    'Plano medio de perfil para mostrar la postura, cámara fija',
    'Selfie cercana, cámara en mano, leve paneo',
    'Plano medio frontal, cámara fija',
  ];

  // Ajusta el género de las frases de plantilla al personaje elegido
  const MASC = [
    [/\bencorvada\b/g, 'encorvado'],
    [/\bsola\b/g, 'solo'],
    [/\bsegura\b/g, 'seguro'],
    [/\bliviana\b/g, 'liviano'],
    [/\bcansada\b/g, 'cansado'],
    [/\bsentada\b/g, 'sentado'],
    [/\bderecha\b/g, 'derecho'],
    [/\bMi kinesióloga\b/g, 'Mi kinesiólogo'],
  ];
  function gender(text, g) {
    if (g !== 'm') return text;
    return MASC.reduce((t, [re, rep]) => t.replace(re, rep), text);
  }

  function pick(arr, i) {
    return arr[((i % arr.length) + arr.length) % arr.length];
  }

  function fallbackScripts(opts) {
    const key = BANCO[opts.angulo] ? opts.angulo : 'dolor';
    const banco = BANCO[key];
    const en = opts.idiomaPrompt !== 'es';
    const preset = PERSONAJES[opts.personaje] || PERSONAJES.oficinista;
    const per = opts.personajeLibre || preset[en ? 'en' : 'es'];
    const g = opts.personajeLibre ? opts.genero || 'f' : preset.g;
    const producto = opts.producto || PRODUCTO_DEFAULT;
    const n = U.clamp(Number(opts.cantidad) || 3, 1, 5);
    const clips = U.clamp(Number(opts.clips) || 4, 2, 8);
    const out = [];
    for (let i = 0; i < n; i++) {
      const [gancho, hook] = pick(banco.ganchos, i);
      const ficha = en
        ? per + ' Wearing the product: ' + producto + ' (product description in Spanish). Vertical 9:16 selfie-style smartphone video, handheld, realistic UGC look. Voice: natural, warm, Argentine Spanish accent.'
        : per + ' Lleva puesto el producto: ' + producto + '. Video vertical 9:16 estilo selfie con celular, cámara en mano, look UGC realista. Voz natural y cálida, acento rioplatense.';
      const dialogos = [hook];
      for (let j = 1; j < clips - 1; j++) dialogos.push(pick(banco.medio, i + j - 1));
      dialogos.push(pick(CIERRES, i));
      for (let j = 0; j < dialogos.length; j++) dialogos[j] = gender(dialogos[j], g);
      const clipList = dialogos.map((d, j) => {
        const plano = j === 0 ? PLANOS[0] : pick(PLANOS, j + i);
        const accion =
          j === 0
            ? 'Mira a cámara y dice el gancho con gesto de identificación.'
            : j === clips - 1
              ? 'Sonríe, señala hacia abajo (donde va el link) y termina la frase mirando a cámara.'
              : j === 1
                ? 'Muestra el problema: se encorva frente a la pantalla y se toca el cuello o los hombros.'
                : 'Muestra el corrector puesto y ajusta las tiras; se endereza con naturalidad.';
        const prev = j === 0 ? '' : en ? 'Continues exactly from the final frame of the previous clip, same framing and pose. ' : 'Continúa exactamente desde el último cuadro del clip anterior, mismo encuadre y pose. ';
        const prompt = en
          ? ficha + ' ' + prev + 'Shot: ' + plano + '. Action: ' + accion + ' The person says, spoken in Argentine Spanish: "' + d + '" Ambient room sound. No subtitles, no on-screen text, no music.'
          : ficha + ' ' + prev + 'Plano: ' + plano + '. Acción: ' + accion + ' Dice, hablado en español rioplatense: "' + d + '" Sonido ambiente del lugar. Sin subtítulos, sin texto en pantalla, sin música.';
        return {
          plano,
          accion,
          dialogo: d,
          texto_pantalla: j === 0 ? d.split(/[.?!]/)[0] : j === clips - 1 ? 'Pagás al recibir' : '',
          prompt,
          continuidad: j === 0 ? 'Generá este clip primero y elegí la mejor toma: define la cara y la ropa de todo el guion.' : 'En Flow usá "Extend" o tomá el último cuadro del clip ' + j + ' como imagen inicial (Frames to Video).',
        };
      });
      out.push({ titulo: ANGULOS[key].label + ' · ' + gancho, gancho, ficha, clips: clipList, caption: '', nota: 'Generado con plantillas (sin IA). Ajustá el diálogo a tu forma de hablar.' });
    }
    return sanitize({ guiones: out }, opts);
  }

  function scriptAsText(g) {
    const lines = [g.titulo, g.gancho ? 'Gancho: ' + g.gancho : '', '', 'FICHA DE CONTINUIDAD', g.ficha, ''];
    for (const c of g.clips) {
      lines.push('CLIP ' + c.n + ' (' + c.desde + '–' + c.hasta + ' s) · ' + c.plano);
      lines.push('Acción: ' + c.accion);
      lines.push('Diálogo: "' + c.dialogo + '"');
      if (c.texto_pantalla) lines.push('Texto en pantalla: ' + c.texto_pantalla);
      lines.push('Prompt para Flow:');
      lines.push(c.prompt);
      if (c.continuidad) lines.push('Continuidad: ' + c.continuidad);
      lines.push('');
    }
    if (g.caption) lines.push('Caption: ' + g.caption);
    return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();
  }

  const api = { CLIP_SECONDS, MAX_WORDS, ANGULOS, PERSONAJES, PRODUCTO_DEFAULT, buildPrompt, sanitize, fallbackScripts, scriptAsText, wordCount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.VC = root.VC || {}).scripts = api;
})(typeof window !== 'undefined' ? window : globalThis);
