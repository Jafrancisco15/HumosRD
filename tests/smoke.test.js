import test from 'node:test';
import assert from 'node:assert/strict';
import {frameSlots,trackSmoke,rankOrigins,observedPlaces,summarizeLocality,observationVerdict} from '../dist/smoke-core.js';
import {resolveTime} from '../api/imagery.js';
const t=Date.parse('2026-09-08T14:00:21Z');
const component=(center=[18.5,-69.9],cells=['1:1'],areaKm2=4)=>({id:0,center,cells,areaKm2,pixels:cells.length});
const frame=(at,c=component())=>({status:'ok',at:new Date(at).toISOString(),components:[c]});
test('zero useful coverage is unobservable, never a negative smoke finding',()=>{
  const f={status:'ok',coverage:{usablePixels:0},components:[],localities:[{name:'San Luis',usablePixels:0,usableFraction:0,detectedPixels:0,lowConfidenceDetectedPixels:0,cloudPixels:7,snowIcePixels:0,invalidSzaPixels:0,invalidVzaPixels:0,invalidQualityPixels:0}]};
  assert.match(observationVerdict([f]),/^SIN OBSERVACIÓN ÚTIL/);assert.equal(summarizeLocality([f],'San Luis').verdict,'unobservable');assert.match(observationVerdict([{status:'unavailable'}]),/^SIN DATOS/);
});
test('regional usable coverage cannot imply San Luis was observed',()=>{
  const f={status:'ok',coverage:{usablePixels:200},components:[],localities:[{name:'San Luis',usablePixels:0,usableFraction:0,detectedPixels:0,lowConfidenceDetectedPixels:0,cloudPixels:7,snowIcePixels:0,invalidSzaPixels:0,invalidVzaPixels:0,invalidQualityPixels:0}]};
  assert.equal(summarizeLocality([f],'San Luis').usefulFrames,0);assert.equal(summarizeLocality([f],'San Luis').verdict,'unobservable');
});
test('local summary distinguishes cloud, angles, bad quality and low-confidence smoke',()=>{
  const local={name:'San Luis',usablePixels:5,usableFraction:.5,detectedPixels:0,lowConfidenceDetectedPixels:1,cloudPixels:1,snowIcePixels:0,invalidSzaPixels:2,invalidVzaPixels:1,invalidQualityPixels:1};
  const s=summarizeLocality([{status:'ok',localities:[local]},{status:'unavailable'}],'San Luis');
  assert.equal(s.coverage,.25);assert.equal(s.lowConfidenceSmokeFrames,1);assert.equal(s.invalidSzaFrames,1);assert.equal(s.invalidVzaFrames,1);assert.equal(s.verdict,'not_confirmed');
});
test('RD interval converts to UTC and only includes full scenes',()=>{
  const a=Date.parse('2026-09-08T10:05-04:00'),b=Date.parse('2026-09-08T10:31-04:00');assert.deepEqual(frameSlots(a,b),[Date.parse('2026-09-08T14:10Z'),Date.parse('2026-09-08T14:20Z')]);assert.throws(()=>frameSlots(a,a));assert.throws(()=>frameSlots(a,a+25*3600000));
});
test('tracks nearby consecutive smoke but breaks on missing scenes and distant objects',()=>{
  assert.equal(trackSmoke([frame(t),frame(t+600000,component([18.5,-69.88]))])[0].samples.length,2);assert.equal(trackSmoke([frame(t),frame(t+1200000)]).length,2);assert.equal(trackSmoke([frame(t),frame(t+600000,component([19,-69.2],['99:99']))]).length,2);
});
test('motion prediction preserves track through a plausible third position',()=>{
  const tracks=trackSmoke([frame(t,component([18.5,-69.90],['1:1'])),frame(t+600000,component([18.5,-69.88],['1:2'])),frame(t+1200000,component([18.5,-69.86],['1:3']))]);assert.equal(tracks.length,1);assert.equal(tracks[0].samples.length,3);
});
test('one-to-one association does not link two objects in the same frame',()=>{
  const f=frame(t+600000);f.components.push({...component([18.5,-69.89],['1:2']),id:1});const tracks=trackSmoke([frame(t),f]);assert.equal(tracks.length,2);assert.equal(tracks[0].samples.length,2);
});
test('source candidates must precede plume and lie in an upstream cone',()=>{
  const track=trackSmoke([frame(t),frame(t+600000,component([18.5,-69.88]))])[0];const upstream={lat:18.5,lon:-69.91,at:t-3600000};const lateral={lat:18.53,lon:-69.9,at:t-3600000};
  const result=rankOrigins(track,[upstream,{...upstream,at:t+1},{...upstream,lon:-69.88},lateral]);assert.equal(result.length,1);assert.equal(result[0].lon,-69.91);assert.ok(result[0].upstreamAlignment<-.35);assert.equal(rankOrigins({samples:[track.samples[0]]},[upstream]).length,0);
});
test('community observation requires point inside an actual primary smoke pixel',()=>{
  const f={status:'ok',mask:{features:[{geometry:{coordinates:[[[-70,18],[-69,18],[-69,19],[-70,19],[-70,18]]]}}]}};assert.deepEqual(observedPlaces(f,[['inside',18.5,-69.5],['outside',20,-69.5]]),['inside']);
});
test('GIBS resolves published intervals, gaps, daily scenes and invalid layer',()=>{
  const xml='<Layer><ows:Identifier>goes</ows:Identifier><Dimension><ows:Identifier>Time</ows:Identifier><Value>2026-09-08T10:00:00Z/2026-09-08T10:20:00Z/PT10M</Value><Value>2026-09-08T11:00:00Z</Value></Dimension></Layer>';assert.equal(resolveTime(xml,'goes',Date.parse('2026-09-08T10:57Z')),Date.parse('2026-09-08T10:20Z'));assert.throws(()=>resolveTime(xml,'bad',t));assert.throws(()=>resolveTime(xml,'goes',Date.parse('2026-09-07')));
});
