import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
let html = readFileSync(new URL('public/design.html', root), 'utf8');
const css = readFileSync(new URL('public/design.css', root), 'utf8');
const js = readFileSync(new URL('public/design.js', root), 'utf8');
html = html.replace('<link rel="stylesheet" href="/design.css">', `<style>${css}</style>`)
  .replace('<script src="/design.js" defer></script>', `<script defer>${js}</script>`)
  .replace('<script defer>', '<script type="module">')
  .replace('href="/">Current demo ↗', 'href="https://github.com/sidevesh/dhanavitree">Project repository ↗');
mkdirSync(new URL('docs/', root), { recursive: true });
writeFileSync(new URL('docs/dhanavi-product-design.html', root), html);
console.log('Exported docs/dhanavi-product-design.html (self-contained, no remote assets).');
