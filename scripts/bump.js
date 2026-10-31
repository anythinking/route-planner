// 배포 전에 한 번 — index.html의 모듈 버전(?v=)을 지금 시각으로 바꾸고 import map을 다시 쓴다.
// 모든 모듈을 같은 버전으로 묶어서, 캐시에 옛 파일과 새 파일이 섞이는 일을 막는다.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const mods = readdirSync('src').filter(f => f.endsWith('.js')).sort();
const map = Object.fromEntries(mods.map(f => [`./src/${f}`, `./src/${f}?v=${v}`]));
const block = `<script type="importmap">${JSON.stringify({ imports: map })}</script>\n` +
  mods.map(f => `<link rel="modulepreload" href="src/${f}?v=${v}">`).join('') +
  `\n<link rel="preload" href="data/cities.json?v=${v}" as="fetch" crossorigin>`;
let html = readFileSync('index.html', 'utf8');
html = html.replace(/<!-- modules -->[\s\S]*?<!-- \/modules -->/, `<!-- modules -->\n${block}\n<!-- /modules -->`);
html = html.replace(/src\/ui\.js\?v=\w+/g, `src/ui.js?v=${v}`).replace(/<script type="module" src="src\/ui\.js[^"]*">/, `<script type="module" src="src/ui.js?v=${v}">`);
writeFileSync('index.html', html);
console.log(`v=${v} · 모듈 ${mods.length}개`);
