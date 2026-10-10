/* Lógica pura: tiendas de la competencia (Agente B) */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const api = {};
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).stores = api;
})(typeof window !== 'undefined' ? window : globalThis);
