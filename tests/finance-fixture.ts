// Synthetic balances for local browser QA; never imported by the production entry.
const cid='70000000-0000-0000-0000-000000000080';
const now=new Date().toISOString(),month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit'}).format(new Date());
let entries=[
{id:'70000000-0000-0000-0000-000000000001',application_number:'DEMO-1001',title:'Планова відкачка · АЗК WOG 0013',contractor_id:cid,contractor_name:'Тестовий Виконавець',amount:4200,payout_accrued_at:now,payout_status:'pending',paid_at:null,payout_version:0},
{id:'70000000-0000-0000-0000-000000000002',application_number:'DEMO-1002',title:'Прийнята робота минулого місяця',contractor_id:cid,contractor_name:'Тестовий Виконавець',amount:1800,payout_accrued_at:new Date(new Date().getFullYear(),new Date().getMonth()-1,20).toISOString(),payout_status:'pending',paid_at:null,payout_version:0},
{id:'70000000-0000-0000-0000-000000000003',application_number:'DEMO-1003',title:'Первинний акт прийнято · уточнити вартість',contractor_id:cid,contractor_name:'Тестовий Виконавець',amount:null,payout_accrued_at:now,payout_status:'pending',paid_at:null,payout_version:0},
{id:'70000000-0000-0000-0000-000000000004',application_number:'DEMO-1004',title:'Оплачена робота',contractor_id:cid,contractor_name:'Тестовий Виконавець',amount:2500,payout_accrued_at:now,payout_status:'paid',paid_at:now,payout_version:0},
] as any[];
let events=entries.map((a,i)=>({...a,id:'event-'+i,application_id:a.id,kind:'opening',occurred_at:a.payout_accrued_at,source:'migration'}));
export function financeFixture(b:any){
 const can_manage=new URLSearchParams(location.search).get('readOnly')!=='1';
 if(b.action==='office.finance_history')return Response.json({events:events.filter(e=>(!b.application||e.application_id===b.application)&&(!b.contractor||e.contractor_id===b.contractor)).reverse(),more:false});
 if(b.action==='office.finance_set'||b.action==='office.finance_confirm'){
  if(!can_manage)return Response.json({error:'Недостатньо прав.'},{status:403});
  const a=entries.find(e=>e.id===b.application);if(a.payout_version!==b.version)return Response.json({error:'Дані змінилися. Оновіть виплату.'},{status:409});
  const previous_amount=a.amount;a.payout_version++;if(b.action.endsWith('_set'))a.amount=b.amount;else{a.payout_status='paid';a.paid_at=now;}
  events.push({...a,id:'event-'+events.length,application_id:a.id,kind:b.action.endsWith('_set')?'amount_changed':'paid',previous_amount,occurred_at:now,source:'office'});
  return Response.json({ok:true});
 }
 const all=entries.filter(a=>(!b.contractor||a.contractor_id===b.contractor)&&(!b.application||a.id===b.application)).map(a=>({...a,network:'WOG',debt:a.payout_status==='paid'?0:a.amount||0,pending:a.payout_status!=='paid',needs_amount:a.amount==null,needs_contractor:!a.contractor_id}));
 const rows=all.filter(a=>(b.application||a.pending||a.payout_accrued_at.startsWith(b.month||month)||a.paid_at?.startsWith(b.month||month))&&(!b.state||b.state==='all'||b.state==='pending'&&a.pending||b.state==='paid'&&!a.pending||b.state==='missing'&&a.needs_amount));
 const sum=(a:any[],k:string)=>a.reduce((t,x)=>t+(x[k]||0),0),pending=all.filter(a=>a.pending),paid=all.filter(a=>!a.pending),unknown=all.filter(a=>a.needs_amount);
 return Response.json({month:b.month||month,as_of:now,can_manage,filter_contractor:b.contractor,filter_state:b.state||'all',rows,row_count:rows.length,more:false,
 stats:{accrued_today:sum(all,'amount'),accrued_month:sum(all.filter(a=>a.payout_accrued_at.startsWith(b.month||month)),'amount'),paid_month:sum(paid.filter(a=>a.paid_at?.startsWith(b.month||month)),'amount'),accrued_total:sum(all,'amount'),paid_total:sum(paid,'amount'),debt_total:sum(pending,'amount'),pending_count:pending.length,missing_amount_count:unknown.length,missing_contractor_count:0},
 contractors:[{contractor_id:cid,contractor_name:'Тестовий Виконавець',debt:sum(pending,'amount'),paid:sum(paid,'amount'),pending_count:pending.length,missing_amount_count:unknown.length,paid_count:paid.length}],contractor_options:[{id:cid,name:'Тестовий Виконавець'}],monthly:[],daily:[]});
}
