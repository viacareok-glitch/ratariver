/* Utilidades compartidas: dinero, números, fechas en hora argentina, teléfonos, CSV, plantillas. */
(function (root) {
  'use strict';

  const AR_OFFSET_MS = 3 * 3600 * 1000; // Argentina: UTC-3 todo el año

  function dayKeyAR(input) {
    const t = input instanceof Date ? input.getTime() : Date.parse(input);
    if (!Number.isFinite(t)) return '';
    return new Date(t - AR_OFFSET_MS).toISOString().slice(0, 10);
  }

  function todayKeyAR(now) {
    return dayKeyAR(now || new Date());
  }

  function addDays(dayKey, n) {
    const d = new Date(dayKey + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Inicio del día argentino en UTC ISO (00:00 AR = 03:00Z)
  function dayStartUTC(dayKey) {
    return dayKey + 'T03:00:00Z';
  }

  function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  }

  function dayRange(from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  function fmtDay(dayKey, withWeekday) {
    const d = new Date(dayKey + 'T12:00:00Z');
    const base = d.getUTCDate() + ' ' + MESES[d.getUTCMonth()];
    return withWeekday ? DIAS[d.getUTCDay()] + ' ' + base : base;
  }

  function fmtDateTimeAR(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t - AR_OFFSET_MS);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()] + ' ' + hh + ':' + mm;
  }

  function timeAgo(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, ((now || Date.now()) - t) / 1000);
    if (s < 60) return 'recién';
    if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h';
    const d = Math.floor(s / 86400);
    return d === 1 ? 'hace 1 día' : 'hace ' + d + ' días';
  }

  function hoursSince(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return Infinity;
    return ((now || Date.now()) - t) / 3600000;
  }

  // $ 72.990 (pesos argentinos, sin decimales)
  function money(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Math.round(Number(n));
    const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (v < 0 ? '−$ ' : '$ ') + s;
  }

  function moneyShort(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    const a = Math.abs(v);
    const sign = v < 0 ? '−' : '';
    if (a >= 1e6) return sign + '$ ' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + ' M';
    if (a >= 1e3) return sign + '$ ' + Math.round(a / 1e3) + ' k';
    return sign + '$ ' + Math.round(a);
  }

  function pct(n, digits) {
    if (n == null || !Number.isFinite(n)) return '—';
    return (n * 100).toFixed(digits == null ? 0 : digits).replace('.', ',') + '%';
  }

  function int(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /*
   * Convierte números de exportaciones (Meta, TikTok, Shopify) en ES o EN:
   * "1.234,56" · "1,234.56" · "1234.56" · "12,5" · "3,2%" · "$ 1.500" · "ARS 2.300,00"
   */
  function parseNum(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    let s = String(raw).trim();
    if (!s || s === '-' || s === '--' || /^n\/?a$/i.test(s)) return null;
    s = s.replace(/[^\d.,\-−]/g, '').replace('−', '-');
    if (!s || s === '-') return null;
    const hasDot = s.includes('.');
    const hasComma = s.includes(',');
    if (hasDot && hasComma) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (hasComma) {
      if (/^-?\d{1,3}(,\d{3})+$/.test(s) && s.split(',').length > 2) s = s.replace(/,/g, '');
      else if (/^-?\d{1,3},\d{3}$/.test(s)) s = s.replace(',', ''); // 1,234 → mil
      else s = s.replace(',', '.');
    } else if (hasDot) {
      if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /* Montos en pesos tipeados a mano: el punto siempre es separador de miles ("12.000" → 12000, "1.500,5" → 1500.5). */
  function parseMoney(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const s = String(raw).replace(/[^\d.,\-−]/g, '').replace('−', '-').replace(/\./g, '').replace(',', '.');
    if (!s || s === '-') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function capitalizeName(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/(^|[\s'-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
  }

  function firstName(s) {
    const n = capitalizeName(s).split(/\s+/)[0] || '';
    return n;
  }

  /*
   * Normaliza un teléfono argentino al formato que usa WhatsApp: 549 + área + número (13 dígitos).
   * Acepta: "1170302470", "+541170302470", "011 15 7030-2470", "5491170302470", "0341 155 123456".
   */
  function normalizePhoneAR(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return { wa: '', ok: false, display: '' };
    if (d.startsWith('00')) d = d.slice(2);
    let rest;
    if (d.startsWith('54') && d.length >= 11) {
      rest = d.slice(2);
      if (rest.startsWith('9') && rest.length === 11) rest = rest.slice(1);
    } else if (d.length > 11 && !d.startsWith('0')) {
      // Número de otro país: se usa tal cual
      return { wa: d, ok: d.length >= 11 && d.length <= 15, display: '+' + d };
    } else {
      rest = d;
    }
    if (rest.startsWith('0')) rest = rest.slice(1);
    if (rest.length === 12) {
      // Quita el "15" de celular que va después del código de área (2 a 4 dígitos)
      for (const pos of [2, 3, 4]) {
        if (rest.substr(pos, 2) === '15') {
          rest = rest.slice(0, pos) + rest.slice(pos + 2);
          break;
        }
      }
    }
    const ok = rest.length === 10;
    const wa = '549' + rest;
    return { wa, ok, display: ok ? formatPhoneDisplay(rest) : '+' + wa };
  }

  function formatPhoneDisplay(rest10) {
    // Área de 2 dígitos (11 = AMBA) o 3/4 genérico
    if (rest10.startsWith('11')) return '11 ' + rest10.slice(2, 6) + '-' + rest10.slice(6);
    return rest10.slice(0, 3) + ' ' + rest10.slice(3, 6) + '-' + rest10.slice(6);
  }

  function waLink(wa, text) {
    if (!wa) return '';
    return 'https://wa.me/' + wa + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  // Reemplaza {clave} por valores; deja las claves desconocidas como están
  function fillTemplate(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m
    );
  }

  /* CSV robusto: comillas, saltos de línea dentro de campos, separador , ; o tab autodetectado. */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of firstLine) {
      if (ch === '"') q = !q;
      else if (!q && ch in counts) counts[ch]++;
    }
    const sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === sep) {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (row.some((c) => c !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((c) => c !== '')) rows.push(row);
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map((h) => h.trim());
    const objs = rows.slice(1).map((r) => {
      const o = {};
      headers.forEach((h, i) => (o[h] = r[i] != null ? r[i].trim() : ''));
      return o;
    });
    return { headers, rows: objs };
  }

  function toCSV(headers, rows) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [headers.map(esc).join(',')].concat(rows.map((r) => headers.map((h) => esc(r[h])).join(','))).join('\n');
  }

  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }

  function sum(arr, fn) {
    let s = 0;
    for (const x of arr) s += fn ? fn(x) || 0 : x || 0;
    return s;
  }

  function legacyId(gid) {
    const m = String(gid || '').match(/(\d+)$/);
    return m ? m[1] : String(gid || '').replace(/[^\w.-]/g, '_');
  }

  const api = {
    AR_OFFSET_MS,
    dayKeyAR,
    todayKeyAR,
    addDays,
    dayStartUTC,
    daysBetween,
    dayRange,
    fmtDay,
    fmtDateTimeAR,
    timeAgo,
    hoursSince,
    money,
    moneyShort,
    pct,
    int,
    parseNum,
    parseMoney,
    stripAccents,
    escapeHtml,
    capitalizeName,
    firstName,
    normalizePhoneAR,
    waLink,
    fillTemplate,
    parseCSV,
    toCSV,
    clamp,
    sum,
    legacyId,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.VC = root.VC || {}).util = api;
})(typeof window !== 'undefined' ? window : globalThis);
