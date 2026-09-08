export const BBOX = [-70.4, 18.1, -69.2, 19.1];
export function distance(a,b) {
  const r=Math.PI/180, dlat=(b[0]-a[0])*r, dlon=(b[1]-a[1])*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dlon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function destination(p,bearing,km) {
  const r=Math.PI/180, b=bearing*r, d=km/6371, lat=p[0]*r, lon=p[1]*r;
  const lat2=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(b));
  return [lat2/r,(lon+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(lat2)))/r];
}
// Hourly winds at a single grid point; not a 3D dispersion model.
export function trajectory(origin, start, hours, hourly, level='80m', backwards=false, offset=0, scale=1) {
  if(!Number.isFinite(hours)||hours<=0) throw new Error('La duración debe ser positiva.');
  const steps=Math.round(hours*6);
  if(Math.abs(steps-hours*6)>1e-9) throw new Error('La duración debe expresarse en pasos completos de 10 minutos.');
  let p=[...origin]; const points=[p], times=[start];
  for(let s=0;s<steps;s++) {
    const t=start+(backwards?-1:1)*(s+.5)*600000;
    const i=hourly.time.findIndex(x=>Math.floor(x/3600000)===Math.floor(t/3600000));
    const speed=hourly['wind_speed_'+level]?.[i], dir=hourly['wind_direction_'+level]?.[i];
    if(i<0||!Number.isFinite(speed)||!Number.isFinite(dir)) throw new Error('Faltan vientos para parte del intervalo. Reduce las horas o cambia la fecha.');
    p=destination(p,dir+(backwards?0:180)+offset,speed*0.6*scale);
    points.push(p); times.push(start+(backwards?-1:1)*(s+1)*600000);
  }
  return {points,times};
}
export function estimateEmission(frp,duration,coefficient,efLow,efHigh) {
  if(![frp,duration,coefficient,efLow,efHigh].every(Number.isFinite)||frp<=0||duration<=0||coefficient<=0||efLow<0||efHigh<efLow) throw new Error('Completa parámetros válidos; el factor máximo debe ser ≥ al mínimo.');
  const dryKg=frp*duration*60*coefficient;
  return {dryKg,pmLowKg:dryKg*efLow/1000,pmHighKg:dryKg*efHigh/1000,rateLow:frp*coefficient*efLow/1000,rateHigh:frp*coefficient*efHigh/1000};
}
export function parseFirms(csv,sensor) {
  const lines=csv.trim().split(/\r?\n/), keys=lines.shift().split(',');
  if(!keys.includes('latitude')||!keys.includes('acq_date')) throw new Error('Respuesta FIRMS no válida');
  return lines.filter(Boolean).map(l=>Object.fromEntries(l.split(',').map((v,i)=>[keys[i],v]))).map(r=>{
    const time=String(r.acq_time).padStart(4,'0');
    return {lat:Number(r.latitude),lon:Number(r.longitude),frp:r.frp===''?null:Number(r.frp),confidence:r.confidence,sensor,satellite:r.satellite,at:Date.parse(`${r.acq_date}T${time.slice(0,2)}:${time.slice(2)}:00Z`)};
  }).filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon)&&Number.isFinite(r.at)&&r.lon>=BBOX[0]&&r.lon<=BBOX[2]&&r.lat>=BBOX[1]&&r.lat<=BBOX[3]);
}
