import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/fires.js';
function response(){return {code:200,headers:{},status(c){this.code=c;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;return this;}};}
test('API rejects invalid date and method',async()=>{let r=response();await handler({method:'POST',query:{}},r);assert.equal(r.code,405);r=response();await handler({method:'GET',query:{date:'2026-02-31'}},r);assert.equal(r.code,400);});
test('API explicitly distinguishes missing key, partial provider failure and empty coverage',async()=>{
  const old=process.env.FIRMS_MAP_KEY,originalFetch=globalThis.fetch;
  try{
    delete process.env.FIRMS_MAP_KEY;
    const req={method:'GET',query:{date:new Date().toISOString().slice(0,10)}};
    let r=response();await handler(req,r);assert.equal(r.code,503);assert.equal(r.body.code,'MISSING_KEY');
    process.env.FIRMS_MAP_KEY='test-only';
    globalThis.fetch=async url=>{if(url.includes('NOAA20'))throw new Error('simulated');return {ok:true,text:async()=>'latitude,longitude,frp,confidence,acq_date,acq_time\n'};};
    r=response();await handler(req,r);assert.equal(r.code,200);assert.equal(r.body.partial,true);assert.equal(r.body.fires.length,0);assert.equal(r.body.sources.filter(s=>s.status==='unavailable').length,1);
    globalThis.fetch=async()=>({ok:false});r=response();await handler(req,r);assert.equal(r.code,502);assert.ok(r.body.error);
  }finally{if(old===undefined)delete process.env.FIRMS_MAP_KEY;else process.env.FIRMS_MAP_KEY=old;globalThis.fetch=originalFetch;}
});
