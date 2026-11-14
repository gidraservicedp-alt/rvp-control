import {applyBusinessConflicts} from './fixtures/business-conflicts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {serviceDatabase} from './fixtures/service-db.mjs';
import * as auth from '../supabase/functions/rpv-portal/auth.ts';
import {officeOwnerEdit} from '../supabase/functions/rpv-portal/owner_edit.ts';
const id = n => `90000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = '20261114213124_owner_order_edit.sql';

test('owner corrections at every stage preserve acts, history, volume and payments; staff cannot override', async () => {
 const db = await serviceDatabase();
 try {
  await db.exec(`create schema rvp_private;grant usage on schema rvp_private to service_role;
   alter table admin_users add full_name text;
   alter table contractors add first_name text,add last_name text;
   alter table rpv_customer_sites add label text,add passport_network text,add passport_city_code text,add passport_azk_code text,add merged_into uuid;
   alter table applications add scheduled_at timestamptz,add deadline_at timestamptz,add manager_comment text,add azk_code text,add created_at timestamptz default now();
   alter table work_history alter column contractor_id drop not null;
   create table application_events(id uuid default gen_random_uuid(),application_id uuid,event_type text,title text,description text,actor_user_id uuid,actor_name text,metadata jsonb);
   grant all on application_events to service_role;`);
  for (const [n, role, active] of [[1,'owner',true],[2,'admin',true],[3,'dispatcher',true],[4,'accountant',true],[5,'viewer',true],[6,'owner',false]])
   await db.query('insert into admin_users values($1,$2,$3,$4)', [id(n),role,active,`Test ${role}`]);
  await db.query("insert into contractors(id,telegram_id,status,phone,first_name) values($1,123,'active','+380000000001','One'),($2,124,'active','+380000000002','Two'),($3,125,'inactive','+380000000003','Inactive')",[id(10),id(11),id(12)]);
  await db.query("insert into rpv_customer_sites(id,site_key,address,label,passport_network,passport_city_code,passport_azk_code) values($1,'wog-90','Old address','WOG 90','WOG','dnipro','90'),($2,'upg-90','New address','UPG 90','UPG','kyiv','90')",[id(20),id(21)]);
  for (const f of ['20261114201146_contractor_debt_history.sql','20261114204607_required_order_volume.sql',migration])
   await db.exec(await fs.readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
  await applyBusinessConflicts(db);
  const service = async (sql,args=[]) => {
   await db.exec('set role service_role');
   try { return (await db.query(sql,args)).rows; } finally { await db.exec('reset role'); }
  };
  const read = async (n,actor=id(1)) => (await service('select rpv_owner_order_read($1,$2) r',[actor,id(n)]))[0].r;
  let request = 500;
  const edit = async (n,patch,opts={}) => {
   const version = opts.version ?? (await read(n)).version;
   return (await service('select rpv_owner_order_edit($1,$2,$3,$4,$5,$6) r',
    [opts.actor||id(1),id(n),version,opts.request||id(request++),opts.reason??'Уточнення первинних даних',patch]))[0].r;
  };
  const row = async (table,n) => (await db.query(`select * from ${table} where ${table==='applications'?'id':'application_id'}=$1`,[id(n)])).rows[0];
  for (const [n,status] of [[30,'new'],[31,'assigned'],[32,'in_progress'],[33,'completed'],[34,'cancelled'],[35,'completed']]) {
   await db.query("insert into applications(id,application_number,title,address,azk_code,description,status,contractor_id,customer_site_id,actual_volume,unit_price,payout_amount,payout_status) values($1,$2,'WOG 90','Old address','90','Original work',$3,$4,$5,10,200,$6,$7)",
    [id(n),`TEST-${n}`,status,id(10),id(20),n===35?2000:0,n===35?'paid':'pending']);
  }
  // Active owner alone receives the dedicated capability, independently of UI.
  for (const n of [2,3,4,5,6,99]) {
   assert.equal((await service("select rpv_office_has_permission($1,'applications.edit_any_stage') allowed",[id(n)]))[0].allowed,false);
   await assert.rejects(read(30,id(n)), e=>e.code==='42501');
   await assert.rejects(edit(30,{description:'Forbidden'},{actor:id(n)}), e=>e.code==='42501');
  }
  assert.equal((await service("select rpv_office_has_permission($1,'unknown.permission') allowed",[id(1)]))[0].allowed,false);
  for (const n of [30,31,32,33,34,35]) {
   const status=(await row('applications',n)).status;
   await edit(n,{description:`Corrected ${n}`,manager_comment:'Owner correction'});
   assert.equal((await row('applications',n)).description,`Corrected ${n}`);
   assert.equal((await row('applications',n)).status,status);
  }
  // Correct a closed accepted result and move it to the right canonical passport.
  const today=(await db.query("select (now() at time zone 'Europe/Kyiv')::date::text d")).rows[0].d;
  await db.query("insert into acts(id,application_id,contractor_id,status,act_number,act_date,telegram_file_id,service_report) values($1,$2,$3,'approved','ACT-TEST',$4,'original-file',$5)",
   [id(40),id(33),id(10),today,{application_id:id(33),volume:10,work_date:today,contractor_id:id(10),notes:'Original contractor report'}]);
  await db.query("insert into rpv_service_reports(application_id,contractor_id,work_date,volume,notes,state) values($1,$2,$3,10,'Original contractor report','approved')",[id(33),id(10),today]);
  await db.query('insert into rpv_customer_act_data values($1,$2,$3,$4,10)',[id(40),id(33),id(20),today]);
  await db.query("insert into work_history(application_id,contractor_id,title,description,completed_at) values($1,$2,'WOG 90','Old',$3)",[id(33),id(10),today]);
  const patch={customer_site_id:id(21),contractor_id:id(11),actual_volume:12.345,work_date:'2026-01-12',description:'Correct work description',unit_price:250};
  const before=await read(33), req=id(800);
  const result=await edit(33,patch,{version:before.version,request:req});assert.equal(result.changed,true);
  const app=await row('applications',33), act=await row('acts',33), published=await row('rpv_customer_act_data',33), history=await row('work_history',33), report=await row('rpv_service_reports',33);
  assert.equal(app.status,'completed');assert.equal(app.title,'UPG 90');assert.equal(app.address,'New address');
  assert.equal(act.telegram_file_id,'original-file');assert.equal(act.status,'approved');assert.equal(act.service_report.volume,12.345);assert.equal(act.service_report.notes,'Original contractor report');assert.equal(act.contractor_id,id(11));
  assert.equal(published.site_id,id(21));assert.equal(published.pumped_m3,'12.345');assert.equal(published.work_date.toISOString().slice(0,10),'2026-01-12');
  assert.equal(history.title,'UPG 90');assert.equal(history.contractor_id,id(11));assert.equal(report.volume,'12.345');
  assert.equal((await db.query('select debt from rpv_finance_entries where id=$1',[id(33)])).rows[0].debt,'3086.25');
  const audit=(await db.query('select * from rpv_order_revisions where id=$1',[req])).rows[0];
  assert.equal(audit.before_data.acts[0].service_report.volume,10);assert.equal(audit.after_data.acts[0].service_report.volume,12.345);assert.equal(audit.actor_user_id,id(1));
  assert.equal((await edit(33,patch,{version:before.version,request:req})).changed,false,'retry is idempotent even with the old version');
  await assert.rejects(edit(33,{...patch,actual_volume:20},{request:req}),e=>e.code==='PT409');
  await assert.rejects(edit(33,{actual_volume:20},{version:before.version}),e=>e.code==='PT409');
  const timeline=(await db.query("select metadata from application_events where application_id=$1 and event_type='owner_order_edited' order by id",[id(33)])).rows;
  assert.ok(timeline.some(e=>e.metadata.changes.actual_volume?.before===10&&e.metadata.changes.actual_volume?.after===12.345));
  // A review-state change is detected even if updated_at did not change.
  const stale=await read(33);
  await db.query('update acts set reviewed_at=now() where application_id=$1',[id(33)]);
  await assert.rejects(edit(33,{manager_comment:'stale act'},{version:stale.version}),e=>e.code==='PT409');
  // Paid work volume may be corrected, while the actual payment stays immutable.
  const paid=await row('applications',35);
  await edit(35,{actual_volume:11.75,customer_site_id:id(21)});
  const paidAfter=await row('applications',35);
  for(const key of ['payout_status','payout_amount','paid_at','contractor_id'])assert.deepEqual(paidAfter[key],paid[key]);
  assert.equal(paidAfter.actual_volume,'11.75');
  for(const p of [{payout_amount:2200},{unit_price:220},{contractor_id:id(11)}])await assert.rejects(edit(35,p),e=>e.code==='P2001');
  for(const volume of [0,null,-1,1000000,1.0001,'NaN'])await assert.rejects(edit(33,{actual_volume:volume}),e=>e.code==='P2001');
  for(const p of [{status:'new'},{payout_status:'paid'},{customer_site_id:id(99)},{contractor_id:id(12)}])await assert.rejects(edit(33,p),e=>e.code==='P2001');
  await assert.rejects(edit(33,{description:'Good'},{reason:''}),e=>e.code==='P2001');
  // A failed transaction must leave reports, publication, finance and audit unchanged.
  const unchanged=await read(33), count=(await db.query('select count(*) n from rpv_order_revisions')).rows[0].n;
  await assert.rejects(edit(33,{actual_volume:0,work_date:'2026-02-01'}));
  assert.deepEqual(await read(33),unchanged);assert.equal((await db.query('select count(*) n from rpv_order_revisions')).rows[0].n,count);
  for(const role of ['anon','authenticated']) {
   for(const sig of ['rpv_owner_order_edit(uuid,uuid,text,uuid,text,jsonb)','rpv_owner_order_read(uuid,uuid)','rpv_owner_order_snapshot(uuid)'])
    assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,sig])).rows[0].ok,false);
   for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
    assert.equal((await db.query('select has_table_privilege($1,\'rpv_order_revisions\',$2) ok',[role,privilege])).rows[0].ok,false);
  }
  assert.equal((await db.query("select has_table_privilege('service_role','rpv_order_revisions','UPDATE') ok")).rows[0].ok,false);
  // A pending result stays pending; a correction cannot approve or close work.
  await db.query("insert into acts(id,application_id,contractor_id,status,act_number,service_report) values($1,$2,$3,'pending','PENDING-TEST',$4)",
   [id(41),id(32),id(10),{volume:10,work_date:today}]);
  await edit(32,{actual_volume:8.125});
  assert.equal((await row('applications',32)).status,'in_progress');
  assert.equal((await row('applications',32)).awaiting_act,true);
  assert.equal((await row('acts',32)).status,'pending');
  assert.equal((await row('acts',32)).service_report.volume,8.125);
  // Legacy accepted files without a publication need a real date, not a fabricated one.
  await db.query("insert into acts(id,application_id,contractor_id,status,act_number) values($1,$2,$3,'approved','LEGACY-TEST')",[id(42),id(35),id(10)]);
  assert.equal((await read(35)).has_result,true);
  await assert.rejects(edit(35,{actual_volume:14}),e=>e.code==='P2001');
  await edit(35,{actual_volume:14,work_date:'2026-01-15'});
  assert.equal((await row('rpv_customer_act_data',35)).pumped_m3,'14');
  assert.equal(Number((await row('applications',35)).payout_amount),2000);
  // Direct browser writes and forged context do not unlock the workflow.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);
  await db.query("select set_config('rpv.owner_edit_actor',$1,false),set_config('rpv.owner_edit_application',$2,false)",[id(1),id(35)]);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('update applications set actual_volume=20 where id=$1',[id(35)]),e=>e.code==='42501');
  await assert.rejects(db.query("update applications set description='spoof' where id=$1",[id(30)]),e=>e.code==='42501');
  await db.exec('reset role');
  // Revocation is checked again at save, after the form has already loaded.
  const open=await read(30);await db.query('update admin_users set is_active=false where user_id=$1',[id(1)]);
  await assert.rejects(edit(30,{description:'Revoked'},{version:open.version}),e=>e.code==='42501');
 } finally {await db.close();}
});

test('endpoint verifies session and fresh capability; ignores forged actor and rejects extra fields', async () => {
 let handler, role='owner', active=true, calls=[], fail=null;
 const db={auth:{getUser:async token=>({data:{user:token==='office'?{id:id(1)}:null}})},from(){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:active?{user_id:id(1),role}:null})};return q;},rpc:async(name,args)=>{calls.push({name,args});if(name==='rpv_office_has_permission')return{data:role==='owner'};return {data:{ok:true},error:fail};}};
 const source=await fs.readFile(new URL('../supabase/functions/rpv-portal/index.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','Deno',compiled)(name=>name.includes('supabase-js')?{createClient:()=>db}:name.includes('owner_edit')?{officeOwnerEdit}:name.includes('auth')?auth:name.includes('ukraine_cities')?{ukraineCities:[]}:{},{},{env:{get:()=>''},serve:fn=>handler=fn});
 const input={application:id(30),version:'a'.repeat(32),request:id(800),reason:'Уточнення',patch:{actual_volume:12.5}};
 const req=(action='office.order_edit_save',body={},token='office')=>handler(new Request('https://test.example',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token?'Bearer '+token:''},body:JSON.stringify({action,...input,...body})}));
 for(const token of ['', 'bad'])assert.equal((await req(undefined,{},token)).status,401);
 for(const r of ['admin','dispatcher','accountant','viewer']){role=r;assert.deepEqual(await(await req('office.permissions')).json(),{permissions:[]});assert.equal((await req()).status,403);assert.equal((await req('office.order_edit')).status,403);}
 role='owner';active=false;assert.equal((await req()).status,403);active=true;
 assert.deepEqual(await(await req('office.permissions')).json(),{permissions:['applications.edit_any_stage']});
 assert.equal((await req(undefined,{actor:id(2),role:'admin'})).status,200);assert.equal(calls.at(-1).args.p_actor,id(1));
 for(const patch of [{status:'completed'},{actual_volume:0},{actual_volume:'10'},{payout_amount:-1},{work_date:'2026-02-30'},{customer_site_id:'invented'}])assert.equal((await req(undefined,{patch})).status,400);
 fail={code:'PT409',message:'Оновіть дані'};assert.equal((await req()).status,409);
 fail={code:'XX000',message:'secret database internals'};const failure=await req();assert.equal(failure.status,500);assert.doesNotMatch(await failure.text(),/secret/);
});
