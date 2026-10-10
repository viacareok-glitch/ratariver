/* Lógica pura: guiones automáticos (Agente D) */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const api = {};
  if (isNode) module.exports = api;
  else (root.VC = root.VC || {}).autoplan = api;
})(typeof window !== 'undefined' ? window : globalThis);
