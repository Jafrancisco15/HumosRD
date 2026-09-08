import {parseFirms,BBOX} from '../dist/core.js';
const sensors=['VIIRS_SNPP_NRT','VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT','MODIS_NRT'];
const NRT_DAYS=9;
export default async function handler(req,res) {
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const date=String(req.query.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) return res.status(400).json({error:'Fecha inválida'});
  const age=Date.now()-Date.parse(`${date}T04:00:00Z`);
  if(age< -86400000) return res.status(400).json({error:'No se pueden consultar fechas futuras.'});
  if(age>NRT_DAYS*86400000) {
    res.setHeader('Cache-Control','public, s-maxage=86400');
    return res.status(200).json({
      date,timeZone:'America/Santo_Domingo',fetchedAt:new Date().toISOString(),partial:false,
      historicalUnavailable:true,windowDays:NRT_DAYS,fires:[],
      sources:sensors.map(sensor=>({sensor,status:'outside_nrt_window'})),
      message:`FIRMS NRT solo se consulta para los últimos ${NRT_DAYS} días. La fecha histórica sigue disponible para GOES/GIBS y ADP si el proveedor conserva la escena.`
    });
  }
  const key=process.env.FIRMS_MAP_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar FIRMS_MAP_KEY en el servidor. Las imágenes y el análisis de humo siguen disponibles.',code:'MISSING_KEY'});
  const nextDate=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
  const requests=sensors.flatMap(sensor=>[date,nextDate].map(utcDate=>({sensor,utcDate})));
  const results=await Promise.all(requests.map(async ({sensor,utcDate})=>{
    try {
      const r=await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${sensor}/${BBOX.join(',')}/1/${utcDate}`,{signal:AbortSignal.timeout(18000)});
      if(!r.ok) throw new Error('upstream');
      return {sensor,utcDate,status:'ok',fires:parseFirms(await r.text(),sensor)};
    }catch{return {sensor,utcDate,status:'unavailable',fires:[]};}
  }));
  const sources=sensors.map(sensor=>{const count=results.filter(x=>x.sensor===sensor&&x.status==='ok').length;return {sensor,status:count===2?'ok':count===1?'partial':'unavailable'};});
  const ok=sources.filter(x=>x.status!=='unavailable').length;
  const fires=results.flatMap(x=>x.fires).filter(f=>new Date(f.at-4*3600000).toISOString().slice(0,10)===date);
  res.setHeader('Cache-Control',ok?'public, s-maxage=600, stale-while-revalidate=120':'no-store');
  return res.status(ok?200:502).json({date,timeZone:'America/Santo_Domingo',utcDates:[date,nextDate],fetchedAt:new Date().toISOString(),partial:sources.some(x=>x.status!=='ok'),historicalUnavailable:false,sources,fires,...(ok?{}:{error:'FIRMS no respondió correctamente. Comprueba la clave o intenta más tarde.'})});
}
