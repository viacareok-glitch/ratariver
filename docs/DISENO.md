# Guía de diseño del Panel ViaCare

El panel es una herramienta personal: tiene que verse lindo, ser fácil y no cansar con texto.

## Principios

1. **Menos texto.** Cada pantalla tiene un título y, como mucho, una línea corta debajo (60 caracteres o menos). Nada de párrafos. Las explicaciones van dentro de un `info()` (el "?" que se abre si lo tocan) o se sacan.
2. **Resumen primero.** Arriba van los números que importan (2 a 4 tarjetas `.stat`), después la lista o la acción.
3. **Una acción principal por bloque.** Un solo botón azul (`.btn`) por panel. El resto es `.btn.ghost`, `.btn.soft`, `.btn.link` o va adentro de `more('Opciones', …)`.
4. **Configuración escondida.** Lo que se toca una vez (opciones, búsquedas, plantillas, columnas detectadas) va plegado con `more()`.
5. **Íconos, no emojis.** `icon(nombre)` en botones, títulos de panel (`bubble(nombre, tono)`) y estados vacíos.
6. **Etiquetas cortas.** Botones de 1 a 3 palabras ("Escanear ahora", "Copiar", "Generar"). Estados con chips (`chip(texto, tono)`).
7. **Estados vacíos amables.** `emptyState(título, texto corto, acciones, ícono)`: título de 2 a 4 palabras y una línea.
8. **Avisos solo para lo que bloquea.** `banner()` es para errores o cosas que faltan (costos sin cargar). Lo informativo va en `info()` o en una línea `.note`.

## Piezas (en `app/src/ui/common.js`)

| Función | Para qué |
| --- | --- |
| `pageHead(título, subtítulo, accionesHtml)` | Encabezado de cada herramienta. |
| `icon(nombre)` / `bubble(nombre, tono)` | Íconos lineales; `bubble` los pone en un círculo de color (tonos: `good`, `warn`, `bad`, `peach`, `source`, `wa`, o vacío para azul). Nombres en `ICONS`. |
| `info(html)` | Botón "?" que muestra una explicación. |
| `more(etiqueta, html, id)` | Sección plegable "Opciones", "Cómo se usa", etc. |
| `toggle(id, encendido, etiqueta, attrs)` | Interruptor. |
| `chip(texto, tono)` | Estado chico. |
| `seg(nombre, opciones, actual)` | Filtros en forma de pastillas. |
| `emptyState(título, texto, acciones, ícono)` | Lista vacía. |
| `banner(tono, html, acciones)` | Solo errores o bloqueos. |

Clases útiles: `.panel` (tarjeta), `.panel-head` + `.panel-title` (título con burbuja), `.summary-strip` + `.stat` (números), `.btn` (`.ghost`, `.soft`, `.wa`, `.link`, `.sm`, `.icon-only`), `.chips`, `.row-actions`, `.form-grid`, `.note`, `.muted`, `.small`, `.table`.

## Paneles automáticos

Una sola fila arriba: burbuja `zap` durazno, título, una línea de estado ("Última vez hace 3 h · 4 nuevos") y el botón principal a la derecha ("Escanear ahora"; mientras corre, "Detener"). El progreso aparece solo mientras corre. Las opciones (hacerlo solo, cada cuántas horas, búsquedas) van en `more('Opciones', …)`. Si falta el navegador o Claude: una línea `.note` con ícono y un `info()` que explique cómo activarlo.

## Colores y letra

Todo sale de los tokens de `styles.css` (`--accent`, `--peach`, `--good`, `--warn`, `--bad`, `--muted`, `--faint`, `--surface`, `--surface-2`, `--line`…), que ya tienen versión clara y oscura. Nunca colores literales. Letra: Plus Jakarta Sans; JetBrains Mono solo para códigos, números de pedido y prompts.

## Referencias

`ui/inicio.js` y `ui/confirmar.js` ya siguen esta guía.
