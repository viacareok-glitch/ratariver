# Panel ViaCare

Herramientas para la tienda, en un solo panel que se abre desde claude.ai y lee los pedidos de Shopify en vivo.

| Pestaña | Para qué sirve |
| --- | --- |
| **Confirmar pedidos** | Lista los pedidos nuevos (contra entrega) con un botón que abre WhatsApp con el mensaje listo. Marcás *Confirmó / No responde / Canceló* y despachás solo los confirmados. Avisa pedidos repetidos, direcciones sin número y errores de Dropi. Opcional: etiqueta el pedido en Shopify (`WA-confirmado` / `WA-cancelado`). |
| **Ganancia real** | Ventas de Shopify menos producto, envíos, devoluciones, comisión de cobro, costos fijos y anuncios. Proyecta los pedidos abiertos con tus tasas reales de confirmación y entrega. Calcula cuánto podés pagar por pedido (CPA máximo) sin perder. |
| **Creativos** | Subís el reporte de TikTok Ads o Meta (CSV o Excel) y te dice qué anuncio apagar, mantener o escalar, y qué ángulo (dolor, médico, estética, gym) vende más barato. Opcional: lectura de Claude con ganchos nuevos. |
| **Reseñas** | Pedidos entregados → WhatsApp pidiendo opinión y foto. Cargás lo que te responden y, con permiso, lo copiás como CSV para tu app de reseñas. |
| **Guiones UGC** | Elegís ángulo y personaje; Claude escribe guiones divididos en clips de 8 s para Flow, con ficha de continuidad y el prompt de cada clip. Sin Claude, arma guiones con plantillas. |
| **Clientes** | Clientes que ya pagaron, agrupados por WhatsApp. Sugiere la oferta (segunda unidad para la familia, traé un amigo o recompra), arma el mensaje y detecta solo quién volvió a comprar. Puede crear el código de descuento en Shopify. |
| **Competencia** | Links a la Biblioteca de anuncios de Meta (Argentina, activos). Pegás el texto o subís capturas y Claude extrae anunciante, fecha, gancho, ángulo y oferta. Marca los que llevan 21+ días activos y propone creativos nuevos. |
| **Comentarios** | Pegás comentarios de TikTok y arma respuestas de hasta 150 caracteres con los datos reales de la tienda (plantillas o Claude). Biblioteca de respuestas guardadas. |
| **Ofertas** | Compara 1 unidad, 2 unidades, 2x1, 3x2, regalo o lo que cargues: ganancia por pedido después de anuncios, anulados y devoluciones, y cuánta conversión extra necesita cada promo para empatar. |
| **Productos** | Candidatos para vender junto al corrector, con precios de referencia de Mercado Libre, margen con tus tasas, puntaje por demanda, competencia, afinidad, video y riesgo, y opinión de Claude. |
| **Ajustes** | Costos, tasas, datos de la tienda (precios, envío, demora, talles), textos de WhatsApp, descripción del producto para los videos. |

## Cómo se usa

El panel publicado en claude.ai usa:

- **Shopify** (conector de claude.ai) para leer pedidos, etiquetarlos y crear códigos de descuento.
- **Datos del panel** para guardar confirmaciones, gastos, reseñas y ajustes (los ves desde cualquier dispositivo).
- **Claude** para guiones, lectura de creativos, anuncios de la competencia (texto o capturas), respuestas a comentarios y opinión sobre productos.

Si se abre fuera de claude.ai, funciona igual importando el CSV de pedidos de Shopify (*Pedidos → Exportar*) y guarda los datos en el navegador.

## Código

```
app/src/
  lib/        lógica pura (teléfonos AR, estados de pedido, ganancia, creativos, guiones) — con tests
  ui/         una pantalla por herramienta
  runtime.js  conexión con Shopify, datos guardados y Claude
  main.js     pestañas y arranque
  index.html  plantilla
scripts/build.mjs   arma dist/panel-viacare.html (un solo archivo)
tests/              node --test
```

```
npm test        # tests de la lógica
npm run build   # genera dist/panel-viacare.html
```

Sin dependencias. El lector de Excel (SheetJS) se carga desde cdnjs solo cuando subís un `.xlsx`.
