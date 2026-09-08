import {distance, trajectory} from './core.js';
import {frameSlots, trackSmoke, rankOrigins, observedPlaces, STEP} from './smoke-core.js';

export function initAutomatic({map, places, rd, inputRD, showImagery}) {
  const $=id=>document.getElementById(id);
  const masks=L.layerGroup().addTo(map), paths=L.layerGroup().addTo(map), forecasts=L.layerGroup().addTo(map);
  let controller, frames=[], tracks=[], timer, run=0;
  const end=Math.floor((Date.now()-20*60000)/STEP)*STEP;
  $('auto-start').value=inputRD(end-3*3600000);$('auto-end').value=inputRD(end);
  for(const id of ['auto-start','auto-end']) {
    $(id).max=inputRD(Date.now());$(id).min=inputRD(Date.now()-8*86400000);
    $(id).addEventListener('change',()=>{cancel();frames=[];tracks=[];masks.clearLayers();paths.clearLayers();forecasts.clearLayers();$('auto-results').replaceChildren();$('communities').replaceChildren();$('community-status').textContent='Intervalo cambiado: vuelve a analizar.';$('auto-timeline').hidden=true;$('auto-status').textContent='Intervalo cambiado: pulsa Analizar humo.';});
  }
  function pause(){clearInterval(timer);timer=null;$('auto-play').textContent='Reproducir';}
  function cancel(){run++;controller?.abort();controller=null;pause();$('auto-analyze').disabled=false;$('auto-cancel').hidden=true;}
  $('auto-cancel').onclick=()=>{cancel();$('auto-status').textContent='Análisis cancelado. Los resultados parciales no constituyen un análisis completo del intervalo.';};
  $('show-smoke').onchange=e=>e.target.checked?masks.addTo(map):map.removeLayer(masks);
  function textBlock(parent, message, className='status') {const p=document.createElement('p');p.className=className;p.textContent=message;parent.append(p);return p;}
  async function json(url, signal, timeout=55000){
    const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Servicio no disponible: comprueba que Vercel haya desplegado esta versión.');
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Fallo del proveedor.');return data;
  }
  function frameAt(index){
    const frame=frames[Number(index)];if(!frame)return;
    masks.clearLayers();paths.clearLayers();$('auto-time').value=index;
    $('frame-source').hidden=true;
    if(frame.status==='ok'){
      L.geoJSON(frame.mask,{style:{color:'#ffe377',weight:1,fillColor:'#ffe377',fillOpacity:.24},interactive:false}).addTo(masks);
      const area=frame.components.reduce((sum,c)=>sum+c.areaKm2,0);
      $('auto-frame').textContent=`${rd(frame.at)}–${rd(frame.scanEnd)} RD · ${Math.round(frame.coverage.usableFraction*100)}% del área evaluable · ${area.toFixed(1)} km² clasificados como humo. ${frame.coverage.ambiguousPixels} píxeles humo/polvo ambiguos excluidos.`;
      $('frame-source').href=frame.source;$('frame-source').hidden=false;
    }else $('auto-frame').textContent=`${rd(frame.requestedAt)} RD · SIN OBSERVACIÓN: ${frame.reason}`;
    const stamp=Date.parse(frame.at||frame.requestedAt);
    for(const track of tracks){
      const samples=track.samples.filter(s=>s.at<=stamp);
      if(!samples.length||stamp-samples.at(-1).at>STEP)continue;
      if(samples.length>1)L.polyline(samples.map(s=>s.center),{color:'#6ce7df',weight:3}).bindTooltip(`Pluma ${track.id}: movimiento del centro detectado`).addTo(paths);
      L.circleMarker(samples[0].center,{radius:5,color:'#fff4b2',fillOpacity:1}).bindTooltip(`Pluma ${track.id} · primera detección ${rd(samples[0].at)} RD; origen no confirmado`).addTo(paths);
      const last=samples.at(-1);
      L.circleMarker(last.center,{radius:5,color:'#65e0d6',fillOpacity:1}).bindTooltip(`Pluma ${track.id} · ${rd(last.at)} RD`).addTo(paths);
    }
    // Synchronize visible imagery; availability resolution may select a nearby scene and displays its own time.
    const local=inputRD(stamp);$('date').value=local.slice(0,10);$('time').value=local.slice(11,16);$('layer').value='goes';
    showImagery();
  }
  $('auto-time').oninput=e=>{pause();frameAt(e.target.value);};
  $('auto-play').onclick=()=>{if(timer){pause();return;}if(!frames.length)return;if(Number($('auto-time').value)>=frames.length-1)frameAt(0);$('auto-play').textContent='Pausar';timer=setInterval(()=>{const next=Number($('auto-time').value)+1;if(next>=frames.length){pause();return;}frameAt(next);},3000);};

  async function analyze(){
    cancel();const token=run;controller=new AbortController();const signal=controller.signal;
    const begin=Date.parse($('auto-start').value+'-04:00'),end=Date.parse($('auto-end').value+'-04:00');
    let slots;
    try{slots=frameSlots(begin,end);if(begin<Date.now()-8*86400000||end>Date.now())throw new Error('Selecciona fechas de los últimos 8 días, sin horas futuras.');}
    catch(error){$('auto-status').textContent=error.message;return;}
    frames=[];tracks=[];masks.clearLayers();paths.clearLayers();forecasts.clearLayers();$('auto-results').replaceChildren();$('communities').replaceChildren();$('auto-timeline').hidden=true;
    $('auto-analyze').disabled=true;$('auto-cancel').hidden=false;$('community-status').textContent='Esperando detecciones del intervalo…';
    let next=0,done=0;
    const collected=new Array(slots.length), allFires=[], fireIssues=[];
    const dates=new Set();
    // Include three hours preceding the interval for candidate sources.
    for(let t=Math.max(begin-3*3600000,Date.now()-8*86400000);t<=end;t+=3600000)dates.add(inputRD(t).slice(0,10));
    dates.add(inputRD(end).slice(0,10));
    const fireTask=(async()=>{
      for(const date of dates){
        if(signal.aborted)return;
        try{const data=await json(`/api/fires?date=${date}`,signal,25000);allFires.push(...data.fires);if(data.partial)fireIssues.push(`${date}: FIRMS parcial`);}
        catch(error){if(!signal.aborted)fireIssues.push(`${date}: ${error.message}`);}
      }
    })();
    async function worker(){
      while(next<slots.length&&!signal.aborted){
        const index=next++,time=new Date(slots[index]).toISOString();
        try{
          const data=await json(`/api/smoke?time=${encodeURIComponent(time)}`,signal);
          collected[index]=data.status==='ok'?data:{...data,requestedAt:time};
        }catch(error){if(signal.aborted)return;collected[index]={status:'unavailable',requestedAt:time,reason:error.message};}
        done++;
        if(token===run)$('auto-status').textContent=`Procesando escenas NOAA: ${done}/${slots.length}. Buscando humo, cobertura y continuidad temporal…`;
      }
    }
    await Promise.all([worker(),worker(),fireTask]);if(token!==run)return;
    frames=collected;tracks=trackSmoke(frames);
    const valid=frames.filter(f=>f.status==='ok'),usable=valid.filter(f=>f.coverage.usablePixels>0),missing=frames.length-valid.length;
    const coverage=valid.reduce((sum,f)=>sum+f.coverage.usableFraction,0)/frames.length;
    $('auto-status').textContent=`${rd(begin)}–${rd(end)} RD · ${valid.length}/${frames.length} escenas procesadas; ${usable.length} con superficie evaluable. Cobertura espacio-tiempo útil: ${Math.round(coverage*100)}%. ${tracks.length} secuencias de humo${missing?`; ${missing} escenas faltantes`:''}. ${tracks.length?'La continuidad y el origen se evalúan abajo.':'No se identificó humo en los píxeles evaluables; no demuestra ausencia de humo.'}`;
    const results=$('auto-results');
    if(fireIssues.length)textBlock(results,'Procedencia limitada: '+fireIssues.join(' · '));
    if(missing)textBlock(results,`Primera escena faltante: ${frames.find(f=>f.status!=='ok').reason}`,'fine');
    const seen=new Map();
    for(const frame of valid)for(const name of observedPlaces(frame,places))seen.set(name,frame.at);
    for(const [name,at] of seen)textBlock($('communities'),`${name}: humo detectado en la columna atmosférica · última escena ${rd(at)} RD. La altura y la concentración a nivel del suelo no están determinadas.`);
    const sourceMarkers=[];
    for(const track of tracks){
      const first=track.samples[0],last=track.samples.at(-1),candidates=rankOrigins(track,allFires);
      const nearest=[...places].sort((a,b)=>distance(first.center,a.slice(1))-distance(first.center,b.slice(1)))[0];
      const card=document.createElement('div');card.className='candidate';
      textBlock(card,`Pluma ${track.id} · ${track.samples.length} escenas · primera detección cerca de ${nearest[0]}, ${rd(first.at)} RD`,'fine');
      const km=track.samples.slice(1).reduce((sum,s,i)=>sum+distance(track.samples[i].center,s.center),0);
      textBlock(card,`${first.areaKm2.toFixed(1)} → ${last.areaKm2.toFixed(1)} km² de huella detectada. ${track.samples.length>1?`${km.toFixed(1)} km de recorrido del centro; incluye cambios de forma.`:'Una sola escena: trayectoria sin resolver.'}`,'fine');
      if(candidates.length){
        textBlock(card,'Origen candidato, confianza baja: focos previos a la primera detección, cercanos y en sentido opuesto al movimiento. No es una atribución confirmada.','fine');
        for(const f of candidates){
          textBlock(card,`${f.sensor} · ${rd(f.at)} RD · ${f.gap.toFixed(1)} km de la primera huella · ${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`,'fine');
          sourceMarkers.push(f);
        }
      }else textBlock(card,'Origen no resuelto: faltan focos compatibles o movimiento suficiente. La primera huella no se presenta como punto de emisión.','fine');
      const button=document.createElement('button');button.textContent='Ver primera detección';button.onclick=()=>{pause();frameAt(frames.findIndex(f=>Date.parse(f.at)===first.at));map.setView(first.center,10);};card.append(button);results.append(card);
    }
    $('auto-timeline').hidden=false;$('auto-time').max=frames.length-1;
    const firstSmoke=frames.findIndex(f=>f.status==='ok'&&f.components.length);frameAt(firstSmoke>=0?firstSmoke:frames.length-1);
    // Project only tracks present in the latest requested acquisition, avoiding stale warnings.
    const latestSlot=slots.at(-1),active=tracks.filter(t=>t.samples.at(-1).at>=latestSlot).sort((a,b)=>b.samples.at(-1).areaKm2-a.samples.at(-1).areaKm2);
    $('community-status').textContent=`${seen.size} localidades con humo detectado sobre su punto de referencia. ${active.length?'Calculando escenarios de transporte desde la última escena…':'Sin plumas observables en la última escena para proyectar. No equivale a ausencia de riesgo.'}`;
    let projected=0,windFailures=0;
    for(const track of active.slice(0,5)){
      if(signal.aborted)return;
      const last=track.samples.at(-1),[lat,lon]=last.center;
      try{
        const data=await json(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=wind_speed_80m,wind_direction_80m&wind_speed_unit=ms&past_days=10&forecast_days=3&timeformat=unixtime&timezone=UTC`,signal,20000);
        if(token!==run)return;
        const hourly={...data.hourly,time:data.hourly.time.map(t=>t*1000)};
        const scenarios=[[0,1],[-20,.8],[20,1.2]].map(([angle,scale])=>trajectory(last.center,last.at,3,hourly,'80m',false,angle,scale));
        for(const path of scenarios)L.polyline(path.points,{color:'#b9c6e7',weight:1.5,dashArray:'5 7'}).bindTooltip(`Pluma ${track.id}: escenario a 80 m, hasta ${rd(path.times.at(-1))} RD; no observación`).addTo(forecasts);
        // Screening radius based on equivalent plume footprint, capped and explicitly disclosed.
        const radius=Math.max(3,Math.min(15,Math.sqrt(last.areaKm2/Math.PI)));
        for(const [name,pLat,pLon] of places){
          let arrival=Infinity;
          for(const path of scenarios)path.points.forEach((p,i)=>{if(distance(p,[pLat,pLon])<=radius)arrival=Math.min(arrival,path.times[i]);});
          if(Number.isFinite(arrival))textBlock($('communities'),`${name}: vigilancia modelada para pluma ${track.id}, desde ${rd(arrival)} RD · criterio de cercanía ${radius.toFixed(1)} km. Escenarios de viento a 80 m ±20°/±20%; no predice concentración ni confirma exposición.`,'fine');
        }
        projected++;
      }catch(error){if(signal.aborted)return;windFailures++;textBlock($('communities'),`Pluma ${track.id}: transporte sin calcular (${error.message}).`,'fine');}
    }
    if(token!==run)return;
    // Source candidates remain in a separate layer from scene-specific observed paths.
    for(const f of sourceMarkers)L.circleMarker([f.lat,f.lon],{radius:8,color:'#ff9d5c',fillOpacity:.5}).bindTooltip(`Fuente candidata FIRMS · ${rd(f.at)} RD · confianza baja`).addTo(forecasts);
    $('community-status').textContent=`${seen.size} localidades con humo detectado sobre su punto de referencia. ${projected} plumas con escenario de 3 h desde la última escena. ${active.length>5?'Se priorizan las 5 plumas de mayor huella. ':''}${windFailures?'Existen fallos del proveedor de viento. ':''}No es un índice de calidad del aire ni una alerta oficial; las horas indicadas corresponden al intervalo analizado.`;
    const download=document.createElement('button');download.textContent='Descargar análisis y fuentes (JSON)';
    download.onclick=()=>{const blob=new Blob([JSON.stringify({generatedAt:new Date().toISOString(),begin:new Date(begin).toISOString(),end:new Date(end).toISOString(),timeZone:'America/Santo_Domingo',method:'GOES ADP masks + experimental centroid tracking + FIRMS proximity; not validated source attribution',frames,tracks,fires:allFires,fireIssues},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='humosrd-analisis.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};results.append(download);
    $('auto-analyze').disabled=false;$('auto-cancel').hidden=true;
  }
  $('auto-analyze').onclick=()=>analyze().catch(error=>{cancel();$('auto-status').textContent=`No se pudo completar el análisis: ${error.message}`;});
}
