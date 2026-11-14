// UI adapters only. Ownership, state order and all writes are enforced in SQL RPCs.
export function makeServiceWorkflow(d: any) {
  const { db, send, getSession, setSession, resetSession, isAdmin, mainMenu, finalizeAct } = d;
  const safe = (v: unknown) => String(v ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!));
  const day = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const keyboard = (text: string) => ({keyboard:[[{text}],...(text==='❌ Скасувати'?[]:[[{text:'❌ Скасувати'}]])],resize_keyboard:true});
  async function say(chat: number,text: string,markup?: any) { return send('sendMessage',{chat_id:chat,text,parse_mode:'HTML',...(markup?{reply_markup:markup}:{})}); }
  async function rpc(name: string,args: any) {
    const r = await db.rpc(name,args);
    if(r.error?.code==='P2001'||r.error?.code==='P2002') throw new Error(r.error.message);
    if(r.error) throw new Error(['42501','PT409','40001'].includes(r.error.code)?'Заявка змінилася або недоступна. Відкрийте її знову.':'Перевірте етап, дату та обсяг. Якщо проблему не вирішено — зверніться до офісу.');
    return r.data;
  }
  async function own(user: number,id: string) {
    const c = await db.from('contractors').select('id,status,phone').eq('telegram_id',user).maybeSingle();
    if(c.error || c.data?.status!=='active' || !c.data.phone) throw new Error('Потрібні підтверджений профіль підрядника та власний контакт у боті.');
    const a=await db.from('applications').select('*').eq('id',id).eq('contractor_id',c.data.id).maybeSingle();
    if(a.error || !a.data) throw new Error('Ця заявка недоступна.');
    return a.data;
  }
  async function card(chat: number,user: number,id: string) {
    const a=await own(user,id);const rows:any[]=[];
    const active=!['completed','cancelled'].includes(a.status);
    if(active && !a.awaiting_act) {
      if(a.contractor_stage==='offered') rows.push([{text:'✅ Прийняти',callback_data:`contractoraccept:${id}`},{text:'❌ Відмовитися',callback_data:`contractordecline:${id}`}]);
      else if(a.contractor_stage==='accepted') rows.push([{text:'🚗 Виїхав',callback_data:`contractordepart:${id}`}]);
      else if(a.contractor_stage==='departed' && !a.arrived_at) rows.push([{text:'📍 На об’єкті',callback_data:`startwork:${id}`}]);
      if(a.arrived_at) rows.push([{text:'📸 Передати результат',callback_data:`contractordone:${id}`}]);
      if(a.contractor_stage!=='offered') rows.push([{text:'⚠️ Повідомити про проблему',callback_data:`contractorproblem:${id}`}]);
    }
    rows.push([{text:'📋 Мої заявки',callback_data:'contractorappslist'}]);
    const report=await db.from('rpv_service_reports').select('state,review_reason').eq('application_id',id).maybeSingle();
    let stage=a.awaiting_act?'Результат на перевірці':a.status==='completed'?'Роботу підтверджено':a.status==='cancelled'?'Скасовано':a.arrived_at?'На об’єкті':a.contractor_stage==='departed'?'В дорозі':a.contractor_stage==='offered'?'Очікує вашого рішення':'Прийнято';
    await say(chat,`📋 <b>${safe(a.application_number)}</b>\n🏢 ${safe(a.title)}\n📍 ${safe(a.address)}\n💧 <b>${Number(a.actual_volume)>0?`${Number(a.actual_volume).toLocaleString('uk-UA',{maximumFractionDigits:3})} м³`:'Обсяг не вказано'}</b>\n🔧 ${safe(a.description)}\n\n${safe(stage)}${report.data?.review_reason?`\n❗ Повернуто: ${safe(report.data.review_reason)}`:''}${a.has_problem?`\n⚠️ ${safe(a.problem_comment)}`:''}\n💰 ${Number(a.payout_amount)>0?`${Number(a.payout_amount).toLocaleString('uk-UA')} грн`:'Суму уточнюйте в офісі'}`,{inline_keyboard:rows});
  }
  async function begin(chat:number,user:number,id:string) {
    const a=await own(user,id);
    if(!a.arrived_at || a.awaiting_act || ['completed','cancelled'].includes(a.status)) throw new Error('Спочатку відмітьте виїзд і прибуття. Переданий результат очікує перевірки офісом.');
    const report=await db.from('rpv_service_reports').select('state,volume').eq('application_id',id).maybeSingle();
    if(report.error) throw new Error('Не вдалося перевірити результат. Спробуйте ще раз.');
    if(report.data?.state==='draft' && Number(report.data.volume)>0) {
      await setSession(user,`wf_upload:${id}`);await say(chat,'📎 Результат збережено. Надішліть фото або PDF акта (до 10 МБ).',keyboard('✏️ Змінити дані'));return;
    }
    await setSession(user,`wf_volume:${id}`);
    await say(chat,'Вкажіть фактично відкачаний обсяг у м³ — число більше 0, до 3 знаків після коми. Без обсягу заявку завершити неможливо.',keyboard('❌ Скасувати'));
  }
  async function callback(c:any) {
    const text=String(c.data||'');const user=c.from?.id,chat=c.message?.chat?.type==='private'?c.message.chat.id:user;
    const rejection=/^rejectact:([a-f0-9-]{36})$/.exec(text);
    if(rejection && isAdmin(user)) {await setSession(user,`wf_reject:${rejection[1]}`);await say(user,'Напишіть причину повернення акта (від 3 символів).',keyboard('❌ Скасувати'));return true;}
    const m=/^(contractorapp|contractoraccept|contractordecline|contractordepart|startwork|contractordone|finish|contractorproblem):([a-f0-9-]{36})$/.exec(text);
    if(!m) return false;
    try {
      const [,kind,id]=m;await own(user,id);
      if(isAdmin(user)) await setSession(user,'admin_contractor_mode');
      if(kind==='contractorapp') await card(chat,user,id);
      else if((kind==='contractordone' || kind==='finish')) await begin(chat,user,id);
      else if(kind==='contractordecline' || kind==='contractorproblem') {
        await setSession(user,`wf_${kind==='contractordecline'?'decline':'problem'}:${id}`);
        await say(chat,'Коротко напишіть причину одним повідомленням (від 3 символів).',keyboard('❌ Скасувати'));
      } else {
        const a=await own(user,id);
        await rpc('rpv_service_transition',{p_user:user,p_application:id,p_version:a.updated_at,p_action:kind==='contractoraccept'?'accept':kind==='contractordepart'?'depart':'arrive'});
        try{await d.onTransition?.(id);}catch{console.warn("Work card refresh pending");}
        await card(chat,user,id);
      }
    } catch(e) { await say(chat,(e as Error).message); }
    return true;
  }
  async function message(m:any) {
    if(m.chat?.type!=='private') return false;
    const chat=m.chat.id,user=m.from.id,text=String(m.text||'').trim();
    const deep=/^\/start (job|act)_([a-f0-9-]{36})$/.exec(text);
    if(deep) {try {if(isAdmin(user)) await setSession(user,'admin_contractor_mode');if(deep[1]==='act')await begin(chat,user,deep[2]);else await card(chat,user,deep[2]);}catch(e){await say(chat,(e as Error).message);}return true;}
    const state=(await getSession(user))?.state||'';
    if(!/^wf_(volume|date|note|upload|decline|problem|reject):/.test(state)) return false;
    try {
      if(text==='❌ Скасувати') {await (state.startsWith('wf_reject:')?d.clearSession(user):resetSession(user));await say(chat,'Заповнення скасовано. Збережені документи залишаються в системі.',mainMenu(user));return true;}
      const [step,id,vol,date]=state.split(':');
      if(step==='wf_reject') {if(!isAdmin(user)||text.length<3||text.length>2000) throw new Error('Потрібні права адміністратора та причина від 3 до 2000 символів.'); if(await d.rejectAct(chat,id,text)) await d.clearSession(user);return true;}
      const a=await own(user,id);
      if(step==='wf_decline' || step==='wf_problem') {
        if(text.length<3 || text.length>2000) throw new Error('Напишіть причину від 3 до 2000 символів.');
        await rpc('rpv_service_transition',{p_user:user,p_application:id,p_version:a.updated_at,p_action:step==='wf_decline'?'decline':'problem',p_note:text});
        try{await d.onTransition?.(id);}catch{console.warn("Work card refresh pending");}
        await resetSession(user);await say(chat,'Збережено. Офіс побачить причину у заявці.',mainMenu(user));return true;
      }
      if(step==='wf_volume') {
        const value=text.replace(',','.');
        if(!/^\d+(\.\d{1,3})?$/.test(value)||Number(value)<=0||Number(value)>=1000000) throw new Error('Введіть додатне число, не більш ніж 3 знаки після коми.');
        await setSession(user,`wf_date:${id}:${value}`);await say(chat,'Дата виконання: РРРР-ММ-ДД або «Сьогодні».',keyboard('Сьогодні'));return true;
      }
      if(step==='wf_date') {
        const value=text==='Сьогодні'?day():text;
        if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>day()||value<'2020-01-01'||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value) throw new Error('Вкажіть коректну дату виконання, не пізніше сьогодні.');
        await setSession(user,`wf_note:${id}:${vol}:${value}`);await say(chat,'Додайте примітку: кількість рейсів, особливості роботи. Або натисніть «Без примітки».',keyboard('Без примітки'));return true;
      }
      if(step==='wf_note') {
        if(!/^\d+(\.\d{1,3})?$/.test(vol||'') || Number(vol)<=0 || Number(vol)>=1000000) {await setSession(user,`wf_volume:${id}`);throw new Error('Вкажіть фактичний обсяг у м³. Без кубів результат не приймається.');}
        if(!text||text.length>2000) throw new Error('Примітка має містити до 2000 символів.');
        await rpc('rpv_service_report',{p_user:user,p_application:id,p_version:a.updated_at,p_date:date,p_volume:Number(vol),p_notes:text==='Без примітки'?'':text});
        await setSession(user,`wf_upload:${id}`);await say(chat,'📎 Тепер надішліть фото або PDF акта (до 10 МБ). Результат буде передано офісу на перевірку.',keyboard('✏️ Змінити дані'));return true;
      }
      if(step==='wf_upload') {
        if(text==='✏️ Змінити дані'&&!a.awaiting_act){await setSession(user,`wf_volume:${id}`);await say(chat,'Вкажіть фактичний обсяг у м³.',keyboard('❌ Скасувати'));return true;}
        const photo=m.photo?.at(-1),doc=m.document,f=photo||doc;
        if(!f || f.file_size>10*1024*1024 || (doc && !['application/pdf','image/jpeg','image/png'].includes(doc.mime_type))) throw new Error('Потрібне фото, JPG, PNG або PDF до 10 МБ.');
        const r=await rpc('rpv_service_attach',{p_user:user,p_application:id,p_key:crypto.randomUUID(),p_file:f.file_id,p_type:photo?'photo':'document',p_name:String(doc?.file_name||'photo.jpg').slice(0,180)});
        await resetSession(user);
        if(r.created) await finalizeAct(chat,user,r.act_id);
        else await say(chat,'Файл додано до результату, який очікує перевірки.',mainMenu(user));
        return true;
      }
    }catch(e){await say(chat,(e as Error).message);}
    return true;
  }
  return { callback, message, card };
}

export async function authorizeServiceOffice(db:any,authorization:string):Promise<string|null> {
 const jwt=authorization.replace(/^Bearer\s+/i,"").trim();if(!jwt)return null;
 const auth=await db.auth.getUser(jwt);if(auth.error||!auth.data?.user?.id)return null;
 const admin=await db.from("admin_users").select("user_id,role").eq("user_id",auth.data.user.id).eq("is_active",true).maybeSingle();
 return !admin.error&&admin.data&&["owner","admin","dispatcher"].includes(admin.data.role)?admin.data.user_id:null;
}
