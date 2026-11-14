import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {serviceDatabase} from './fixtures/service-db.mjs';
import {officeCreateApplication} from '../supabase/functions/rpv-portal/office_create.ts';
import {loadNetworkSites} from '../src/components/siteOptions.ts';
import * as auth from '../supabase/functions/rpv-portal/auth.ts';

const uid = n => `${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const owner=uid(1), dispatcher=uid(2), viewer=uid(3), inactive=uid(4), accountant=uid(5);
const wog=uid(10), upg=uid(11), merged=uid(12), contractor=uid(20);

test('office creation copies one existing passport, preserves code, permissions and retry identity',async()=>{
 const db=await serviceDatabase();
 try {
  await db.exec(`alter table rpv_customer_sites add label text, add passport_network text, add passport_azk_code text, add merged_into uuid;
   alter table applications add scheduled_at timestamptz, add deadline_at timestamptz, add order_date_text text,
    add manager_comment text, add request_source text, add azk_code text;
   insert into admin_users values('${owner}','owner',true),('${dispatcher}','dispatcher',true),('${viewer}','viewer',true),('${inactive}','owner',false),('${accountant}','accountant',true);
   insert into contractors values('${contractor}',123,'active','+380000000000');
   insert into rpv_customer_sites(id,label,address,passport_network,passport_azk_code,merged_into) values
    ('${wog}','АЗК WOG 0013','WOG address','WOG','0013',null),
    ('${upg}','АЗК UPG 0013','UPG address','UPG','0013',null),
    ('${merged}','Old WOG 0013','Old address','WOG','0013','${wog}');`);
  await db.exec(await fs.readFile(new URL('../supabase/migrations/20261114211048_office_create_from_passport.sql',import.meta.url),'utf8'));
  const create=async(request,site=wog,actor=owner,amount=4000,work='Відкачка РПВ',contract=contractor)=>{
   await db.exec('set role service_role');
   try{return (await db.query('select * from rpv_office_create_application($1,$2,$3,$4,$5,$6,$7,$8)',[actor,site,request,work,'2026-11-16',contract,'Примітка',amount])).rows[0];}
   finally{await db.exec('reset role');}
  };
  const a=await create(uid(100)), replay=await create(uid(100));
  assert.equal(a.created,true);assert.equal(replay.created,false);assert.equal(a.id,replay.id);
  const row=(await db.query('select * from applications where id=$1',[a.id])).rows[0];
  assert.equal(row.customer_site_id,wog);assert.equal(row.title,'АЗК WOG 0013');assert.equal(row.azk_code,'0013');assert.equal(row.address,'WOG address');
  assert.equal(row.status,'assigned');assert.equal(row.contractor_stage,'offered');assert.equal(row.actual_volume,null);
  assert.equal(row.payout_amount,'4000');assert.equal(row.payout_status,'pending');
  assert.equal(new Date(row.deadline_at).toISOString(),'2026-11-16T21:59:59.000Z');
  await create(uid(101),upg);
  assert.equal((await db.query('select count(*)::int n from applications where customer_site_id=$1',[wog])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from applications where customer_site_id=$1',[upg])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from rpv_customer_sites')).rows[0].n,3);
  assert.equal((await db.query("select count(*)::int n from rpv_portal_events where action='office_create'")).rows[0].n,2);
  await assert.rejects(create(uid(100),upg),e=>e.code==='P2002');
  await assert.rejects(create(uid(100),wog,dispatcher,0),e=>e.code==='P2002');
  for(const actor of [viewer,inactive,accountant,uid(9)]) await assert.rejects(create(uid(102),wog,actor),e=>e.code==='42501');
  await assert.rejects(create(uid(102),wog,dispatcher,1),e=>e.code==='42501');
  await create(uid(102),upg,dispatcher,0);
  for(const site of [null,merged,uid(99)]) await assert.rejects(create(uid(103),site),e=>['P2001','P2002'].includes(e.code));
  for(const payout of [null,-1,'NaN','Infinity',100000000,0.001]) await assert.rejects(create(uid(103),wog,owner,payout),e=>e.code==='P2001');
  for(const work of ['', 'x'.repeat(2001)]) await assert.rejects(create(uid(103),wog,owner,0,work),e=>e.code==='P2001');
  await db.query("update contractors set status='inactive' where id=$1",[contractor]);
  await assert.rejects(create(uid(103)),e=>e.code==='P2002');
  await db.query("update contractors set status='active',telegram_id=null where id=$1",[contractor]);
  await assert.rejects(create(uid(103)),e=>e.code==='P2002');
  await db.query('update contractors set telegram_id=123 where id=$1',[contractor]);
  await db.query("update rpv_customer_sites set address='Updated address' where id=$1",[wog]);
  await create(uid(103));
  assert.equal((await db.query('select address from applications where id=$1',[uid(103)])).rows[0].address,'Updated address');
  for(const role of ['anon','authenticated']) assert.equal((await db.query(`select has_function_privilege('${role}','rpv_office_create_application(uuid,uuid,uuid,text,date,uuid,text,numeric)','execute') ok`)).rows[0].ok,false);
 } finally {await db.close();}
});

test('office endpoint authenticates, ignores client identity text and reports notification failure without losing saved order',async()=>{
 let role='owner', handler, calls=0, args, fail=null, created=true, notices=0, delivered=true;
 const db={auth:{getUser:async token=>({data:{user:token==='office'?{id:owner}:null}})},
  from(){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{user_id:owner,role}})};return q;},
  rpc:async(name,input)=>{calls++;args=input;assert.equal(name,'rpv_office_create_application');return {data:[{id:uid(100),application_number:'G-TEST',created}],error:fail};}};
 const compiled=ts.transpileModule(await fs.readFile(new URL('../supabase/functions/rpv-portal/index.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','Deno','fetch',compiled)(name=>name.includes('supabase-js')?{createClient:()=>db}:name.includes('office_create')?{officeCreateApplication}:name.includes('auth')?auth:name.includes('ukraine_cities')?{ukraineCities:[]}:{},{},{env:{get:()=>''},serve:fn=>handler=fn},async()=>{notices++;return Response.json({ok:delivered});});
 const body={site:wog,request:uid(100),contractor,work:'Відкачка РПВ',date:'2026-11-16',comment:'',payout:4000};
 const req=(extra={},token='office')=>handler(new Request('https://test.example',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token?'Bearer '+token:''},body:JSON.stringify({action:'office.create_application',...body,...extra})}));
 for(const token of ['','bad']) assert.equal((await req({},token)).status,401);
 for(const denied of ['viewer','accountant']) {role=denied;assert.equal((await req()).status,403);}role='owner';
 for(const invalid of [{site:''},{request:'x'},{contractor:null},{work:''},{date:'2026-02-30'},{date:'2026-11-16T00:00:00Z'},{payout:'4000'},{payout:1.234},{payout:-1}]) assert.equal((await req(invalid)).status,400);
 assert.equal(calls,0);
 const r=await req({title:'Wrong name',address:'Wrong address',azk_code:'Wrong code',p_actor:viewer});
 assert.equal(r.status,200);assert.equal((await r.json()).notificationSent,true);
 assert.equal(args.p_site,wog);assert.equal(args.p_actor,owner);assert.equal('p_title' in args,false);assert.equal('p_address' in args,false);
 delivered=false;const saved=await req();assert.equal(saved.status,200);assert.equal((await saved.json()).notificationSent,false);
 created=false;const repeat=await req();assert.equal((await repeat.json()).notificationSent,null);assert.equal(notices,2);
 fail={code:'P2002',message:'Паспорт об’єднано. Оновіть список.'};assert.equal((await req()).status,409);assert.equal(notices,2);
 fail={code:'XX000',message:'private details'};const error=await req();assert.equal(error.status,500);assert.doesNotMatch(await error.text(),/private details/);
});

test('AZK selector loads beyond the first 50, preserves leading zeros and discards obsolete network results',async()=>{
 const make=(n,network='WOG')=>({id:uid(1000+n),code:String(n).padStart(4,'0'),region:'Дніпро',passport_network:network,address:`Address ${n}`});
 const calls=[];
 const sites=await loadNetworkSites('WOG',async(network,page)=>{calls.push([network,page]);return page===0?{sites:Array.from({length:50},(_,n)=>make(n+1)),more:true}:{sites:[make(50),make(51)],more:false};});
 assert.equal(sites.length,51);assert.equal(sites[12].code,'0013');assert.equal(sites[50].id,uid(1051));assert.deepEqual(calls,[['WOG',0],['WOG',1]]);
 let active=true;
 assert.equal(await loadNetworkSites('WOG',async()=>{active=false;return {sites:[make(1)],more:true};},()=>active),null);
 await assert.rejects(loadNetworkSites('UPG',async()=>{throw new Error('Network unavailable');}),/Network unavailable/);
 await assert.rejects(loadNetworkSites('WOG',async()=>({sites:[],more:true})),/повний список/);
 assert.deepEqual(await loadNetworkSites('UPG',async()=>({sites:[],more:false})),[]);
});
