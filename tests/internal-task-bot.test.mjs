import {applyBusinessConflicts} from './fixtures/business-conflicts.mjs';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to service_role;');
await db.exec(await readFile(new URL('../supabase/migrations/20261111142353_internal_task_test_bot.sql',import.meta.url),'utf8'));
 await applyBusinessConflicts(db);
const t=(await db.query("insert into gidra_internal_tasks(chat_id,thread_id,source_message_id,creator_id,creator_name,body) values(-1001,12,10,1,'Author','Test task') returning *")).rows[0];
async function act(action,user=2,version=0,update=1,admin=false,reason='',chat=-1001,thread=12){await db.exec('set role service_role');try{return(await db.query('select gidra_internal_task_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) t',[t.id,chat,thread,user,'Actor',action,version,update,admin,reason])).rows[0].t;}finally{await db.exec('reset role');}}
await assert.rejects(act('take',2,0,1,false,'',-1002),e=>e.code==='P0002');
await assert.rejects(act('take',2,0,1,false,'',-1001,13),e=>e.code==='P0002');
assert.equal((await act('take')).assignee_id,2);
assert.equal((await act('take')).version,1); // Retry cannot produce a second event.
await assert.rejects(act('take',3,0,2),e=>e.code==='PT409');
await assert.rejects(act('done',3,1,3),e=>e.code==='42501');
await assert.rejects(act('block',2,1,4),e=>e.code==='22023');
assert.equal((await act('block',2,1,5,false,'Need an act')).state,'blocked');
assert.equal((await act('resume',2,2,6)).state,'working');
assert.equal((await act('done',2,3,7)).state,'done');
await assert.rejects(act('reopen',2,4,8),e=>e.code==='42501');
const r=await act('reopen',1,4,9);assert.equal(r.state,'new');assert.equal(r.assignee_id,null);
assert.equal((await db.query('select count(*)::int n from gidra_internal_task_events')).rows[0].n,5);
for(const role of ['anon','authenticated']){
 assert.equal((await db.query(`select has_table_privilege('${role}','gidra_internal_tasks','select') p`)).rows[0].p,false);
 assert.equal((await db.query(`select has_function_privilege('${role}','gidra_internal_task_action(uuid,bigint,bigint,bigint,text,text,integer,bigint,boolean,text)','execute') p`)).rows[0].p,false);
}
console.log('PASS internal task bot: scoped chats/topics, assignment, actor permissions, reason, stale buttons, retry idempotency and private database grants.');await db.close();
