import {parseFirms,BBOX} from '../dist/core.js';
const sensors=['VIIRS_SNPP_NRT','VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT','MODIS_NRT'];
export default async function handler(req,res) {
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const date=String(req.query.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) return res.status(400).json({error:'Fecha inválida'});
  const age=Date.now()-Date.parse(date);
  if(age< -86400000||age>9*86400000) return res.status(400).json({error:'Selecciona una fecha de los últimos 9 días.'});
  const key=process.env.FIRMS_MAP_KEY;
  if(!key) return res.status(503).json({error:'Falta configurar FIRMS_MAP_KEY en el servidor. Las imágenes y el análisis manual siguen disponibles.',code:'MISSING_KEY'});
  const results=await Promise.all(sensors.map(async sensor=>{
    try {
      const r=await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${sensor}/${BBOX.join(',')}/1/${date}`,{signal:AbortSignal.timeout(18000)});
      if(!r.ok) throw new Error('upstream');
      return {sensor,status:'ok',fires:parseFirms(await r.text(),sensor)};
    }catch{return {sensor,status:'unavailable',fires:[]};}
  }));
  const ok=results.filter(x=>x.status==='ok').length;
  res.setHeader('Cache-Control',ok?'public, s-maxage=600, stale-while-revalidate=120':'no-store');
  return res.status(ok?200:502).json({date,fetchedAt:new Date().toISOString(),partial:ok<4,sources:results.map(({sensor,status})=>({sensor,status})),fires:results.flatMap(x=>x.fires),...(ok?{}:{error:'FIRMS no respondió correctamente. Comprueba la clave o intenta más tarde.'})});
}
