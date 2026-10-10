/* Lógica pura: competencia automática (Agente A) */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const api = {};
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).scan = api;
})(typeof window !== 'undefined' ? window : globalThis);
