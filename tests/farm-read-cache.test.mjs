import test from 'node:test';
import assert from 'node:assert/strict';
import {farmRows,invalidateFarmRead} from '../workers/farm-read-cache.mjs';
import {farmHostQuery} from '../workers/farm-public.mjs';
import {harness} from './harness.mjs';

test('shared Farm reads coalesce, expire, retain labelled last good data and back off on quota errors',async()=>{
 const realNow=Date.now;let now=1000000,reads=0,fail=false;
 Date.now=()=>now;
 const env={DB:{prepare:sql=>sql,batch:async()=>{reads++;if(fail)throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit");await Promise.resolve();return [{results:[{id:'saved'}]}];}}};
 try{
   const [a,b]=await Promise.all([farmRows(env),farmRows(env)]);assert.deepEqual(a,b);assert.equal(reads,1);
   await farmRows(env);assert.equal(reads,1);
   await farmRows(env,{fresh:true});assert.equal(reads,2);
   now+=61000;fail=true;const stale=await farmRows(env);assert.equal(stale.rows[0].results[0].id,'saved');assert.equal(stale.error.code,'FARM_D1_READ_LIMIT');assert.equal(reads,3);
   await farmRows(env);assert.equal(reads,3);
   now+=901000;await assert.rejects(farmRows(env),e=>e.code==='FARM_D1_READ_LIMIT');
   fail=false;invalidateFarmRead(env);assert(!(await farmRows(env)).error);
 }finally{Date.now=realNow;}
});
test('public host lookup uses indexes instead of scanning every site',async()=>{
 const h=await harness();try{
   const plan=h.db.prepare('EXPLAIN QUERY PLAN '+farmHostQuery).all('example.com','com','example');
   assert(plan.some(r=>/SEARCH d USING INDEX/.test(r.detail)),JSON.stringify(plan));
   assert(plan.some(r=>/SEARCH s USING INDEX/.test(r.detail)),JSON.stringify(plan));
   assert(!plan.some(r=>/SCAN [sd]\b/.test(r.detail)),JSON.stringify(plan));
 }finally{h.close();}
});
