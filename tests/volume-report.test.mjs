import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as auth from '../supabase/functions/rpv-portal/auth.ts';
import * as volume from '../supabase/functions/rpv-portal/volume_report.ts';
import { volumeCsv } from '../src/workspace/volume.ts';
const ids=Array.from({length:5},(_,i)=>`40000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);

test('one RPV source matches managers, filters regions/networks/sites, preserves monthly history and exports beyond one page',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table rpv_customer_sites(id uuid primary key,label text,passport_azk_code text,passport_network text,passport_city_code text,merged_into uuid);
 create table applications(id uuid primary key);
 create table acts(id uuid primary key,application_id uuid,status text);
 create table rpv_customer_act_data(act_id uuid primary key,application_id uuid unique,site_id uuid,work_date date,pumped_m3 numeric);
 create table access(telegram_id bigint,site_id uuid);
 create view rpv_customer_visible_sites as select distinct telegram_id,site_id id from access;
 grant select on all tables in schema public to service_role;`);
 for(let i=0;i<ids.length;i++)await db.query('insert into rpv_customer_sites values($1,$2,$3,$4,$5,$6)',[ids[i],`АЗК ${i+1}`,String(90+i),i===2?'UPG':'WOG',i===1?'UA80000000000093317':'UA12020010010037010',i===4?ids[0]:null]);
 await db.query('insert into access values(123,$1),(123,$1),(124,$1),(123,$2)',[ids[0],ids[1]]);
 const date=(await db.query("select (now() at time zone 'Europe/Kyiv')::date::text today,to_char(now() at time zone 'Europe/Kyiv','YYYY-MM-01') as month_start,to_char((now() at time zone 'Europe/Kyiv')-interval '1 month','YYYY-MM-01') archive,((now() at time zone 'Europe/Kyiv')::date+1)::text tomorrow")).rows[0];
 let n=0;
 async function act(site,amount,day=date.today,status='approved',published=true,mismatch=false){
  const id=`60000000-0000-0000-0000-${String(++n).padStart(12,'0')}`;
  await db.query('insert into applications values($1)',[id]);
  await db.query('insert into acts values($1,$2,$3)',[id,mismatch?ids[0]:id,status]);
  if(published)await db.query('insert into rpv_customer_act_data values($1,$1,$2,$3,$4)',[id,site,day,amount]);
 }
 await act(ids[0],10.125);await act(ids[0],null);await act(ids[1],20.2);await act(ids[2],30);
 await act(ids[0],7.75,date.archive);await act(ids[0],999,date.tomorrow);
 await act(ids[0],100,date.today,'pending');await act(ids[0],100,date.today,'rejected');
 await act(ids[0],100,date.today,'approved',false);await act(ids[0],100,date.today,'approved',true,true);await act(ids[4],999);
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20261114200000_office_rpv_counter.sql',import.meta.url),'utf8'));
 const report=async({month=date.month_start,network=null,region=null,site=null,group='network',offset=0,exportAll=false}={})=>(await db.query('select rpv_office_volume_report($1,$2,$3,$4,$5,$6,$7) result',[month,network,region,site,group,offset,exportAll])).rows[0].result;
 const full=await report();assert.equal(full.total,60.325);assert.equal(full.act_count,4);assert.equal(full.site_count,3);
 assert.deepEqual(full.networks,['UPG','WOG']);assert.equal(full.sites.length,4);
 const wog=await report({network:'WOG'});assert.equal(wog.total,30.325);assert.equal(wog.sites.length,3);
 assert.equal((await report({region:'UA12'})).total,40.125);
 assert.equal((await report({network:'WOG',region:'UA12'})).total,10.125);
 assert.equal((await report({site:ids[1]})).total,20.2);
 assert.equal((await report({site:ids[1],region:'UA12'})).total,0);
 assert.equal((await report({network:'MISSING'})).total,0);
 assert.equal((await report({month:date.archive,site:ids[0]})).total,7.75);
 const grouped=await report({group:'region'});assert.equal(grouped.rows.find(r=>r.key==='UA12').volume,40.125);
 assert.equal(Number((await db.query('select rpv_customer_total(123,$1) total',[date.month_start])).rows[0].total),wog.total);
 assert.equal(Number((await db.query('select rpv_customer_total(124,$1) total',[date.month_start])).rows[0].total),10.125);
 await assert.rejects(report({group:'invalid'}),e=>e.code==='22023');
 await assert.rejects(report({month:'2999-01-01'}),e=>e.code==='22023');
 await assert.rejects(report({offset:-1}),e=>e.code==='22023');
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(report(),e=>e.code==='42501');
  await assert.rejects(db.query('select * from rpv_confirmed_volumes'),e=>e.code==='42501');
  await db.exec('reset role');
 }
 await db.exec('set role service_role');assert.equal((await report()).total,60.325);await db.exec('reset role');
 await db.exec("insert into rpv_customer_sites select gen_random_uuid(),'Large registry',g::text,'EXTRA','UA12020010010037010',null from generate_series(1,1005) g");
 const first=await report({group:'site'});assert.equal(first.row_count,1009);assert.equal(first.rows.length,50);assert.equal(first.more,true);
 const last=await report({group:'site',offset:1000});assert.equal(last.rows.length,9);assert.equal(last.more,false);
 const exported=await report({group:'site',offset:1000,exportAll:true});assert.equal(exported.rows.length,1009);assert.equal(exported.more,false);assert.equal(exported.total,60.325);
 assert.equal(exported.rows.reduce((sum,r)=>sum+r.acts,0),4);
 }finally{await db.close();}
});

test('office volume endpoint authenticates every read/export and validates all filters',async()=>{
 let role='viewer',calls=0,fail=false,handler,lastArgs;
 const db={auth:{getUser:async token=>token==='office'?{data:{user:{id:'user'}}}:{data:{user:null}}},from(){let valid=true;const q={select(){return q},eq(k,v){if(k==='is_active'&&role==='revoked')valid=false;return q},maybeSingle:async()=>({data:valid?{user_id:'user',role}:null,error:null})};return q;},rpc:async(name,args)=>{calls++;lastArgs=args;assert.equal(name,'rpv_office_volume_report');return {error:fail?{message:'private database error'}:null,data:{networks:['WOG'],regions:['UA12','UA80'],sites:[],rows:[{key:'UA12',region:'UA12',volume:10,acts:1,sites:1}]}};}};
 const source=await fs.readFile(new URL('../supabase/functions/rpv-portal/index.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','Deno',compiled)(name=>name.includes('supabase-js')?{createClient:()=>db}:name.includes('volume_report')?volume:name.includes('auth')?auth:name.includes('ukraine_cities')?{ukraineCities:[]}:{},{},{env:{get:()=>''},serve:fn=>handler=fn});
 const req=(token='office',filters={})=>handler(new Request('https://test.example',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token?'Bearer '+token:''},body:JSON.stringify({action:'office.volume',...filters})}));
 assert.equal((await req('')).status,401);assert.equal((await req('outsider',{export:true})).status,401);
 role='revoked';assert.equal((await req()).status,403);role='unknown';assert.equal((await req()).status,403);assert.equal(calls,0);
 for(const r of ['owner','admin','dispatcher','accountant','viewer']){role=r;assert.equal((await req()).status,200);}
 const result=await(await req('office',{network:'wog',region:'UA12',site:ids[0],group:'region',page:2,export:true})).json();
 assert.equal(lastArgs.p_network,'WOG');assert.equal(lastArgs.p_region,'UA12');assert.equal(lastArgs.p_site,ids[0]);assert.equal(lastArgs.p_offset,100);assert.equal(lastArgs.p_export,true);
 assert.equal(result.rows[0].title,'Дніпропетровська область');assert.equal(result.regions.find(r=>r.value==='UA80').label,'Київ');
 const before=calls;
 for(const filters of [{month:'2999-01'},{network:123},{region:123},{region:'bogus'},{site:'bad'},{group:'bad'},{page:-1},{page:1.5},{export:'true'}])assert.equal((await req('office',filters)).status,400);
 assert.equal(calls,before);fail=true;const failure=await req();assert.equal(failure.status,500);assert.doesNotMatch(await failure.text(),/private database/);
});

test('CSV includes selected filters, exact period and full grouped results; cells cannot become formulas',()=>{
 const report={month:'2026-11',period_start:'2026-11-01',period_end:'2026-11-14',total:10.125,act_count:1,networks:[{value:'WOG',label:'WOG'}],regions:[{value:'UA12',label:'Дніпропетровська область'}],sites:[],rows:[{title:'=HYPERLINK("bad")',region_label:null,volume:10.125,acts:1,sites:1}]};
 const text=volumeCsv(report,{month:'2026-11',network:'WOG',region:'UA12',site:'',group:'network'});
 assert.ok(text.startsWith('\ufeff'));assert.match(text,/2026-11-14/);assert.match(text,/Дніпропетровська область/);assert.match(text,/10.125/);assert.match(text,/"'=HYPERLINK\(""bad""\)"/);
});
