// Arma dist/panel-viacare.html: un solo archivo con el CSS y el JS de app/src incrustados.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'app', 'src');
const out = join(root, 'dist', 'panel-viacare.html');

let html = readFileSync(join(src, 'index.html'), 'utf8');
html = html.replace(/\/\* @inline ([\w./-]+) \*\//g, (_, file) => {
  const code = readFileSync(join(src, file), 'utf8').trim();
  if (/<\/script/i.test(code)) throw new Error(file + ' contiene "</script" y rompería el HTML');
  return '/* ' + file + ' */\n' + code;
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log('OK → ' + out + ' (' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB)');
