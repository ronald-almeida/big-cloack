import test from 'node:test';
import assert from 'node:assert/strict';
import {farmRows,invalidateFarmRead} from '../workers/farm-read-cache.mjs';
import {farmHostQuery} from '../workers/farm-public.mjs';
import {tryFarmPublic} from '../workers/farm-public.mjs';
import {harness} from './harness.mjs';

test('shared Farm reads coalesce, retain labelled last good data and back off on quota errors',async()=>{
 const realNow=Date.now;let now=1000000,reads=0,fail=false;
 Date.now=()=>now;
 const check=()=>{if(fail)throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit");};
 const env={DB:{prepare:sql=>({first:async()=>{check();return {revision:1};}}),batch:async()=>{reads++;check();await Promise.resolve();return [{results:[{revision:1}]},{results:[{id:'saved'}]}];}}};
 try{
   const [a,b]=await Promise.all([farmRows(env),farmRows(env)]);assert.deepEqual(a,b);assert.equal(reads,1);
   await farmRows(env);assert.equal(reads,1);
   await farmRows(env,{fresh:true});assert.equal(reads,2);
   now+=61000;fail=true;const stale=await farmRows(env);assert.equal(stale.rows[0].results[0].id,'saved');assert.equal(stale.error.code,'FARM_D1_READ_LIMIT');assert.equal(reads,2);
   await farmRows(env);assert.equal(reads,2);
   now+=901000;await assert.rejects(farmRows(env),e=>e.code==='FARM_D1_READ_LIMIT');
   fail=false;invalidateFarmRead(env);assert(!(await farmRows(env)).error);
 }finally{Date.now=realNow;}
});

test('committed changes invalidate another isolate immediately, unchanged reads need only one row',async()=>{
 const h=await harness();try{
   let batches=0;const reader={DB:{prepare:sql=>h.env.DB.prepare(sql),batch:queries=>{batches++;return h.env.DB.batch(queries);}}};
   const first=await farmRows(reader);assert.equal(batches,1);
   const unchanged=await farmRows(reader);assert.equal(unchanged.revision,first.revision);assert.equal(batches,1);
   const cold={DB:{prepare:sql=>h.env.DB.prepare(sql),batch:()=>{throw Error('Unchanged cold reads must not scan Farm tables');}}};
   assert.equal((await farmRows(cold,{revision:first.revision})).revision,first.revision);
   h.db.prepare("INSERT INTO farm_ownership(kind,entity_id,owner) VALUES('site','test','EMP-one')").run();
   const changed=await farmRows(reader);assert(changed.revision>first.revision);assert.equal(changed.rows[3].results[0].owner,'EMP-one');assert.equal(batches,2);
   h.db.prepare("UPDATE farm_ownership SET owner='EMP-two'").run();const updated=await farmRows(reader);assert(updated.revision>changed.revision);
   h.db.exec('DELETE FROM farm_ownership');assert((await farmRows(reader)).revision>updated.revision);
 }finally{h.close();}
});
test('public host lookup uses indexes instead of scanning every site',async()=>{
 const h=await harness();try{
   const plan=h.db.prepare('EXPLAIN QUERY PLAN '+farmHostQuery).all('example.com','com','example');
   assert(plan.some(r=>/SEARCH d USING INDEX/.test(r.detail)),JSON.stringify(plan));
   assert(plan.some(r=>/SEARCH s USING INDEX/.test(r.detail)),JSON.stringify(plan));
   assert(!plan.some(r=>/SCAN [sd]\b/.test(r.detail)),JSON.stringify(plan));
 }finally{h.close();}
});
test('a public Farm database outage returns 503 instead of falling through to panel authentication',async()=>{
 const env={DB:{prepare(){return {bind(){return {async first(){throw Error('D1 temporarily unavailable');}}}}}}};
 const r=await tryFarmPublic(new Request('https://site.example/'),env);
 assert.equal(r.status,503);assert.equal(await r.text(),'Site temporariamente indisponível');
});
