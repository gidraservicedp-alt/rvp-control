import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { serviceDatabase } from './fixtures/service-db.mjs';
import { officeWorkVolume, validWorkVolume } from '../supabase/functions/rpv-portal/work_volume.ts';
import { hasWorkVolume, parseWorkVolume, formatWorkVolume } from '../src/workspace/workVolume.ts';
import * as auth from '../supabase/functions/rpv-portal/auth.ts';

const owner='10000000-0000-0000-0000-000000000001', viewer='10000000-0000-0000-0000-000000000002';
const contractor='20000000-0000-0000-0000-000000000001', site='40000000-0000-0000-0000-000000000001';
const id=n=>`30000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('volume is required through direct writes, office approval and contractor report; history and publication use exact entered cubes',async()=>{
 const db=await serviceDatabase();
 try {
  await db.exec(`create table application_events(id uuid default gen_random_uuid(),application_id uuid,event_type text,title text,description text,actor_user_id uuid,actor_name text,metadata jsonb);
  grant all on application_events to service_role;
  alter table work_history alter column contractor_id drop not null;
  insert into admin_users values('${owner}','owner',true),('${viewer}','viewer',true);
  insert into contractors values('${contractor}',123,'active','+380111111111');
  insert into rpv_customer_sites values('${site}','wog-90','Current passport address');
  insert into applications(id,status,actual_volume) values('${id(99)}','completed',null);
  insert into acts(id,application_id,status) values('${id(98)}','${id(99)}','approved');`);
  const legacy=(await db.query('select to_jsonb(a) row from applications a where id=$1',[id(99)])).rows[0].row;
  await db.exec(await fs.readFile(new URL('../supabase/migrations/20261114204607_required_order_volume.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('select to_jsonb(a) row from applications a where id=$1',[id(99)])).rows[0].row,legacy);
  // Existing incomplete history must not block routine debt/payment metadata updates.
  await db.query('update applications set payout_amount=800 where id=$1',[id(99)]);
  await assert.rejects(db.query("update applications set actual_volume=0 where id=$1",[id(99)]),e=>e.code==='P2001');
  const version=async app=>(await db.query('select updated_at::text v from applications where id=$1',[app])).rows[0].v;
  const service=async(sql,args=[])=>{await db.exec('set role service_role');try{return(await db.query(sql,args)).rows;}finally{await db.exec('reset role');}};
  async function create(n,volume=null,withContractor=true) {
   await db.query("insert into applications(id,application_number,title,address,status,contractor_id,customer_site_id,arrived_at,actual_volume) values($1,$2,'АЗК WOG 90','Old address','in_progress',$3,$4,now(),$5)",[id(n),`G-TEST-${n}`,withContractor?contractor:null,site,volume]);
   return id(n);
  }
  async function act(app,n,report=null) {
   await db.query("insert into acts(id,application_id,contractor_id,status,act_number,service_report) select $1,id,contractor_id,'pending',$2,$3 from applications where id=$4",[id(n),`A-TEST-${n}`,report,app]);return id(n);
  }
  const review=(actId,decision='approved')=>service('select rpv_service_review($1,$2,$3,$4) r',[owner,actId,decision,'Уточніть обсяг']);
  const setVolume=(app,volume,v,actor=owner)=>service('select rpv_office_work_volume($1,$2,$3,$4) r',[actor,app,v,volume]);
  const app=await create(1),actId=await act(app,11);
  await assert.rejects(review(actId),e=>e.code==='P2001');
  assert.equal((await db.query('select status from acts where id=$1',[actId])).rows[0].status,'pending');
  assert.equal((await db.query('select count(*)::int n from work_history')).rows[0].n,0);
  for(const value of [null,0,-1,1000000,1.0001,'NaN','Infinity']) {
   await assert.rejects(setVolume(app,value,await version(app)),e=>e.code==='P2001');
   await assert.rejects(db.query("insert into applications(id,status,actual_volume) values(gen_random_uuid(),'completed',$1)",[value]),e=>e.code==='P2001');
  }
  await assert.rejects(db.query("update applications set status='completed' where id=$1",[app]),e=>e.code==='P2001');
  await assert.rejects(db.query("update acts set status='approved' where id=$1",[actId]),e=>e.code==='P2001');
  await assert.rejects(setVolume(app,12.345,await version(app),viewer),e=>e.code==='42501');
  const stale=await version(app);await setVolume(app,12.345,stale);
  await assert.rejects(setVolume(app,90,stale),e=>e.code==='40001');
  assert.equal((await review(actId))[0].r.changed,true);
  assert.equal((await review(actId))[0].r.changed,false);
  assert.equal((await db.query('select actual_volume from applications where id=$1',[app])).rows[0].actual_volume,'12.345');
  assert.equal((await db.query('select pumped_m3 from rpv_customer_act_data where application_id=$1',[app])).rows[0].pumped_m3,'12.345');
  assert.equal((await db.query('select count(*)::int n from work_history where application_id=$1',[app])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from application_events where application_id=$1',[app])).rows[0].n,1);
  assert.equal((await service("select * from rpv_customer_publish($1,'wog-90',current_date,$2)",['A-TEST-11',999])).length,0);
  await assert.rejects(setVolume(app,99,await version(app)),e=>e.code==='40001');
  const other=await create(2);
  const today=(await db.query("select (now() at time zone 'Europe/Kyiv')::date::text d")).rows[0].d;
  const report=(volume,user=123)=>service('select rpv_service_report($1,$2,$3,$4,$5,$6)',[user,other,null,today,volume,'']);
  await assert.rejects(report(null),e=>e.code==='P2001');
  await assert.rejects(report(10,456),e=>e.code==='42501');
  await service('select rpv_service_report($1,$2,$3,$4,$5,$6)',[123,other,await version(other),today,7.125,'2 рейси']);
  assert.equal((await db.query('select actual_volume from applications where id=$1',[other])).rows[0].actual_volume,'7.125');
  await service('select rpv_service_attach($1,$2,$3,$4,$5,$6)',[123,other,id(12),'test-file','document','act.pdf']);
  await assert.rejects(setVolume(other,10,await version(other)),e=>e.code==='P2002');
  await assert.rejects(db.query('update applications set actual_volume=null where id=$1',[other]),e=>e.code==='P2002');
  await review(id(12));
  assert.equal((await db.query('select sum(pumped_m3) total from rpv_customer_act_data')).rows[0].total,'19.470');
  const unassigned=await create(3,null,false);await act(unassigned,13);
  await setVolume(unassigned,0.001,await version(unassigned));await review(id(13));
  assert.equal((await db.query('select contractor_id from work_history where application_id=$1',[unassigned])).rows[0].contractor_id,null);
  const cancel=await create(4);await db.query("update applications set status='cancelled' where id=$1",[cancel]);
  const oldDraft=await create(5);
  await db.query("insert into rpv_service_reports(application_id,contractor_id,work_date,volume,notes) values($1,$2,current_date,null,'')",[oldDraft,contractor]);
  await assert.rejects(service('select rpv_service_attach($1,$2,$3,$4,$5,$6)',[123,oldDraft,id(15),'legacy-file','document','act.pdf']),e=>e.code==='P2001');
  assert.equal((await db.query('select count(*)::int n from acts where application_id=$1',[oldDraft])).rows[0].n,0);
  // A conflicting prior publication rolls back approval, completion and history together.
  const conflict=await create(6,8),conflictAct=await act(conflict,16);
  await db.query('insert into rpv_customer_act_data(act_id,application_id,site_id,work_date,pumped_m3) values($1,$2,$3,current_date,9)',[conflictAct,conflict,site]);
  await assert.rejects(review(conflictAct),e=>e.code==='22023');
  assert.equal((await db.query('select status from applications where id=$1',[conflict])).rows[0].status,'in_progress');
  assert.equal((await db.query('select status from acts where id=$1',[conflictAct])).rows[0].status,'pending');
  assert.equal((await db.query('select count(*)::int n from work_history where application_id=$1',[conflict])).rows[0].n,0);
  for(const role of ['anon','authenticated']) {
   assert.equal((await db.query(`select has_function_privilege('${role}','rpv_office_work_volume(uuid,uuid,timestamptz,numeric)','execute') ok`)).rows[0].ok,false);
  }
 } finally {await db.close();}
});

test('browser and endpoint accept exact positive decimals only',()=>{
 for(const [value,expected] of [['12,345',12.345],[' 7.5 ',7.5],['0.001',0.001],['',null],['0',null],['-1',null],['NaN',null],['Infinity',null],['12 м³',null],['1e2',null],['1000000',null],['1.2345',null]])assert.equal(parseWorkVolume(value),expected);
 for(const value of [null,undefined,'12',NaN,Infinity,0,-1,0.0001,1000000]){assert.equal(validWorkVolume(value),false);assert.equal(hasWorkVolume(value),false);}
 assert.equal(validWorkVolume(12.345),true);assert.match(formatWorkVolume(12.345),/12,345 м³/);assert.equal(formatWorkVolume(null),'Обсяг не вказано');
});

test('office volume reads/writes use current auth, permissions and version; errors stay actionable',async()=>{
 let role='owner',handler,calls=0,fail=null,args;
 const app=id(1);
 const db={auth:{getUser:async token=>({data:{user:token==='office'?{id:owner}:null}})},from(table){const q={select(){return q;},eq(){return q;},in:async()=>({data:[]}),maybeSingle:async()=>({data:table==='admin_users'?{user_id:owner,role}:{actual_volume:12.5,updated_at:'2026-11-14T10:00:00Z',status:'in_progress'}})};return q;},rpc:async(name,input)=>{calls++;args=input;assert.equal(name,'rpv_office_work_volume');return {data:{ok:true},error:fail};}};
 const source=await fs.readFile(new URL('../supabase/functions/rpv-portal/index.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','Deno',compiled)(name=>name.includes('supabase-js')?{createClient:()=>db}:name.includes('work_volume')?{officeWorkVolume,validWorkVolume}:name.includes('auth')?auth:name.includes('ukraine_cities')?{ukraineCities:[]}:{},{},{env:{get:()=>''},serve:fn=>handler=fn});
 const req=(action='office.work_volume',body={},token='office')=>handler(new Request('https://test.example',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token?'Bearer '+token:''},body:JSON.stringify({action,application:app,...body})}));
 assert.equal((await req('office.work_volume',{},'')).status,401);
 assert.equal((await req('office.work_volume',{},'bad')).status,401);
 const input={version:'2026-11-14T10:00:00Z',volume:12.345};
 for(const value of ['viewer','accountant']){role=value;assert.equal((await(await req()).json()).can_edit,false);assert.equal((await req('office.work_volume_set',input)).status,403);}
 role='owner';
 for(const volume of [null,0,-1,'12',1.2345,1000000])assert.equal((await req('office.work_volume_set',{...input,volume})).status,400);
 assert.equal(calls,0);assert.equal((await req('office.work_volume_set',input)).status,200);assert.equal(args.p_volume,12.345);assert.equal(args.p_actor,owner);
 fail={code:'P2002',message:'Обсяг має відповідати результату виконавця.'};assert.equal((await req('office.work_volume_set',input)).status,409);
 fail={code:'XX000',message:'private database details'};const r=await req('office.work_volume_set',input);assert.equal(r.status,500);assert.doesNotMatch(await r.text(),/private database/);
});
