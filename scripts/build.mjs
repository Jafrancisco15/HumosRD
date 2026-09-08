import { mkdir, cp, access } from 'node:fs/promises';
await mkdir('dist/vendor', { recursive: true });
await cp('node_modules/leaflet/dist', 'dist/vendor/leaflet', { recursive: true });
for (const f of ['dist/index.html','dist/app.js','dist/style.css','dist/core.js','dist/provinces.geojson']) await access(f);
console.log('HUMOSRD: static assets ready; api/ functions retained for Vercel.');
