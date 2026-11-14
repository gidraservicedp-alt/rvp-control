import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {serviceDatabase} from './fixtures/service-db.mjs';
import {applyBusinessConflicts} from './fixtures/business-conflicts.mjs';
import * as auth from '../supabase/functions/rpv-portal/auth.ts';

test('business conflicts return PT409 without changing data or weakening the assignment guard', async () => {
  const db = await serviceDatabase();
  try {
    await applyBusinessConflicts(db);
    const owner='10000000-0000-0000-0000-000000000001', app='30000000-0000-0000-0000-000000000001', contractor='20000000-0000-0000-0000-000000000001';
    await db.query("insert into admin_users values($1,'owner',true)",[owner]);
    await db.query("insert into contractors values($1,123,'active','+380000000001')",[contractor]);
    await db.query("insert into applications(id,updated_at) values($1,'2026-11-14T10:00:00Z')",[app]);
    const before=(await db.query('select to_jsonb(a) a from applications a')).rows;
    await db.exec('set role service_role');
    await assert.rejects(db.query('select rpv_service_assign($1,$2,$3,$4)',
      [owner,app,contractor,'2026-11-14T09:00:00Z']), e=>e.code==='PT409');
    await db.exec('reset role');
    assert.deepEqual((await db.query('select to_jsonb(a) a from applications a')).rows,before);
    assert.equal((await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosrc like '%40001%'")).rows[0].n,0);
  } finally {await db.close();}
});

test('assignment conflicts reach the caller as a single 409 without sending a notification or retrying', async () => {
  let handler, code='PT409', calls=0, notices=0;
  const id='10000000-0000-0000-0000-000000000001';
  const db={auth:{getUser:async()=>({data:{user:{id}}})},from(){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{user_id:id,role:'owner'}})};return q;},
    rpc:async name=>{assert.equal(name,'rpv_service_assign');calls++;return {error:{code,message:'Cannot reassign'}};}};
  const source=await fs.readFile(new URL('../supabase/functions/rpv-portal/index.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports','Deno','fetch',compiled)(name=>name.includes('supabase-js')?{createClient:()=>db}:name.includes('auth')?auth:name.includes('ukraine_cities')?{ukraineCities:[]}:{},{},
    {env:{get:()=>''},serve:fn=>handler=fn},async()=>{notices++;throw new Error('Must not notify on conflict');});
  for(code of ['PT409','40001']) {
    const before=calls;
    const r=await handler(new Request('https://test.example',{method:'POST',headers:{Authorization:'Bearer valid','Content-Type':'application/json'},
      body:JSON.stringify({action:'office.assign',application:id,contractor:id,version:'2026-11-14T09:00:00Z'})}));
    assert.equal(r.status,409);assert.match((await r.json()).error,/Оновіть/);
    assert.equal(calls-before,1);assert.equal(notices,0);
  }
});
