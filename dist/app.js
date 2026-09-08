import {distance,trajectory,estimateEmission} from './core.js';
const $=id=>document.getElementById(id), fmt=n=>new Intl.NumberFormat('es-DO',{maximumFractionDigits:2}).format(n);
const rd=t=>new Date(t).toLocaleString('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'short',timeStyle:'short'});
const inputRD=t=>new Date(t-4*3600000).toISOString().slice(0,16);
const recent=new Date(Math.floor((Date.now()-40*60000)/600000)*600000);
$('date').value=inputRD(+recent).slice(0,10); $('date').max=inputRD(Date.now()).slice(0,10); $('date').min=inputRD(Date.now()-8*86400000).slice(0,10);
$('time').value=inputRD(+recent).slice(11,16); $('start').value=inputRD(Date.now()-3*3600000); $('end').value=inputRD(Date.now());
let map, selected=null, selectionMarker, imageLayer, fires=[], fireRun=0, analysisRun=0, playback=null, analysisPlayback=null, analysisPath=null, plumeMarker=null;
let firesLayer,landfillLayer,boundaryLayer,pathLayer, imageFailed=false;
const layers={goes:['GOES-East_ABI_GeoColor',7,'png'],snpp:['VIIRS_SNPP_CorrectedReflectance_TrueColor',9,'jpg'],n20:['VIIRS_NOAA20_CorrectedReflectance_TrueColor',9,'jpg'],n21:['VIIRS_NOAA21_CorrectedReflectance_TrueColor',9,'jpg'],terra:['MODIS_Terra_CorrectedReflectance_TrueColor',9,'jpg'],aqua:['MODIS_Aqua_CorrectedReflectance_TrueColor',9,'jpg']};
const places=[['Santo Domingo Este',18.49,-69.86],['Santo Domingo Norte',18.57,-69.9],['Santo Domingo Oeste',18.5,-70.0],['Distrito Nacional',18.48,-69.94],['Los Alcarrizos',18.52,-70.02],['Pedro Brand',18.57,-70.09],['Boca Chica',18.45,-69.61],['San Antonio de Guerra',18.56,-69.70],['La Victoria',18.59,-69.85],['La Caleta',18.45,-69.67],['Pantoja',18.53,-69.99],['Hato Nuevo',18.55,-70.06]];
const landfills=[
  {name:'Vertedero de Duquesa',lat:18.5626353,lon:-69.9683672,status:'En transformación y cierre progresivo',source:'Ministerio de Medio Ambiente / OpenStreetMap'},
  {name:'Vertedero de Cancino Adentro',lat:18.4916831,lon:-69.80287,status:'Antiguo vertedero y estación de transferencia; estado operativo por verificar',source:'Presidencia RD / OpenStreetMap'},
  {name:'Vertedero de San Luis · sector La Rusa',lat:18.490788,lon:-69.752442,status:'En remediación previa al cierre técnico; estado operativo por verificar',source:'Junta Municipal San Luis / OpenStreetMap'},
  {name:'Vertedero La Tumba · Boca Chica',lat:18.4773,lon:-69.5464,status:'Sitio documentado; ubicación cartográfica aproximada y estado por verificar',source:'Prensa local / OpenStreetMap'}
];
function stopAnalysis(){clearInterval(analysisPlayback);analysisPlayback=null;$('play-analysis').textContent='Reproducir';if(plumeMarker){map?.removeLayer(plumeMarker);plumeMarker=null;}}
function invalidate() {analysisRun++;stopAnalysis();analysisPath=null;$('timeline').hidden=true;pathLayer?.clearLayers();$('candidates').replaceChildren();$('analyze').disabled=!selected;$('analysis-status').textContent=selected?'Parámetros cambiados. Calcula una nueva trayectoria.':'Selecciona un punto del mapa.';}
function selectPoint(p,fire=null,landfill=null) {
  selected=p; if(selectionMarker) map.removeLayer(selectionMarker);
  selectionMarker=L.marker(p,{icon:L.divIcon({className:'smoke-origin',iconSize:[18,18],iconAnchor:[9,9]}),keyboard:true,title:'Punto de inicio del humo',bubblingMouseEvents:false}).addTo(map).bindTooltip('Inicio del humo',{direction:'top'});
  const nearest=[...places].sort((a,b)=>distance(p,[a[1],a[2]])-distance(p,[b[1],b[2]]))[0];
  $('selected').textContent=`Inicio: ${landfill?.name||fire?.sensor||'punto manual'} · ${p[0].toFixed(4)}, ${p[1].toFixed(4)} · cerca de ${nearest[0]}`;
  $('frp').value=fire&&Number.isFinite(fire.frp)?fire.frp:'';
  $('emission-result').textContent='Sin estimación: revisa los parámetros.';
  if(fire){$('mode').value='forward';$('start').value=inputRD(fire.at);$('end').value=inputRD(fire.at+3*3600000);}
  if(landfill){$('mode').value='forward';const base=Date.parse(`${$('date').value}T${$('time').value||'12:00'}:00-04:00`);$('start').value=inputRD(base);$('end').value=inputRD(base+3*3600000);}
  invalidate();
}
function stop(){clearInterval(playback);playback=null;$('play').textContent='Reproducir';}
function showImagery() {
  if(!map)return;
  if(imageLayer){map.removeLayer(imageLayer);imageLayer=null;}
  const key=$('layer').value;$('goes-time').hidden=key!=='goes';
  if(key!=='goes')stop();
  if(key==='none'){$('imagery-status').textContent='Mapa de localidades. Activa una imagen satelital para inspeccionar la pluma.';return;}
  if(!$('date').value|| (key==='goes'&&!$('time').value)){$('imagery-status').textContent='Selecciona fecha y hora válidas.';return;}
  const localTime=Date.parse(`${$('date').value}T${$('time').value.slice(0,5)}:00-04:00`);
  const [name,zoom,ext]=layers[key], time=key==='goes'?new Date(localTime).toISOString().slice(0,16)+':00Z':$('date').value;
  imageFailed=false;$('imagery-status').textContent=`Cargando ${time}…`;
  imageLayer=L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${name}/default/${time}/GoogleMapsCompatible_Level${zoom}/{z}/{y}/{x}.${ext}`,{maxNativeZoom:zoom,maxZoom:18,opacity:Number($('opacity').value),attribution:'NASA GIBS / NOAA',pane:'satellite'});
  imageLayer.on('tileerror',()=>{imageFailed=true;$('imagery-status').textContent='Imagen no disponible o fallo de conexión. Prueba una hora/fecha anterior; no significa ausencia de humo.';stop();});
  imageLayer.on('load',()=>{if(!imageFailed)$('imagery-status').textContent=`${key==='goes'?`${$('date').value} ${$('time').value} RD · consulta satelital ${time}`:`${$('date').value} · mosaico diario UTC`}. ${key==='goes'?'Intervalos de 10 min; visible de día, infrarrojo de noche.':'No representa una hora única.'} Una imagen transparente puede indicar falta de cobertura.`;});
  imageLayer.addTo(map);
}
function step(delta){
  const date=new Date(`${$('date').value}T${$('time').value.slice(0,5)}:00-04:00`);if(!Number.isFinite(+date))return;
  date.setUTCMinutes(date.getUTCMinutes()+delta);
  if(+date>Date.now()-20*60000){stop();return;}
  const next=inputRD(+date),changed=$('date').value!==next.slice(0,10);
  $('date').value=next.slice(0,10);$('time').value=next.slice(11,16);showImagery();
  if(changed){invalidate();loadFires();}
}
async function loadFires(){
  const run=++fireRun;fires=[];firesLayer?.clearLayers();invalidate();$('sources').replaceChildren();$('fires-status').textContent='Consultando VIIRS y MODIS…';
  try{
    const r=await fetch(`/api/fires?date=${encodeURIComponent($('date').value)}`,{signal:AbortSignal.timeout(25000)});
    if(!(r.headers.get('content-type')||'').includes('application/json'))throw new Error('Los focos automáticos necesitan el servidor de Vercel y FIRMS_MAP_KEY.');
    const data=await r.json();if(!r.ok)throw new Error(data.error||'No se pudieron consultar los focos.');if(run!==fireRun)return;
    fires=data.fires;
    $('fires-status').textContent=`${fires.length} detecciones en el área regional · día local ${data.date} RD${data.partial?' · COBERTURA PARCIAL':''}. Consulta: ${rd(Date.parse(data.fetchedAt))} RD. No equivale a número de incendios.`;
    for(const s of data.sources){const el=document.createElement('div');el.textContent=`${s.sensor.replace('_NRT','')}: ${s.status==='ok'?'consultado':s.status==='partial'?'cobertura parcial':'no disponible'}`;$('sources').append(el);}
    for(const f of fires){
      const marker=L.circleMarker([f.lat,f.lon],{radius:6,color:'#ffba75',weight:1,fillColor:'#ff812d',fillOpacity:.8,bubblingMouseEvents:false});
      const el=document.createElement('div');el.textContent=`${f.sensor} · ${rd(f.at)} RD · FRP ${f.frp===null?'no disponible':fmt(f.frp)+' MW'} · Confianza del sensor: ${f.confidence}. Foco térmico, no humo confirmado.`;
      marker.bindPopup(el).on('click',()=>selectPoint([f.lat,f.lon],f)).addTo(firesLayer);
    }
  }catch(e){if(run===fireRun)$('fires-status').textContent=e.message;}
}
function setAnalysisTime(index){
  if(!analysisPath)return;
  const i=Math.max(0,Math.min(analysisPath.points.length-1,Number(index)));
  $('analysis-time').value=String(i);
  if(plumeMarker)map.removeLayer(plumeMarker);
  plumeMarker=L.marker(analysisPath.points[i],{icon:L.divIcon({className:'plume-time-icon',iconSize:[14,14],iconAnchor:[7,7]}),interactive:false}).addTo(map);
  const direction=analysisPath.times[i]<analysisPath.times[0]?'antes del punto seleccionado':'después del punto seleccionado';
  $('current-analysis-time').textContent=`${rd(analysisPath.times[i])} RD · ${i*10} min ${direction}`;
}
async function analyze(){
  if(!selected)return;
  const p=[...selected],run=++analysisRun,begin=Date.parse($('start').value+'-04:00'),end=Date.parse($('end').value+'-04:00'),level=$('height').value,back=$('mode').value==='back';
  const hours=(end-begin)/3600000,start=back?end:begin;
  pathLayer.clearLayers();$('candidates').replaceChildren();
  stopAnalysis();analysisPath=null;$('timeline').hidden=true;
  if(!Number.isFinite(begin)||!Number.isFinite(end)||end<=begin){$('analysis-status').textContent='El intervalo debe tener una hora “Desde” anterior a “Hasta”.';return;}
  if(hours>24){$('analysis-status').textContent='El span máximo por análisis es de 24 horas.';return;}
  if(begin<Date.now()-8*86400000||end>Date.now()+86400000){$('analysis-status').textContent='El intervalo debe estar entre los últimos 8 días y las próximas 24 horas.';return;}
  $('analyze').disabled=true;$('analysis-status').textContent='Consultando viento horario y calculando…';
  try{
    const vars=`wind_speed_${level},wind_direction_${level}`;
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p[0].toFixed(3)}&longitude=${p[1].toFixed(3)}&hourly=${vars}&wind_speed_unit=ms&past_days=10&forecast_days=3&timeformat=unixtime&timezone=UTC`,{signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error('No se pudo obtener el viento. No se dibuja una trayectoria sin datos.');
    const data=await r.json();if(run!==analysisRun)return;
    if(!data.hourly?.time?.length)throw new Error('El proveedor devolvió viento incompleto.');
    const hourly={...data.hourly,time:data.hourly.time.map(t=>t*1000)};
    const main=trajectory(p,start,hours,hourly,level,back);
    for(const [angle,scale] of [[-20,.8],[20,1.2]])L.polyline(trajectory(p,start,hours,hourly,level,back,angle,scale).points,{color:'#8ab3ba',weight:1.5,dashArray:'5 7',opacity:.7}).addTo(pathLayer);
    L.polyline(main.points,{color:'#65e0d6',weight:3}).addTo(pathLayer);
    main.points.forEach((pt,i)=>{if(i%6===0)L.circleMarker(pt,{radius:4,color:'#d9ffff',weight:1,fillOpacity:1}).bindTooltip(`${back?'−':'+'}${i/6} h · ${rd(main.times[i])} RD`).addTo(pathLayer);});
    map.fitBounds(L.latLngBounds(main.points).pad(.3),{maxZoom:12});
    $('analysis-status').textContent=`${back?'Retrotrayectoria':'Transporte hacia adelante'} · span ${fmt(hours)} h · ${rd(begin)}–${rd(end)} RD · viento a ${level.replace('m',' m')}. Modelo horario en un solo punto, no trayectoria observada del humo.`;
    analysisPath=main;$('analysis-time').max=String(main.points.length-1);$('timeline').hidden=false;setAnalysisTime(0);
    if(back){
      const candidates=fires.map(f=>{
        let best=Infinity;
        main.points.forEach((pt,i)=>{if(f.at>=begin&&f.at<=end&&Math.abs(f.at-main.times[i])<=3*3600000)best=Math.min(best,distance(pt,[f.lat,f.lon]));});
        return {...f,gap:best};
      }).filter(f=>f.gap<=10).sort((a,b)=>a.gap-b.gap).slice(0,5);
      const title=document.createElement('p');title.className='fine';title.textContent=candidates.length?'Focos a ≤10 km de la trayectoria, con tolerancia temporal de ±3 h. Proximidad no confirma procedencia.':'Sin candidatos coincidentes en las detecciones cargadas. No descarta incendios ni fuentes fuera del área/fecha consultada.';$('candidates').append(title);
      for(const f of candidates){const b=document.createElement('button');b.className='candidate';b.textContent=`${f.sensor.replace('_NRT','')} · ${fmt(f.gap)} km de la trayectoria`;const s=document.createElement('span');s.textContent=`${rd(f.at)} RD · ${f.frp===null?'FRP no disponible':fmt(f.frp)+' MW'} · inspeccionar foco`;b.append(s);b.onclick=()=>{selectPoint([f.lat,f.lon],f);map.setView([f.lat,f.lon],12);};$('candidates').append(b);}
    }
  }catch(e){if(run===analysisRun)$('analysis-status').textContent=e.message;}
  finally{if(run===analysisRun)$('analyze').disabled=false;}
}
function init(){
  if(!window.L){$('map-error').hidden=false;$('map-error').textContent='No se pudo cargar el mapa. Recarga la página; verifica que se haya ejecutado la compilación.';return;}
  map=L.map('map',{zoomControl:true}).setView([18.57,-69.87],10);
  map.createPane('satellite');map.getPane('satellite').style.zIndex=250;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).on('tileerror',()=>{$('map-error').hidden=false;$('map-error').textContent='No se pudo cargar parte del mapa base. Comprueba tu conexión.';}).addTo(map);
  firesLayer=L.layerGroup().addTo(map);landfillLayer=L.layerGroup().addTo(map);boundaryLayer=L.layerGroup().addTo(map);pathLayer=L.layerGroup().addTo(map);
  for(const [name,lat,lon] of places)L.circleMarker([lat,lon],{radius:3,color:'#c6e5e8',fillColor:'#173745',fillOpacity:1,bubblingMouseEvents:false}).bindTooltip(name,{permanent:true,direction:'top',className:'place'}).on('click',()=>selectPoint([lat,lon])).addTo(map);
  for(const site of landfills){
    const marker=L.marker([site.lat,site.lon],{icon:L.divIcon({className:'landfill-marker',iconSize:[15,15],iconAnchor:[8,8]}),title:site.name,bubblingMouseEvents:false});
    const popup=document.createElement('div'),title=document.createElement('strong'),status=document.createElement('p'),source=document.createElement('small');
    title.textContent=site.name;status.textContent=site.status;source.textContent=`Fuente de identificación: ${site.source}`;popup.append(title,status,source);
    marker.bindTooltip(site.name,{permanent:true,direction:'top',className:'landfill-label'}).bindPopup(popup).on('click',()=>selectPoint([site.lat,site.lon],null,site)).addTo(landfillLayer);
  }
  map.on('click',e=>selectPoint([e.latlng.lat,e.latlng.lng]));
  fetch('/provinces.geojson').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>L.geoJSON(data,{style:f=>({color:f.properties.shapeName==='Santo Domingo'?'#42b6c2':'#b991e7',weight:2,fillOpacity:.03,dashArray:'5 4'}),onEachFeature:(f,l)=>l.bindTooltip(f.properties.shapeName)}).addTo(boundaryLayer)).catch(()=>{$('map-error').hidden=false;$('map-error').textContent='No se pudieron cargar los límites provinciales.';});
  $('home').onclick=()=>map.fitBounds([[18.32,-70.22],[18.83,-69.48]]);
  $('layer').onchange=showImagery;$('date').onchange=()=>{stop();showImagery();loadFires();};$('time').onchange=()=>{stop();showImagery();};
  $('opacity').oninput=()=>imageLayer?.setOpacity(Number($('opacity').value));
  $('refresh').onclick=()=>{stop();showImagery();loadFires();};
  $('previous').onclick=()=>{stop();step(-10);};$('next').onclick=()=>{stop();step(10);};
  $('play').onclick=()=>{if(playback){stop();return;}$('play').textContent='Pausar';playback=setInterval(()=>step(10),2500);};
  $('show-fires').onchange=e=>e.target.checked?firesLayer.addTo(map):map.removeLayer(firesLayer);
  $('show-landfills').onchange=e=>e.target.checked?landfillLayer.addTo(map):map.removeLayer(landfillLayer);
  $('show-boundaries').onchange=e=>e.target.checked?boundaryLayer.addTo(map):map.removeLayer(boundaryLayer);
  for(const id of ['mode','start','end','height'])$(id).onchange=invalidate;
  $('analyze').onclick=analyze;
  $('analysis-time').oninput=e=>setAnalysisTime(e.target.value);
  $('play-analysis').onclick=()=>{if(analysisPlayback){stopAnalysis();setAnalysisTime($('analysis-time').value);return;}if(!analysisPath)return;if(Number($('analysis-time').value)>=Number($('analysis-time').max))setAnalysisTime(0);$('play-analysis').textContent='Pausar';analysisPlayback=setInterval(()=>{const next=Number($('analysis-time').value)+1;if(next>Number($('analysis-time').max)){clearInterval(analysisPlayback);analysisPlayback=null;$('play-analysis').textContent='Repetir';return;}setAnalysisTime(next);},180);};
  $('emissions').oninput=()=>{$('emission-result').textContent='Parámetros cambiados: vuelve a calcular.';};
  $('emissions').onsubmit=e=>{e.preventDefault();try{const result=estimateEmission(...['frp','duration','coefficient','eflow','efhigh'].map(id=>Number($(id).value)));$('emission-result').textContent=`PM2.5 estimado: ${fmt(result.pmLowKg)}–${fmt(result.pmHighKg)} kg. Tasa: ${fmt(result.rateLow)}–${fmt(result.rateHigh)} kg/s. Combustible seco: ${fmt(result.dryKg)} kg. Escenario condicional, no medición. Parámetros: ${$('reference').value}.`;}catch(e){$('emission-result').textContent=e.message;}};
  loadFires();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
