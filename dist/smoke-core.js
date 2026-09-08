import {distance} from './core.js';
export const STEP = 600000;
export function summarizeLocality(frames, name) {
  const samples=frames.filter(f=>f.status==='ok').map(f=>({at:f.at,local:f.localities?.find(l=>l.name===name)})).filter(s=>s.local);
  const useful=samples.filter(s=>s.local.usablePixels>0), smoke=samples.filter(s=>s.local.detectedPixels>0);
  const coverage=frames.length?samples.reduce((sum,s)=>sum+s.local.usableFraction,0)/frames.length:0;
  return {name,requestedFrames:frames.length,diagnosticFrames:samples.length,usefulFrames:useful.length,
    smokeFrames:smoke.length,coverage,cloudFrames:samples.filter(s=>s.local.cloudPixels>0).length,
    invalidQualityFrames:samples.filter(s=>s.local.invalidQualityPixels>0).length,
    verdict:smoke.length?'smoke_detected':!useful.length?'unobservable':'not_confirmed',
    lastDetection:smoke.at(-1)?.at||null};
}
export function observationVerdict(frames) {
  const valid=frames.filter(f=>f.status==='ok');
  if(!valid.length)return 'SIN DATOS: no se recibió ninguna escena procesable. No se puede evaluar el humo.';
  if(!valid.some(f=>f.coverage.usablePixels>0))return 'SIN OBSERVACIÓN ÚTIL: las escenas no permiten evaluar humo. No se puede confirmar ni descartar el episodio; los reportes en tierra siguen pendientes de contraste.';
  if(!valid.some(f=>f.components.length))return 'SIN CONFIRMACIÓN SATELITAL en los píxeles evaluables. No descarta humo local, pequeño o cubierto.';
  return 'HUMO DETECTADO: revisa las huellas, la cobertura y las fuentes candidatas.';
}
export function frameSlots(begin, end) {
  if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin || end-begin > 86400000) throw new Error('Elige un intervalo de hasta 24 horas, con Desde anterior a Hasta.');
  // Whole 10-minute acquisitions inside the requested span; no observations outside it.
  const slots = [];
  for (let t = Math.ceil(begin/STEP)*STEP; t+STEP <= end; t += STEP) slots.push(t);
  if (!slots.length) throw new Error('El intervalo debe incluir al menos una escena completa de 10 minutos.');
  return slots;
}
export function trackSmoke(frames) {
  const tracks = [];
  for (const frame of [...frames].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))) {
    if (frame.status !== 'ok') continue;
    const at = Date.parse(frame.at), used = new Set(), associations = [];
    for (const component of frame.components) {
      for (const track of tracks) {
        const previous = track.samples.at(-1), dt = at-previous.at;
        // Never bridge a missing acquisition or a large spatial jump.
        if (dt <= 0 || dt > STEP+60000) continue;
        const gap = distance(component.center, previous.center);
        const old = new Set(previous.cells), overlap = component.cells.filter(cell=>old.has(cell)).length;
        if (overlap > 0 || gap <= 6) associations.push({track, component, score:overlap/Math.max(component.cells.length,previous.cells.length)*100-gap});
      }
    }
    const taken = new Set();
    for (const item of associations.sort((a,b)=>b.score-a.score)) {
      if (used.has(item.component.id) || taken.has(item.track.id)) continue;
      item.track.samples.push({...item.component,at});
      used.add(item.component.id); taken.add(item.track.id);
    }
    for (const component of frame.components) {
      if (!used.has(component.id)) tracks.push({id:tracks.length+1,samples:[{...component,at}]});
    }
  }
  return tracks;
}
export function rankOrigins(track, fires) {
  const first = track.samples[0], next = track.samples[1];
  // Two observations are required for any directional attribution.
  if (!next) return [];
  const motion = distance(first.center,next.center);
  if (motion < 1) return [];
  const radius = Math.min(15, Math.sqrt(first.areaKm2/Math.PI)+3);
  return fires.filter(f=>Number.isFinite(f.at) && f.at<=first.at && first.at-f.at<=3*3600000)
    .map(f=>({...f, gap:distance(first.center,[f.lat,f.lon]), downstream:distance(next.center,[f.lat,f.lon])}))
    .filter(f=>f.gap<=radius && f.downstream>f.gap+.5)
    .sort((a,b)=>a.gap-b.gap).slice(0,3);
}
export function containsPoint(ring, [lat,lon]) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    if ((yi>lat)!==(yj>lat) && lon<(xj-xi)*(lat-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
export function observedPlaces(frame, places) {
  if (frame.status!=='ok') return [];
  return places.filter(([,lat,lon])=>frame.mask.features.some(f=>containsPoint(f.geometry.coordinates[0],[lat,lon]))).map(p=>p[0]);
}
