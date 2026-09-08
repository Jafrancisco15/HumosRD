import { mkdir, cp, access } from 'node:fs/promises';
await mkdir('dist/vendor', { recursive: true });
await cp('node_modules/leaflet/dist', 'dist/vendor/leaflet', { recursive: true });
for (const f of ['dist/index.html','dist/app.js','dist/automatic.js','dist/request-limit.js','dist/smoke-core.js','dist/localities.json','dist/style.css','dist/enhancements.css','dist/core.js','dist/provinces.geojson','dist/methodology.html']) await access(f);
console.log('HUMOSRD: static assets ready; api/ functions retained for Vercel.');
