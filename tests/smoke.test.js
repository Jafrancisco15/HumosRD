import test from 'node:test';
import assert from 'node:assert/strict';
import {frameSlots,trackSmoke,rankOrigins,observedPlaces} from '../dist/smoke-core.js';
import {resolveTime} from '../api/imagery.js';
const t=Date.parse('2026-09-08T14:00:21Z');
const component=(center=[18.5,-69.9],cells=['1:1'])=>({id:0,center,cells,areaKm2:4,pixels:cells.length});
const frame=(at,c=component())=>({status:'ok',at:new Date(at).toISOString(),components:[c]});
test('RD interval converts to UTC and only includes full scenes',()=>{
  const a=Date.parse('2026-09-08T10:05-04:00'),b=Date.parse('2026-09-08T10:31-04:00');
  assert.deepEqual(frameSlots(a,b),[Date.parse('2026-09-08T14:10Z'),Date.parse('2026-09-08T14:20Z')]);
  assert.throws(()=>frameSlots(a,a));assert.throws(()=>frameSlots(a,a+25*3600000));
});
test('tracks nearby consecutive smoke but breaks on missing scenes and distant objects',()=>{
  assert.equal(trackSmoke([frame(t),frame(t+600000,component([18.5,-69.88]))])[0].samples.length,2);
  assert.equal(trackSmoke([frame(t),frame(t+1200000)]).length,2);
  assert.equal(trackSmoke([frame(t),frame(t+600000,component([19,-69.2],['99:99']))]).length,2);
});
test('one-to-one association does not link two objects in the same frame',()=>{
  const f=frame(t+600000);f.components.push({...component([18.5,-69.89],['1:2']),id:1});
  const tracks=trackSmoke([frame(t),f]);assert.equal(tracks.length,2);assert.equal(tracks[0].samples.length,2);
});
test('source candidates must precede plume and be opposite observed motion',()=>{
  const track=trackSmoke([frame(t),frame(t+600000,component([18.5,-69.88]))])[0];
  const upstream={lat:18.5,lon:-69.91,at:t-3600000};
  assert.equal(rankOrigins(track,[upstream,{...upstream,at:t+1},{...upstream,lon:-69.88}]).length,1);
  assert.equal(rankOrigins({samples:[track.samples[0]]},[upstream]).length,0);
});
test('community observation requires point inside an actual smoke pixel',()=>{
  const f={status:'ok',mask:{features:[{geometry:{coordinates:[[[-70,18],[-69,18],[-69,19],[-70,19],[-70,18]]]}}]}};
  assert.deepEqual(observedPlaces(f,[['inside',18.5,-69.5],['outside',20,-69.5]]),['inside']);
});
test('GIBS resolves published intervals, gaps, daily scenes and invalid layer',()=>{
  const xml='<Layer><ows:Identifier>goes</ows:Identifier><Dimension><ows:Identifier>Time</ows:Identifier><Value>2026-09-08T10:00:00Z/2026-09-08T10:20:00Z/PT10M</Value><Value>2026-09-08T11:00:00Z</Value></Dimension></Layer>';
  assert.equal(resolveTime(xml,'goes',Date.parse('2026-09-08T10:57Z')),Date.parse('2026-09-08T10:20Z'));
  assert.throws(()=>resolveTime(xml,'bad',t));
  assert.throws(()=>resolveTime(xml,'goes',Date.parse('2026-09-07')));
});
