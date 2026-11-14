import {applyBusinessConflicts} from './fixtures/business-conflicts.mjs';
import { serviceDatabase } from './fixtures/service-db.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=await serviceDatabase();
await applyBusinessConflicts(db);
const owner='10000000-0000-0000-0000-000000000001',dispatcher='10000000-0000-0000-0000-000000000002',accountant='10000000-0000-0000-0000-000000000003',viewer='10000000-0000-0000-0000-000000000004';
const c='20000000-0000-0000-0000-000000000001',c2='20000000-0000-0000-0000-000000000002',app='30000000-0000-0000-0000-000000000001',site='40000000-0000-0000-0000-000000000001',act='60000000-0000-0000-0000-000000000001';
await db.exec(`insert into admin_users values('${owner}','owner',true),('${dispatcher}','dispatcher',true),('${accountant}','accountant',true),('${viewer}','viewer',true);insert into contractors values('${c}',123,'active','+380111111111'),('${c2}',124,'active','+380222222222');insert into rpv_customer_sites values('${site}','wog-13','Address');insert into applications(id,application_number,title,address,customer_site_id) values('${app}','G-13','АЗК WOG 13','Address','${site}');`);
const today=(await db.query(`select (now() at time zone 'Europe/Kyiv')::date::text d`)).rows[0].d;
async function service(sql,params=[]){await db.exec('set role service_role');try{return (await db.query(sql,params)).rows;}finally{await db.exec('reset role');}}
async function version(){return (await db.query('select updated_at::text v from applications where id=$1',[app])).rows[0].v;}
async function action(name,user=123,note='',v){return service('select rpv_service_transition($1,$2,$3,$4,$5) r',[user,app,name,v||await version(),note]);}
async function report(volume=10,date=today){return service('select rpv_service_report($1,$2,$3,$4,$5,$6) r',[123,app,await version(),date,volume,'2 рейси']);}
async function attach(key=act,file='telegram-file-1',user=123){return (await service('select rpv_service_attach($1,$2,$3,$4,$5,$6) r',[user,app,key,file,'document','act.pdf']))[0].r;}
async function review(decision='approved',reason=''){return (await service('select rpv_service_review($1,$2,$3,$4) r',[owner,act,decision,reason]))[0].r;}
await assert.rejects(service('select rpv_service_assign($1,$2,$3,$4)',[viewer,app,c,await version()]),e=>e.code==='42501');
await service('select rpv_service_assign($1,$2,$3,$4)',[owner,app,c,await version()]);
await assert.rejects(action('depart'),e=>e.code==='22023');
await assert.rejects(action('accept',124),e=>e.code==='PT409');
const stale=await version();await action('accept');await assert.rejects(action('accept',123,'',stale),e=>e.code==='PT409');
await assert.rejects(report(),e=>e.code==='PT409');
await action('depart');await action('arrive');await action('problem',123,'Немає доступу');
assert.equal((await db.query('select contractor_stage,has_problem from applications')).rows[0].contractor_stage,'departed');
await assert.rejects(report(-1),e=>e.code==='22023');await assert.rejects(report(1.1234),e=>e.code==='22023');
await report();const submitted=await attach();assert.equal(submitted.created,true);
await db.exec(`update acts set file_name='metadata.pdf' where id='${act}'`);assert.equal((await db.query('select awaiting_act from applications')).rows[0].awaiting_act,true);
const retried=await attach();assert.equal(retried.act_id,act);assert.equal((await db.query('select count(*)::int n from act_files')).rows[0].n,1);
await assert.rejects(attach(act,'foreign-file',124),e=>e.code==='PT409');
await assert.rejects(action('problem',123,'Інша проблема'),e=>e.code==='PT409');
await assert.rejects(service('select rpv_service_assign($1,$2,$3,$4)',[owner,app,c2,await version()]),e=>e.code==='PT409');
assert.equal((await db.query('select actual_volume from applications')).rows[0].actual_volume,null);
await assert.rejects(db.exec(`update acts set service_report='{}'`),e=>e.code==='42501');
await db.exec(`update rpv_customer_sites set address='Changed'`);
await assert.rejects(review(),e=>e.code==='22023');
assert.equal((await db.query('select status from acts')).rows[0].status,'pending');assert.equal((await db.query('select count(*)::int n from work_history')).rows[0].n,0);
await db.exec(`update rpv_customer_sites set address='Address'`);
assert.equal((await review()).changed,true);assert.equal((await review()).changed,false);
assert.equal((await db.query('select count(*)::int n from work_history')).rows[0].n,1);
assert.equal((await db.query('select sum(pumped_m3) v from rpv_customer_act_data')).rows[0].v,'10');
assert.equal((await db.query('select payout_status from applications')).rows[0].payout_status,'pending');
await assert.rejects(review('rejected','Уточніть обсяг'),e=>e.code==='PT409');
async function asOffice(uid,sql){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false)`);try{return await db.query(sql);}finally{await db.exec('reset role');}}
await assert.rejects(asOffice(viewer,`update applications set title='Changed'`),e=>e.code==='42501');
await assert.rejects(asOffice(dispatcher,`update applications set payout_amount=999`),e=>e.code==='42501');
await assert.rejects(asOffice(accountant,`update applications set title='Changed'`),e=>e.code==='42501');
await asOffice(accountant,`update applications set payout_amount=999`);
await assert.rejects(asOffice(owner,`update applications set actual_volume=77`),e=>e.code==='42501');
await assert.rejects(asOffice(owner,`update acts set status='pending'`),e=>e.code==='42501');
for(const role of ['anon','authenticated'])for(const fn of ['rpv_service_transition(bigint,uuid,text,timestamptz,text)','rpv_service_report(bigint,uuid,timestamptz,date,numeric,text)','rpv_service_attach(bigint,uuid,uuid,text,text,text)','rpv_service_review(text,uuid,text,text)','rpv_service_assign(uuid,uuid,uuid,timestamptz)'])assert.equal((await db.query(`select has_function_privilege('${role}','${fn}','execute') ok`)).rows[0].ok,false);
// A rejected result can be corrected and submitted with a new act; accepted history is immutable.
await db.exec(`update applications set status='in_progress',contractor_stage='departed';update acts set status='pending';delete from work_history;delete from rpv_customer_act_data;`);
await assert.rejects(review('rejected',''),e=>e.code==='22023');await review('rejected','Потрібно чітке фото');
assert.equal((await db.query('select awaiting_act from applications')).rows[0].awaiting_act,false);
await report(12);const corrected='60000000-0000-0000-0000-000000000002';await attach(corrected,'new-photo');
assert.equal((await db.query("select count(*)::int n from acts where status='pending'")).rows[0].n,1);
await db.exec("update contractors set status='rejected' where telegram_id=123");await assert.rejects(report(12),e=>e.code==='42501');

// Web uploads must enter the same act registry before the office can complete work.
const appFileMigration=await fs.readFile(new URL('../supabase/migrations/20260907122556_create_application_files_comments_automation_roles.sql',import.meta.url),'utf8');
const appFileTable=appFileMigration.match(/CREATE TABLE IF NOT EXISTS public\.application_files[\s\S]*?\n\);/)[0];
await db.exec(`create schema storage;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
${appFileTable}
grant select,insert,update,delete on application_files,act_files to authenticated;
grant select,insert,update,delete on application_files,act_files,storage.objects to service_role;
grant usage on schema storage to authenticated,service_role;
grant select,update,delete on storage.objects to authenticated;
alter table storage.objects enable row level security;
create policy office_storage on storage.objects for all to authenticated using(true) with check(true);`);
const webApp='30000000-0000-0000-0000-000000000002',webFile='70000000-0000-0000-0000-000000000001';
const path=`${webApp}/act/original.png`;
await db.exec(`insert into applications(id,contractor_id,application_number,title,status) values('${webApp}','${c2}','G-WEB','Web primary act','in_progress');
insert into storage.objects(bucket_id,name) values('application-media','${path}');
insert into application_files(id,application_id,storage_path,category,file_name,file_type,uploaded_by) values('${webFile}','${webApp}','${path}','act','original.png','image/png','${owner}');`);
await db.exec(await fs.readFile(new URL('../supabase/migrations/20261114182856_primary_act_registry.sql',import.meta.url),'utf8'));
await applyBusinessConflicts(db);
const registered=(await db.query('select * from acts where application_id=$1',[webApp])).rows[0];
assert.equal(registered.status,'pending');assert.equal(registered.service_report,null);
assert.equal((await db.query('select status from applications where id=$1',[webApp])).rows[0].status,'in_progress');
assert.equal((await db.query('select storage_path from act_files where application_file_id=$1',[webFile])).rows[0].storage_path,path);
await service('select rpv_register_primary_file($1)',[webFile]);
assert.equal((await db.query('select count(*)::int n from act_files where application_file_id=$1',[webFile])).rows[0].n,1);
const secondPath=`${webApp}/act/page2.pdf`;
await db.query("insert into storage.objects(bucket_id,name) values('application-media',$1)",[secondPath]);
const insertSecond=`insert into application_files(application_id,storage_path,category,file_name,file_type,uploaded_by) values('${webApp}','${secondPath}','act','page2.pdf','application/pdf','${owner}')`;
await assert.rejects(asOffice(viewer,insertSecond),e=>e.code==='42501');
await assert.rejects(asOffice(accountant,insertSecond),e=>e.code==='42501');
await asOffice(dispatcher,insertSecond);
assert.equal((await db.query('select count(*)::int n from acts where application_id=$1',[webApp])).rows[0].n,1);
assert.equal((await db.query('select count(*)::int n from act_files where act_id=$1',[registered.id])).rows[0].n,2);
await assert.rejects(asOffice(owner,insertSecond.replace(secondPath,'foreign/act.pdf')),e=>e.code==='22023');
// Protected private originals cannot be deleted/overwritten by a browser client.
await asOffice(owner,`delete from storage.objects where name='${path}'`);
await asOffice(owner,`update storage.objects set name='lost' where name='${path}'`);
assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[path])).rows[0].n,1);
const reviewed=(await service('select rpv_service_review($1,$2,$3) r',[owner,registered.id,'approved']))[0].r;
assert.equal(reviewed.changed,true);
const completed=(await db.query('select * from applications where id=$1',[webApp])).rows[0];
assert.equal(completed.status,'completed');assert.equal(completed.awaiting_act,false);
assert.equal(completed.actual_volume,null);assert.equal(completed.payout_status,'pending');
assert.equal((await db.query('select count(*)::int n from work_history where application_id=$1',[webApp])).rows[0].n,1);
assert.equal((await service('select rpv_service_review($1,$2,$3) r',[owner,registered.id,'approved']))[0].r.changed,false);
await assert.rejects(asOffice(owner,insertSecond),e=>e.code==='PT409');
assert.equal((await db.query('select count(*)::int n from act_files where act_id=$1',[registered.id])).rows[0].n,2);

// Reproduce the production failure: an office act has no assigned contractor.
const officeApp='30000000-0000-0000-0000-000000000003',officeFile='70000000-0000-0000-0000-000000000003';
const officePath=`${officeApp}/act/office-original.png`;
await db.exec(`insert into applications(id,application_number,title,status) values('${officeApp}','G-OFFICE','Office act without contractor','in_progress');
insert into storage.objects(bucket_id,name) values('application-media','${officePath}');`);
await asOffice(owner,`insert into application_files(id,application_id,storage_path,category,file_name,file_type,uploaded_by) values('${officeFile}','${officeApp}','${officePath}','act','office-original.png','image/png','${owner}')`);
const officeAct=(await db.query('select id from acts where application_id=$1',[officeApp])).rows[0].id;
await assert.rejects(service('select rpv_service_review($1,$2,$3)',[owner,officeAct,'approved']),e=>e.code==='23502'&&e.column==='contractor_id');
assert.equal((await db.query('select status from acts where id=$1',[officeAct])).rows[0].status,'pending');
assert.equal((await db.query('select count(*)::int n from work_history where application_id=$1',[officeApp])).rows[0].n,0);
await db.exec(await fs.readFile(new URL('../supabase/migrations/20261114190519_office_act_history.sql',import.meta.url),'utf8'));
// The migration alone does not accept work. The usual office decision still owns completion.
assert.equal((await db.query('select status from acts where id=$1',[officeAct])).rows[0].status,'pending');
await service('select rpv_service_review($1,$2,$3)',[owner,officeAct,'approved']);
const officeResult=(await db.query('select status,contractor_id,awaiting_act,payout_amount,payout_status from applications where id=$1',[officeApp])).rows[0];
assert.equal(officeResult.status,'completed');assert.equal(officeResult.contractor_id,null);assert.equal(officeResult.awaiting_act,false);
assert.equal(officeResult.payout_amount,'0');assert.equal(officeResult.payout_status,'pending');
assert.equal((await db.query('select contractor_id from work_history where application_id=$1',[officeApp])).rows[0].contractor_id,null);
assert.equal((await db.query('select count(*)::int n from act_files where act_id=$1 and storage_path=$2',[officeAct,officePath])).rows[0].n,1);
assert.equal((await service('select rpv_service_review($1,$2,$3) r',[owner,officeAct,'approved']))[0].r.changed,false);
assert.equal((await db.query('select count(*)::int n from work_history where application_id=$1',[officeApp])).rows[0].n,1);
console.log('PASS: reproduced missing-contractor failure; office approval now closes work with real identity, retained act/history, unchanged payouts, and idempotent retry.');
console.log('PASS: uploaded act backfill, atomic registration, roles, path ownership, multiple pages, completion/history, idempotency, private original retention.');
console.log('PASS: complete workflow, ownership, stale writes, state order, reports/files, atomic rollback, publication/history idempotency, rejection/correction, revocation and office role boundaries.');await db.close();
