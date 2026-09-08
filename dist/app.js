import {distance,trajectory,estimateEmission} from './core.js';
const $=id=>document.getElementById(id), fmt=n=>new Intl.NumberFormat('es-DO',{maximumFractionDigits:2}).format(n);
const rd=t=>new Date(t).toLocaleString('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'short',timeStyle:'short'});
const inputRD=t=>new Date(t-4*3600000).toISOString().slice(0,16);
const recent=new Date(Math.floor((Date.now()-40*60000)/600000)*600000);
$('date').value=recent.toISOString().slice(0,10); $('date').max=new Date().toISOString().slice(0,10); $('date').min=new Date(Date.now()-8*86400000).toISOString().slice(0,10);
$('time').value=recent.toISOString().slice(11,16); $('start').value=inputRD(Date.now());
let map, selected=null, selectionMarker, imageLayer, fires=[], fireRun=0, analysisRun=0, playback=null;
let firesLayer,boundaryLayer,pathLayer, imageFailed=false;
const layers={goes:['GOES-East_ABI_GeoColor',7,'png'],snpp:['VIIRS_SNPP_CorrectedReflectance_TrueColor',9,'jpg'],n20:['VIIRS_NOAA20_CorrectedReflectance_TrueColor',9,'jpg'],n21:['VIIRS_NOAA21_CorrectedReflectance_TrueColor',9,'jpg'],terra:['MODIS_Terra_CorrectedReflectance_TrueColor',9,'jpg'],aqua:['MODIS_Aqua_CorrectedReflectance_TrueColor',9,'jpg']};
const places=[['Santo Domingo Este',18.49,-69.86],['Santo Domingo Norte',18.57,-69.9],['Santo Domingo Oeste',18.5,-70.0],['Distrito Nacional',18.48,-69.94],['Los Alcarrizos',18.52,-70.02],['Pedro Brand',18.57,-70.09],['Boca Chica',18.45,-69.61],['San Antonio de Guerra',18.56,-69.70],['La Victoria',18.59,-69.85],['La Caleta',18.45,-69.67],['Pantoja',18.53,-69.99],['Hato Nuevo',18.55,-70.06]];
function invalidate() {analysisRun++;pathLayer?.clearLayers();$('candidates').replaceChildren();$('analyze').disabled=!selected;$('analysis-status').textContent=selected?'Parámetros cambiados. Calcula una nueva trayectoria.':'Selecciona un punto del mapa.';}
function selectPoint(p,fire=null) {
  selected=p; if(selectionMarker) map.removeLayer(selectionMarker);
  selectionMarker=L.circleMarker(p,{radius:9,color:'#ffffff',weight:2,fillColor:'#67dcd6',fillOpacity:1,bubblingMouseEvents:false}).addTo(map);
  const nearest=[...places].sort((a,b)=>distance(p,[a[1],a[2]])-distance(p,[b[1],b[2]]))[0];
  $('selected').textContent=`${p[0].toFixed(4)}, ${p[1].toFixed(4)} · cerca de ${nearest[0]}`;
  $('frp').value=fire&&Number.isFinite(fire.frp)?fire.frp:'';
  $('emission-result').textContent='Sin estimación: revisa los parámetros.';
  if(fire){$('mode').value='forward';$('start').value=inputRD(fire.at);}
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
  const [name,zoom,ext]=layers[key], time=key==='goes'?`${$('date').value}T${$('time').value.slice(0,5)}:00Z`:$('date').value;
  imageFailed=false;$('imagery-status').textContent=`Cargando ${time}…`;
  imageLayer=L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${name}/default/${time}/GoogleMapsCompatible_Level${zoom}/{z}/{y}/{x}.${ext}`,{maxNativeZoom:zoom,maxZoom:18,opacity:Number($('opacity').value),attribution:'NASA GIBS / NOAA',pane:'satellite'});
  imageLayer.on('tileerror',()=>{imageFailed=true;$('imagery-status').textContent='Imagen no disponible o fallo de conexión. Prueba una hora/fecha anterior; no significa ausencia de humo.';stop();});
  imageLayer.on('load',()=>{if(!imageFailed)$('imagery-status').textContent=`${time} · ${key==='goes'?'Intervalos de 10 min; visible de día, infrarrojo de noche.':'Mosaico diario: no representa una hora única.'} Una imagen transparente puede indicar falta de cobertura. Ampliar no añade resolución.`;});
  imageLayer.addTo(map);
}
function step(delta){
  const date=new Date(`${$('date').value}T${$('time').value.slice(0,5)}:00Z`);if(!Number.isFinite(+date))return;
  date.setUTCMinutes(date.getUTCMinutes()+delta);
  if(+date>Date.now()-20*60000){stop();return;}
  const changed=$('date').value!==date.toISOString().slice(0,10);
  $('date').value=date.toISOString().slice(0,10);$('time').value=date.toISOString().slice(11,16);showImagery();
  if(changed){invalidate();loadFires();}
}
async function loadFires(){
  const run=++fireRun;fires=[];firesLayer?.clearLayers();invalidate();$('sources').replaceChildren();$('fires-status').textContent='Consultando VIIRS y MODIS…';
  try{
    const r=await fetch(`/api/fires?date=${encodeURIComponent($('date').value)}`,{signal:AbortSignal.timeout(25000)});
    if(!(r.headers.get('content-type')||'').includes('application/json'))throw new Error('Los focos automáticos necesitan el servidor de Vercel y FIRMS_MAP_KEY.');
    const data=await r.json();if(!r.ok)throw new Error(data.error||'No se pudieron consultar los focos.');if(run!==fireRun)return;
    fires=data.fires;
    $('fires-status').textContent=`${fires.length} detecciones en el área regional · ${data.date} UTC${data.partial?' · COBERTURA PARCIAL':''}. Consulta: ${rd(Date.parse(data.fetchedAt))}. No equivale a número de incendios.`;
    for(const s of data.sources){const el=document.createElement('div');el.textContent=`${s.sensor.replace('_NRT','')}: ${s.status==='ok'?'consultado':'no disponible'}`;$('sources').append(el);}
    for(const f of fires){
      const marker=L.circleMarker([f.lat,f.lon],{radius:6,color:'#ffba75',weight:1,fillColor:'#ff812d',fillOpacity:.8,bubblingMouseEvents:false});
      const el=document.createElement('div');el.textContent=`${f.sensor} · ${rd(f.at)} RD · FRP ${f.frp===null?'no disponible':fmt(f.frp)+' MW'} · Confianza del sensor: ${f.confidence}. Foco térmico, no humo confirmado.`;
      marker.bindPopup(el).on('click',()=>selectPoint([f.lat,f.lon],f)).addTo(firesLayer);
    }
  }catch(e){if(run===fireRun)$('fires-status').textContent=e.message;}
}
async function analyze(){
  if(!selected)return;
  const p=[...selected],run=++analysisRun,start=Date.parse($('start').value+'-04:00'),hours=Number($('hours').value),level=$('height').value,back=$('mode').value==='back';
  pathLayer.clearLayers();$('candidates').replaceChildren();
  if(!Number.isFinite(start)||start<Date.now()-8*86400000||start>Date.now()+86400000){$('analysis-status').textContent='El inicio debe estar entre los últimos 8 días y las próximas 24 horas.';return;}
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
    $('analysis-status').textContent=`${back?'Retrotrayectoria':'Transporte hacia adelante'} de ${hours} h · viento a ${level.replace('m',' m')} · ${rd(start)} RD. Modelo horario en un solo punto, no trayectoria observada del humo.`;
    if(back){
      const candidates=fires.map(f=>{
        let best=Infinity;
        main.points.forEach((pt,i)=>{if(f.at<=start&&Math.abs(f.at-main.times[i])<=3*3600000)best=Math.min(best,distance(pt,[f.lat,f.lon]));});
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
  firesLayer=L.layerGroup().addTo(map);boundaryLayer=L.layerGroup().addTo(map);pathLayer=L.layerGroup().addTo(map);
  for(const [name,lat,lon] of places)L.circleMarker([lat,lon],{radius:3,color:'#c6e5e8',fillColor:'#173745',fillOpacity:1,bubblingMouseEvents:false}).bindTooltip(name,{permanent:true,direction:'top',className:'place'}).on('click',()=>selectPoint([lat,lon])).addTo(map);
  map.on('click',e=>selectPoint([e.latlng.lat,e.latlng.lng]));
  fetch('/provinces.geojson').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>L.geoJSON(data,{style:f=>({color:f.properties.shapeName==='Santo Domingo'?'#42b6c2':'#b991e7',weight:2,fillOpacity:.03,dashArray:'5 4'}),onEachFeature:(f,l)=>l.bindTooltip(f.properties.shapeName)}).addTo(boundaryLayer)).catch(()=>{$('map-error').hidden=false;$('map-error').textContent='No se pudieron cargar los límites provinciales.';});
  $('home').onclick=()=>map.fitBounds([[18.32,-70.22],[18.83,-69.48]]);
  $('layer').onchange=showImagery;$('date').onchange=()=>{stop();showImagery();loadFires();};$('time').onchange=()=>{stop();showImagery();};
  $('opacity').oninput=()=>imageLayer?.setOpacity(Number($('opacity').value));
  $('refresh').onclick=()=>{stop();showImagery();loadFires();};
  $('previous').onclick=()=>{stop();step(-10);};$('next').onclick=()=>{stop();step(10);};
  $('play').onclick=()=>{if(playback){stop();return;}$('play').textContent='Pausar';playback=setInterval(()=>step(10),2500);};
  $('show-fires').onchange=e=>e.target.checked?firesLayer.addTo(map):map.removeLayer(firesLayer);
  $('show-boundaries').onchange=e=>e.target.checked?boundaryLayer.addTo(map):map.removeLayer(boundaryLayer);
  for(const id of ['mode','start','height','hours'])$(id).onchange=invalidate;
  $('analyze').onclick=analyze;
  $('emissions').oninput=()=>{$('emission-result').textContent='Parámetros cambiados: vuelve a calcular.';};
  $('emissions').onsubmit=e=>{e.preventDefault();try{const result=estimateEmission(...['frp','duration','coefficient','eflow','efhigh'].map(id=>Number($(id).value)));$('emission-result').textContent=`PM2.5 estimado: ${fmt(result.pmLowKg)}–${fmt(result.pmHighKg)} kg. Tasa: ${fmt(result.rateLow)}–${fmt(result.rateHigh)} kg/s. Combustible seco: ${fmt(result.dryKg)} kg. Escenario condicional, no medición. Parámetros: ${$('reference').value}.`;}catch(e){$('emission-result').textContent=e.message;}};
  loadFires();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
