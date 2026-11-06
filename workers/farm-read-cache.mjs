// Cache only reads. Mutations always re-read D1 and invalidate this snapshot.
const entries = new WeakMap();
export function farmReadError(error) {
  const message = [error?.message, error?.cause?.message].filter(Boolean).join(' ');
  if (/daily.*(?:read|row).*limit|exceeded.*(?:D1|row read)|D1.*free tier/i.test(message)) {
    return Object.assign(new Error('A Cloudflare bloqueou as consultas da Farm: o limite diário gratuito do banco foi atingido. A cota renova às 21h (Bahia).'), {
      status:503, code:'FARM_D1_READ_LIMIT', retryAt:Date.now()+300000,
    });
  }
  return Object.assign(new Error('A consulta da Farm falhou temporariamente. Tentaremos novamente automaticamente.'), {status:503,code:'FARM_UNAVAILABLE',retryAt:Date.now()+30000});
}
export function invalidateFarmRead(env) { entries.delete(env.DB); }
export async function farmRows(env, {fresh=false,revision}={}) {
  const load=()=>env.DB.batch([
    env.DB.prepare('SELECT revision FROM farm_sync WHERE id=1'),
    env.DB.prepare('SELECT * FROM farm_domains ORDER BY created_at DESC'),
    env.DB.prepare('SELECT * FROM farm_sites ORDER BY created_at DESC'),
    env.DB.prepare('SELECT * FROM farm_deployments ORDER BY created_at DESC'),
    env.DB.prepare('SELECT * FROM farm_ownership'),
    env.DB.prepare("SELECT * FROM farm_operations WHERE state='done' ORDER BY created_at DESC"),
  ]);
  const snapshot=async()=>{const [meta,...rows]=await load();return {rows,revision:meta.results[0].revision,at:Date.now()};};
  if(fresh)return snapshot();
  let entry=entries.get(env.DB);
  if(!entry){entry={};entries.set(env.DB,entry);}
  const fallback=()=>{
    if(entry.rows&&Date.now()-entry.at<900000)return {rows:entry.rows,revision:entry.revision,at:entry.at,error:entry.error};
    throw entry.error;
  };
  if(entry.error&&Date.now()<entry.error.retryAt)return fallback();
  // Conditional reads also stay small on a cold Worker isolate.
  if(revision!==undefined){
    try{const meta=await env.DB.prepare('SELECT revision FROM farm_sync WHERE id=1').first();
      if(String(meta.revision)===String(revision))return {revision:meta.revision,at:Date.now()};
    }catch(error){entry.error=farmReadError(error);return fallback();}
  }
  if(!entry.pending)entry.pending=(async()=>{
    try{
      // A shared D1 revision invalidates every isolate, not just the writer's cache.
      const meta=entry.rows?await env.DB.prepare('SELECT revision FROM farm_sync WHERE id=1').first():null;
      if(!entry.rows||meta.revision!==entry.revision)Object.assign(entry,await snapshot());
      entry.at=Date.now();entry.error=null;
      return {rows:entry.rows,revision:entry.revision,at:entry.at};
    }
    catch(error){entry.error=farmReadError(error);return fallback();}
    finally{entry.pending=null;}
  })();
  return entry.pending;
}
