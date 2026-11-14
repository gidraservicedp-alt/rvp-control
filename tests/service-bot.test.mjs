import test from 'node:test';import assert from 'node:assert/strict';
import { makeServiceWorkflow,authorizeServiceOffice } from '../supabase/functions/smart-api/service_workflow.ts';
const id='30000000-0000-0000-0000-000000000001';
function setup({foreign=false,role='owner',state='',rpcError=null}={}) {
 const calls=[],sent=[],sessions=[];let session=state;
 const app={id,contractor_id:'c',application_number:'G-13',title:'WOG <13>',address:'Address',description:'Pump',status:'assigned',contractor_stage:'accepted',arrived_at:'2026-11-11T08:00:00Z',updated_at:'2026-11-11T08:00:00Z'};
 const db={auth:{getUser:async token=>({data:token==='valid'?{user:{id:'office'}}:{},error:null})},from(table){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:table==='contractors'?{id:'c',status:'active',phone:'+380111111111'}:table==='applications'?foreign?null:app:table==='admin_users'?{user_id:'office',role}:null,error:null};}};},rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,act_id:'a',created:true},error:rpcError};}};
 const flow=makeServiceWorkflow({db,send:async(method,body)=>{sent.push(body);return{ok:true};},getSession:async()=>({state:session}),setSession:async(user,value)=>{sessions.push(value);session=value;},resetSession:async()=>{session='reset-contractor';},clearSession:async()=>{session='';},isAdmin:user=>user===999,mainMenu:()=>({}),finalizeAct:async(...args)=>calls.push({finalized:args}),rejectAct:async(...args)=>{calls.push({rejected:args});return true;}});
 const message=text=>flow.message({from:{id:123},chat:{id:123,type:'private'},text});
 return {flow,calls,sent,sessions,db,message,session:()=>session};
}
test('bot action uses the same actor, app version and SQL transaction as web',async()=>{const t=setup();assert.equal(await t.flow.callback({from:{id:123},message:{chat:{id:123,type:'private'}},data:`startwork:${id}`}),true);assert.equal(t.calls[0].name,'rpv_service_transition');assert.equal(t.calls[0].args.p_action,'arrive');assert.equal(t.calls[0].args.p_user,123);assert.equal(t.calls[0].args.p_version,'2026-11-11T08:00:00Z');});
test('group action sends private job details to the assigned user',async()=>{const t=setup();await t.flow.callback({from:{id:123},message:{chat:{id:-1001,type:'supergroup'}},data:`contractorapp:${id}`});assert.equal(t.sent[0].chat_id,123);assert.ok(t.sent[0].text.includes('&lt;13&gt;'));});
test('foreign/stale actions never report successful work',async()=>{const t=setup({foreign:true});await t.flow.callback({from:{id:123},message:{chat:{id:123,type:'private'}},data:`contractoraccept:${id}`});assert.equal(t.calls.length,0);const stale=setup({rpcError:{code:'40001'}});await stale.flow.callback({from:{id:123},message:{chat:{id:123,type:'private'}},data:`startwork:${id}`});assert.ok(stale.sent[0].text.includes('змінилася'));});
test('report wizard records volume/date before accepting an act',async()=>{const t=setup({state:`wf_volume:${id}`});await t.message('12,5');assert.equal(t.session(),`wf_date:${id}:12.5`);await t.message('2026-11-10');await t.message('2 рейси');assert.equal(t.calls[0].name,'rpv_service_report');assert.equal(t.calls[0].args.p_volume,12.5);assert.equal(t.calls[0].args.p_date,'2026-11-10');assert.equal(t.session(),`wf_upload:${id}`);});
test('office rejection collects a reason and returns to office mode',async()=>{const t=setup();await t.flow.callback({from:{id:999},message:{chat:{id:-1001,type:'supergroup'}},data:`rejectact:${id}`});assert.equal(t.sent[0].chat_id,999);await t.flow.message({from:{id:999},chat:{id:999,type:'private'},text:'Нечітке фото'});assert.equal(t.calls[0].rejected[2],'Нечітке фото');assert.equal(t.session(),'');});
test('office web actions fail closed for invalid sessions and finance/viewer roles',async()=>{for(const role of ['viewer','accountant','unknown']){const t=setup({role});assert.equal(await authorizeServiceOffice(t.db,'Bearer valid'),null);}const t=setup();assert.equal(await authorizeServiceOffice(t.db,''),null);assert.equal(await authorizeServiceOffice(t.db,'Bearer invalid'),null);assert.equal(await authorizeServiceOffice(t.db,'Bearer valid'),'office');});

test('bot cannot skip cubic metres or resume an obsolete no-volume session',async()=>{
 for(const input of ['Без відкачки','0','-1','1.2345','1000000']) {
  const t=setup({state:`wf_volume:${id}`});await t.message(input);
  assert.equal(t.calls.length,0);assert.equal(t.session(),`wf_volume:${id}`);
 }
 const t=setup({state:`wf_note:${id}:none:2026-11-10`});await t.message('Без примітки');
 assert.equal(t.calls.length,0);assert.equal(t.session(),`wf_volume:${id}`);
});
