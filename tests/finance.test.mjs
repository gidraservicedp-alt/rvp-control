import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import * as auth from '../supabase/functions/rpv-portal/auth.ts';
import * as finance from '../supabase/functions/rpv-portal/finance.ts';
import {financeCsv} from '../src/workspace/finance.ts';
const id=n=>`70000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('closed unpaid work creates durable debt, missing amounts stay visible, payments and reports reconcile across months',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create schema rvp_private;
 create table admin_users(user_id uuid primary key,full_name text,role text,is_active boolean);
 create table contractors(id uuid primary key,first_name text,last_name text,phone text);
 create table rpv_customer_sites(id uuid primary key,passport_network text,passport_city_code text);
 create table applications(id uuid primary key,application_number text,title text,address text,status text,contractor_id uuid references contractors(id) on delete cascade,customer_site_id uuid,
 actual_volume numeric,unit_price numeric default 0,payout_amount numeric default 0,payout_status text default 'pending',paid_at timestamptz,paid_by bigint,
 payout_receipt_file_id text,payout_receipt_type text,payout_receipt_name text,created_at timestamptz default now(),updated_at timestamptz default now());
 create table acts(id uuid primary key,application_id uuid,status text,reviewed_at timestamptz,created_at timestamptz default now());
 create table work_history(id uuid primary key,application_id uuid,completed_at timestamptz);
 create table application_events(id uuid default gen_random_uuid(),application_id uuid,event_type text,title text,description text,actor_user_id uuid,actor_name text,metadata jsonb);
 grant usage on schema public,auth,rvp_private to service_role;grant all on all tables in schema public to service_role;`);
 await db.query("insert into admin_users values($1,'Office','owner',true),($2,'Bookkeeper','accountant',true),($3,'Read only','viewer',true),($4,'Revoked','admin',false)",[id(90),id(91),id(92),id(93)]);
 await db.query("insert into contractors values($1,'Test','One',null),($2,'Test','Two',null)",[id(80),id(81)]);
 const dates=(await db.query("select to_char(now() at time zone 'Europe/Kyiv','YYYY-MM-01') as month,to_char((now() at time zone 'Europe/Kyiv')-interval '1 month','YYYY-MM-01') prev")).rows[0];
 async function app(n,{status='completed',amount=0,contractor=id(80),payout='pending',volume=null,rate=0,completed=dates.month,paid=null}={}){
  await db.query('insert into applications(id,application_number,title,status,contractor_id,payout_amount,payout_status,actual_volume,unit_price,created_at,updated_at,paid_at) values($1,$2,\'Test work\',$3,$4,$5,$6,$7,$8,\'2020-02-01\',$9,$10)',[id(n),`TEST-${n}`,status,contractor,amount,payout,volume,rate,completed,paid]);
  if(status==='completed')await db.query('insert into work_history values($1,$1,$2)',[id(n),completed]);
 }
 await app(1,{amount:1200});await app(2,{amount:1500,completed:dates.prev});await app(3);await app(4,{contractor:null});
 await app(5,{amount:800,payout:'paid',paid:dates.month,completed:dates.prev});await app(6,{amount:900,status:'cancelled'});await app(7,{amount:700,status:'in_progress'});await app(8,{volume:12.5,rate:200,contractor:id(81)});
 const initial=(await db.query('select id,payout_amount,payout_status,paid_at from applications order by id')).rows;
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20261114201146_contractor_debt_history.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select id,payout_amount,payout_status,paid_at from applications order by id')).rows,initial,'migration must not invent money or payment');
 const report=async({month=dates.month,contractor=null,application=null,state='all',offset=0,exportAll=false}={})=>(await db.query('select rpv_finance_report($1,$2,$3,$4,$5,$6) r',[month,contractor,application,state,offset,exportAll])).rows[0].r;
 let r=await report();assert.equal(r.stats.debt_total,5200);assert.equal(r.stats.pending_count,5);assert.equal(r.stats.missing_amount_count,2);assert.equal(r.stats.missing_contractor_count,1);
 assert.equal(r.stats.accrued_month,3700);assert.equal(r.stats.paid_month,800);assert.equal(r.stats.accrued_total,6000);assert.equal(r.row_count,6);assert.equal(r.monthly.find(m=>m.month===dates.prev.slice(0,7)).debt,1500);
 assert.equal((await report({contractor:id(80)})).stats.debt_total,2700);assert.equal((await report({state:'missing'})).row_count,2);assert.equal((await report({state:'paid'})).row_count,1);
 assert.equal((await report({month:dates.prev})).stats.debt_total,5200,'debt is carried across month filter');
 assert.equal((await report({month:'2020-01-01',application:id(5)})).rows.length,1,'focused payment remains accessible outside its month');
 assert.equal((await db.query('select count(*)::int n from rpv_payout_events')).rows[0].n,7);
 const change=async(n,{actor=id(90),version=0,action='set_amount',amount=1000,contractor=null}={})=>(await db.query('select rpv_finance_change($1,$2,$3,$4,$5,$6) r',[actor,id(n),version,action,amount,contractor])).rows[0].r;
 for(const actor of [id(92),id(93),id(94)])await assert.rejects(change(3,{actor}),e=>e.code==='42501');
 await assert.rejects(change(3,{action:'confirm'}),e=>e.code==='23514');
 await assert.rejects(change(4),e=>e.code==='22023');
 for(const amount of [-1,0,1.001,'NaN','Infinity'])await assert.rejects(change(3,{amount}),e=>e.code==='22023');
 await assert.rejects(change(3,{contractor:id(81)}),e=>e.code==='23514');
 await db.exec('set role service_role');await change(3,{actor:id(91),amount:600});await db.exec('reset role');
 await assert.rejects(change(3,{action:'confirm',version:0}),e=>e.code==='40001');
 await change(4,{amount:900,contractor:id(81)});
 r=await report();assert.equal(r.stats.debt_total,6700);assert.equal(r.stats.missing_amount_count,0);assert.equal(r.stats.missing_contractor_count,0);
 assert.equal((await report({contractor:id(81)})).stats.debt_total,3400);
 await change(3,{action:'confirm',version:1});assert.equal((await change(3,{action:'confirm',version:1})).already_paid,true);
 r=await report();assert.equal(r.stats.debt_total,6100);assert.equal(r.stats.paid_month,1400);assert.equal(r.stats.accrued_total,7500);
 assert.equal((await db.query("select count(*)::int n from rpv_payout_events where application_id=$1 and kind='paid'",[id(3)])).rows[0].n,1,'repeat confirmation is idempotent');
 assert.equal((await db.query("select count(*)::int n from application_events where application_id=$1 and event_type='finance_paid'",[id(3)])).rows[0].n,1);
 await assert.rejects(db.query('update applications set payout_amount=123 where id=$1',[id(3)]),e=>e.code==='23514');
 await assert.rejects(db.query("update applications set payout_status='pending' where id=$1",[id(3)]),e=>e.code==='23514');
 await assert.rejects(db.query('delete from applications where id=$1',[id(3)]),e=>['23503','23001'].includes(e.code));
 await assert.rejects(db.query('delete from contractors where id=$1',[id(80)]),e=>['23503','23001'].includes(e.code));
 await db.query("update applications set payout_status='paid' where id=$1",[id(8)]);
 assert.equal(Number((await db.query('select payout_amount from applications where id=$1',[id(8)])).rows[0].payout_amount),2500,'bot/direct write uses same amount calculation');
 await db.query("update applications set status='completed' where id=$1",[id(7)]);assert.ok((await report()).rows.find(a=>a.id===id(7)).payout_accrued_at);
 assert.equal((await db.query("select kind from rpv_payout_events where application_id=$1",[id(7)])).rows[0].kind,'accrued');
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(report(),e=>e.code==='42501');await assert.rejects(change(1),e=>e.code==='42501');await assert.rejects(db.query('select * from rpv_payout_events'),e=>e.code==='42501');await db.exec('reset role');}
 await db.exec("set role service_role");await assert.rejects(db.exec('delete from rpv_payout_events'),e=>e.code==='42501');await db.exec('reset role');
 await assert.rejects(report({month:'2999-01-01'}),e=>e.code==='22023');await assert.rejects(report({state:'bad'}),e=>e.code==='22023');
 await db.exec(`insert into applications(id,application_number,title,status,contractor_id,payout_amount) select gen_random_uuid(),'BULK-'||g,'Scale test','completed','${id(80)}',10 from generate_series(1,1005) g`);
 const full=await report({exportAll:true}),paged=await report();assert.equal(full.rows.length,1012);assert.equal(paged.rows.length,50);assert.equal(paged.more,true);assert.equal((await report({offset:1000})).rows.length,12);assert.equal(full.stats.debt_total,14350);
 }finally{await db.close();}
});

test('finance endpoints validate auth/roles, expose version conflicts, and scope history queries',async()=>{
 let role='owner',handler,lastArgs,calls=0,fail=null;const filters=[];
 const db={auth:{getUser:async token=>({data:{user:token==='office'?{id:id(90)}:null}})},from(table){const q={select(){return q},eq(k,v){filters.push([table,k,v]);return q},order(){return q},range:async()=>({data:table==='rpv_payout_events'?[{id:id(1)}]:[],error:null}),maybeSingle:async()=>({data:role==='revoked'?null:{user_id:id(90),role}})};return q;},rpc:async(name,args)=>{calls++;lastArgs={name,...args};return {data:{ok:true,rows:[],contractors:[]},error:fail};}};
 const source=await fs.readFile(new URL('../supabase/functions/rpv-portal/index.ts',import.meta.url),'utf8');
 new Function('require','exports','Deno',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name.includes('supabase-js')?{createClient:()=>db}:name.includes('finance.ts')?finance:name.includes('auth')?auth:name.includes('ukraine_cities')?{ukraineCities:[]}:{},{},{env:{get:()=>''},serve:fn=>handler=fn});
 const req=(action='office.finance',body={},token='office')=>handler(new Request('https://test.example',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token?'Bearer '+token:''},body:JSON.stringify({action,...body})}));
 assert.equal((await req('office.finance',{},'')).status,401);assert.equal((await req('office.finance_history',{application:id(1)},'wrong')).status,401);
 role='revoked';assert.equal((await req()).status,403);role='outsider';assert.equal((await req()).status,403);
 for(const r of ['owner','admin','accountant','dispatcher','viewer']){role=r;assert.equal((await req()).status,200);const res=await req('office.finance_set',{application:id(1),version:0,amount:100});assert.equal(res.status,['owner','admin','accountant'].includes(r)?200:403);}
 role='owner';for(const body of [{amount:0},{amount:'100'},{amount:1.001},{amount:-1},{version:-1},{application:'bad'}])assert.equal((await req('office.finance_set',{application:id(1),version:0,amount:100,...body})).status,400);
 const before=calls;for(const body of [{month:'2999-01'},{state:'bad'},{export:'yes'},{page:-1},{contractor:'bad'}])assert.equal((await req('office.finance',body)).status,400);assert.equal(calls,before);
 assert.equal((await req('office.finance_confirm',{application:id(1),version:2})).status,200);assert.equal(lastArgs.p_actor,id(90));assert.equal(lastArgs.p_version,2);
 fail={code:'40001',message:'Оновіть виплату'};assert.equal((await req('office.finance_confirm',{application:id(1),version:2})).status,409);
 fail={code:'XX000',message:'private db detail'};const failure=await req();assert.equal(failure.status,500);assert.doesNotMatch(await failure.text(),/private db detail/);
 fail=null;assert.equal((await req('office.finance_history')).status,400);assert.equal((await req('office.finance_history',{contractor:id(80)})).status,200);assert.ok(filters.some(([t,k,v])=>t==='rpv_payout_events'&&k==='contractor_id'&&v===id(80)));
});

test('CSV distinguishes unknown amounts from zero debt and protects spreadsheet cells',()=>{
 const text=financeCsv({month:'2026-11',as_of:'2026-11-14',filter_state:'pending',contractor_options:[],contractors:[],stats:{debt_total:500,missing_amount_count:1,accrued_month:500,paid_month:0},rows:[{application_number:'=FORMULA()',contractor_name:'Example',amount:null,needs_amount:true,pending:true,debt:0}]});
 assert.ok(text.startsWith('\ufeff'));assert.match(text,/Не вказано/);assert.match(text,/Не оплачені/);assert.match(text,/"'=FORMULA\(\)"/);assert.match(text,/"500"/);
});
