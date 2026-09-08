const names = {
  goes: ['GOES-East_ABI_GeoColor', 7, 'png'],
  snpp: ['VIIRS_SNPP_CorrectedReflectance_TrueColor', 9, 'jpeg'],
  n20: ['VIIRS_NOAA20_CorrectedReflectance_TrueColor', 9, 'jpeg'],
  n21: ['VIIRS_NOAA21_CorrectedReflectance_TrueColor', 9, 'jpeg'],
  terra: ['MODIS_Terra_CorrectedReflectance_TrueColor', 9, 'jpeg'],
  aqua: ['MODIS_Aqua_CorrectedReflectance_TrueColor', 9, 'jpeg'],
};
let cached;
export function resolveTime(xml, name, requested) {
  const layer = xml.split('<Layer>').find(part => part.includes(`<ows:Identifier>${name}</ows:Identifier>`))?.split('</Layer>')[0];
  const dimension = layer?.match(/<Dimension>[\s\S]*?<ows:Identifier>Time<\/ows:Identifier>([\s\S]*?)<\/Dimension>/)?.[1];
  if (!dimension) throw new Error('NASA no publica metadatos de esta capa.');
  let best = -Infinity;
  for (const match of dimension.matchAll(/<Value>(.*?)<\/Value>/g)) {
    const [a,b,period] = match[1].split('/'), start = Date.parse(a), end = b ? Date.parse(b) : start;
    const step = period === 'PT10M' ? 600000 : period === 'P1D' ? 86400000 : null;
    if (start <= requested && Number.isFinite(end)) {
      const at = step ? start + Math.floor((Math.min(end, requested)-start)/step)*step : start;
      best = Math.max(best, at);
    }
  }
  if (!Number.isFinite(best)) throw new Error('No hay una imagen publicada anterior a esa hora.');
  return best;
}
export default async function handler(req, res) {
  if(req.method!=='GET') return res.status(405).json({error:'Método no permitido'});
  const { layer='goes', time, latest } = req.query;
  if (!names[layer] || (latest !== 'true' && !Number.isFinite(Date.parse(time)))) return res.status(400).json({error:'Capa u hora no válida.'});
  try {
    if (!cached || Date.now()-cached.at > 300000) {
      const response = await fetch('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml', {signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error('No se pudo consultar la disponibilidad de NASA.');
      cached = {xml:await response.text(), at:Date.now()};
    }
    const [name, zoom, ext] = names[layer], requested = latest === 'true' ? Date.now() : Date.parse(time);
    const at = resolveTime(cached.xml, name, requested);
    if (latest !== 'true' && requested-at > (layer === 'goes' ? 30*60000 : 86400000)) return res.status(200).json({status:'unavailable', latestBefore:new Date(at).toISOString(), error:'No hay imagen cercana a la hora solicitada.'});
    const stamp = new Date(at).toISOString(), dimension = layer === 'goes' ? stamp.replace('.000Z','Z') : stamp.slice(0,10);
    res.setHeader('Cache-Control','public, s-maxage=120');
    return res.status(200).json({status:'ok', at:stamp, daily:layer!=='goes', url:`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${name}/default/${dimension}/GoogleMapsCompatible_Level${zoom}/{z}/{y}/{x}.${ext}`, maxNativeZoom:zoom});
  } catch(error) { return res.status(502).json({error:error.message}); }
}
