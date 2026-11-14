-- An explicit capability, reserved for the active chief administrator.
-- Employee grants can later be added here without widening the ordinary admin role.
create function public.rpv_office_has_permission(p_actor uuid,p_permission text)
returns boolean language sql stable security invoker set search_path='' as $$
 select p_permission='applications.edit_any_stage' and exists(
  select 1 from public.admin_users where user_id=p_actor and is_active and role='owner')
$$;
revoke all on function public.rpv_office_has_permission(uuid,text) from public,anon,authenticated;
grant execute on function public.rpv_office_has_permission(uuid,text) to service_role;

create table public.rpv_order_revisions (
 id uuid primary key,
 application_id uuid not null references public.applications(id) on delete restrict,
 actor_user_id uuid not null,
 reason text not null check(char_length(btrim(reason)) between 3 and 500),
 patch jsonb not null,
 before_data jsonb not null,
 after_data jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.rpv_order_revisions enable row level security;
revoke all on public.rpv_order_revisions from public,anon,authenticated,service_role;
grant select,insert on public.rpv_order_revisions to service_role;
create index rpv_order_revisions_application on public.rpv_order_revisions(application_id,created_at desc);

-- Server-only transaction context. Browser sessions cannot invoke the editor or
-- impersonate it by setting a GUC; role, actor and application must all match.
create function public.rpv_owner_edit_context(p_application uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select current_user='service_role'
  and current_setting('rpv.owner_edit_application',true)=p_application::text
  and exists(select 1 from public.admin_users where user_id::text=current_setting('rpv.owner_edit_actor',true) and is_active and role='owner')
$$;
revoke all on function public.rpv_owner_edit_context(uuid) from public,anon;
grant execute on function public.rpv_owner_edit_context(uuid) to authenticated,service_role;

create function public.rpv_owner_order_snapshot(p_application uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('application',to_jsonb(a),
  'acts',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.acts t where t.application_id=a.id),'[]'::jsonb),
  'report',(select to_jsonb(r) from public.rpv_service_reports r where r.application_id=a.id),
  'publication',(select to_jsonb(d) from public.rpv_customer_act_data d where d.application_id=a.id),
  'history',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from public.work_history w where w.application_id=a.id),'[]'::jsonb))
 from public.applications a where a.id=p_application
$$;
revoke all on function public.rpv_owner_order_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.rpv_owner_order_snapshot(uuid) to service_role;

create function public.rpv_owner_order_read(p_actor uuid,p_application uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s jsonb;d date;
begin
 if not public.rpv_office_has_permission(p_actor,'applications.edit_any_stage') then
  raise exception 'Редагування на будь-якій стадії доступне лише головному адміністратору.' using errcode='42501';
 end if;
 s:=public.rpv_owner_order_snapshot(p_application);
 if s is null then raise exception 'Заявку не знайдено.' using errcode='P0002';end if;
 d:=coalesce((s->'publication'->>'work_date')::date,(s->'report'->>'work_date')::date,
  (select coalesce((t.service_report->>'work_date')::date,(t.act_date at time zone 'Europe/Kyiv')::date)
   from public.acts t where t.application_id=p_application and t.status in ('pending','approved') order by t.created_at desc,t.id limit 1));
 return jsonb_build_object('application',s->'application','work_date',d,'version',md5(s::text),
  'has_result',exists(select 1 from public.acts where application_id=p_application and status in ('pending','approved'))
   or exists(select 1 from public.rpv_service_reports where application_id=p_application));
end $$;
revoke all on function public.rpv_owner_order_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rpv_owner_order_read(uuid,uuid) to service_role;

create or replace function public.rpv_service_write_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r text;finance text[]:=array['payout_amount','unit_price','payout_status','paid_at','payout_receipt_file_id','payout_receipt_type','payout_receipt_name','paid_by','updated_at'];
begin
 if tg_table_name='acts' and tg_op='UPDATE' then
  if old.service_report is not null and new.service_report is distinct from old.service_report and not public.rpv_owner_edit_context(new.application_id) then raise exception 'Immutable submitted report' using errcode='42501';end if;
 end if;
 if current_user not in ('anon','authenticated') then
  if tg_op='DELETE' then return old;else return new;end if;
 end if;
 select role into r from public.admin_users where user_id=(select auth.uid()) and is_active;
 if r is null or r='viewer' then raise exception 'Read-only office role' using errcode='42501';end if;
 if tg_table_name='applications' then
  if tg_op='UPDATE' and (new.customer_site_id,new.title,new.address,new.azk_code,new.description,new.manager_comment) is distinct from (old.customer_site_id,old.title,old.address,old.azk_code,old.description,old.manager_comment) then
   raise exception 'Використайте захищений редактор головного адміністратора.' using errcode='42501';
  end if;
  if r='accountant' then
   if tg_op<>'UPDATE' then raise exception 'Finance updates only' using errcode='42501';end if;
   if (to_jsonb(new)-finance) is distinct from (to_jsonb(old)-finance) then raise exception 'Finance updates only' using errcode='42501';end if;
  elsif r='dispatcher' then
   if tg_op='DELETE' then raise exception 'Owner required for deletion' using errcode='42501';end if;
   if tg_op='UPDATE' and exists(select 1 from unnest(finance) key where key<>'updated_at' and to_jsonb(new)->key is distinct from to_jsonb(old)->key) then raise exception 'Finance role required' using errcode='42501';end if;
   if tg_op='INSERT' and (new.payout_amount<>0 or new.unit_price<>0 or new.payout_status<>'pending') then raise exception 'Finance role required' using errcode='42501';end if;
  elsif r not in ('owner','admin') then raise exception 'Unknown role' using errcode='42501';end if;
  if tg_op='UPDATE' and (old.status='completed' and new.status is distinct from old.status
   or old.status in ('completed','cancelled') and (new.contractor_id,new.actual_volume,new.customer_site_id,new.title,new.address,new.azk_code,new.description,new.scheduled_at,new.deadline_at,new.manager_comment) is distinct from (old.contractor_id,old.actual_volume,old.customer_site_id,old.title,old.address,old.azk_code,old.description,old.scheduled_at,old.deadline_at,old.manager_comment)) then
   raise exception 'Дані закритої заявки змінює головний адміністратор через «Редагувати заявку».' using errcode='42501';
  end if;
 elsif tg_table_name='acts' then
  if r not in ('owner','admin','dispatcher') then raise exception 'Dispatch role required' using errcode='42501';end if;
  if tg_op='UPDATE' and new.status is distinct from old.status then raise exception 'Use authenticated review API' using errcode='42501';end if;
 elsif tg_table_name='contractors' and r not in ('owner','admin','dispatcher') then raise exception 'Dispatch role required' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function public.rpv_service_write_guard() from public,anon,authenticated;

create or replace function rvp_private.prepare_payout() returns trigger language plpgsql set search_path='' as $$
declare v_amount numeric; v_changed boolean;
begin
 if tg_op='UPDATE' then
  if old.payout_status='paid' and (new.payout_status,new.payout_amount,new.unit_price,new.paid_at,new.contractor_id,new.status) is distinct from (old.payout_status,old.payout_amount,old.unit_price,old.paid_at,old.contractor_id,old.status) then
   raise exception 'Оплачену заявку не можна змінювати без коригування.' using errcode='23514';
  end if;
  if old.payout_status='paid' and new.actual_volume is distinct from old.actual_volume and not public.rpv_owner_edit_context(new.id) then
   raise exception 'Фактичний обсяг оплаченої заявки змінює лише головний адміністратор через редактор.' using errcode='42501';
  end if;
  new.payout_accrued_at:=old.payout_accrued_at;
 end if;
 if coalesce(new.payout_amount,0)<0 or coalesce(new.unit_price,0)<0 or new.payout_amount::text in ('NaN','Infinity','-Infinity') or new.unit_price::text in ('NaN','Infinity','-Infinity') or new.actual_volume::text in ('NaN','Infinity','-Infinity') then
  raise exception 'Некоректна сума виплати.' using errcode='23514';
 end if;
 if new.status='completed' and new.payout_accrued_at is null then new.payout_accrued_at:=now();end if;
 v_amount:=case when new.payout_amount>0 then round(new.payout_amount,2) when new.actual_volume>0 and new.unit_price>0 then round(new.actual_volume*new.unit_price,2) end;
 if new.payout_status='paid' and (tg_op='INSERT' or old.payout_status is distinct from 'paid') then
  if new.status<>'completed' or new.contractor_id is null or coalesce(v_amount,0)<=0 then
   raise exception 'Для виплати потрібні прийнята робота, підрядник і сума.' using errcode='23514';
  end if;
  new.payout_amount:=v_amount;new.paid_at:=coalesce(new.paid_at,now());
 end if;
 if tg_op='INSERT' then new.payout_version:=1;
 else
  v_changed:=(new.payout_amount,new.unit_price,new.actual_volume,new.payout_status,new.paid_at,new.contractor_id,new.status) is distinct from (old.payout_amount,old.unit_price,old.actual_volume,old.payout_status,old.paid_at,old.contractor_id,old.status);
  new.payout_version:=old.payout_version+case when v_changed then 1 else 0 end;
  if v_changed then new.updated_at:=now();end if;
 end if;
 return new;
end $$;
revoke all on function rvp_private.prepare_payout() from public,anon,authenticated;

create function public.rpv_owner_order_edit(
 p_actor uuid,p_application uuid,p_version text,p_request uuid,p_reason text,p_patch jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 a public.applications%rowtype;n public.applications%rowtype;s public.rpv_customer_sites%rowtype;
 v_before jsonb;v_after jsonb;v_previous public.rpv_order_revisions%rowtype;
 v_date date;v_reason text:=btrim(p_reason);v_changes jsonb:='{}'::jsonb;
 v_key text;v_old jsonb;v_new jsonb;v_name text;v_act public.acts%rowtype;v_publish_date date;
begin
 -- Lock the current role as well as the order: revocation cannot race a save.
 perform 1 from public.admin_users where user_id=p_actor and is_active and role='owner' for share;
 if not found then raise exception 'Редагування на будь-якій стадії доступне лише головному адміністратору.' using errcode='42501';end if;
 if p_request is null or v_reason is null or char_length(v_reason) not between 3 and 500
  or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb
  or exists(select 1 from jsonb_object_keys(p_patch) k where k not in
   ('customer_site_id','contractor_id','description','manager_comment','scheduled_at','deadline_at','actual_volume','unit_price','payout_amount','work_date')) then
  raise exception 'Вкажіть зміни та причину редагування (3–500 символів).' using errcode='P2001';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rpv-owner-edit:'||p_request::text,0));
 select * into v_previous from public.rpv_order_revisions where id=p_request;
 if found then
  if v_previous.actor_user_id<>p_actor or v_previous.application_id<>p_application or v_previous.patch<>p_patch or v_previous.reason<>v_reason then
   raise exception 'Цю зміну вже збережено з іншими даними. Оновіть заявку.' using errcode='40001';
  end if;
  return jsonb_build_object('ok',true,'changed',false,'revision',p_request);
 end if;
 select * into a from public.applications where id=p_application for update;
 if not found then raise exception 'Заявку не знайдено.' using errcode='P0002';end if;
 perform 1 from public.acts where application_id=a.id order by id for update;
 perform 1 from public.rpv_service_reports where application_id=a.id for update;
 perform 1 from public.rpv_customer_act_data where application_id=a.id for update;
 perform 1 from public.work_history where application_id=a.id order by id for update;
 v_before:=public.rpv_owner_order_snapshot(a.id);
 if p_version is distinct from md5(v_before::text) then
  raise exception 'Заявка або акт змінилися. Оновіть дані перед збереженням.' using errcode='40001';
 end if;
 n:=jsonb_populate_record(a,p_patch-'work_date');
 if p_patch ? 'description' and (n.description is null or char_length(btrim(n.description)) not between 1 and 2000)
  or p_patch ? 'manager_comment' and char_length(coalesce(n.manager_comment,''))>2000 then
  raise exception 'Опис робіт обов’язковий, не більше 2000 символів.' using errcode='P2001';
 end if;
 if n.actual_volume is distinct from a.actual_volume and not public.rpv_valid_work_volume(n.actual_volume) then
  raise exception 'Вкажіть фактичний обсяг більше 0 м³, до 3 знаків після коми.' using errcode='P2001';
 end if;
 if n.unit_price is null or n.payout_amount is null or n.unit_price<0 or n.payout_amount<0
  or n.unit_price>=1000000000 or n.payout_amount>=1000000000
  or n.unit_price<>round(n.unit_price,2) or n.payout_amount<>round(n.payout_amount,2) then
  raise exception 'Вкажіть коректну суму, до двох знаків після коми.' using errcode='P2001';
 end if;
 if a.payout_status='paid' and (n.contractor_id,n.payout_amount,n.unit_price) is distinct from (a.contractor_id,a.payout_amount,a.unit_price) then
  raise exception 'Сума та отримувач зафіксованої виплати захищені. Редагувати дані роботи можна.' using errcode='P2001';
 end if;
 if n.contractor_id is distinct from a.contractor_id then
  perform 1 from public.contractors where id=n.contractor_id and status='active' and telegram_id is not null for share;
  if not found then raise exception 'Оберіть активного виконавця із системи.' using errcode='P2001';end if;
 end if;
 if n.customer_site_id is distinct from a.customer_site_id then
  select * into s from public.rpv_customer_sites where id=n.customer_site_id for share;
  if not found or s.merged_into is not null or nullif(btrim(s.label),'') is null or nullif(btrim(s.address),'') is null then
   raise exception 'Оберіть чинний паспорт об’єкта зі списку.' using errcode='P2001';
  end if;
  n.title:=s.label;n.address:=s.address;n.azk_code:=s.passport_azk_code;
 end if;
 if n.scheduled_at is not null and (n.scheduled_at<'2000-01-01' or n.scheduled_at>='2101-01-01')
  or n.deadline_at is not null and (n.deadline_at<'2000-01-01' or n.deadline_at>='2101-01-01') then
  raise exception 'Перевірте дату та дедлайн.' using errcode='P2001';
 end if;
 if p_patch ? 'work_date' then
  v_date:=(p_patch->>'work_date')::date;
  if v_date is null or v_date<'2020-01-01' or v_date>(now() at time zone 'Europe/Kyiv')::date then
   raise exception 'Вкажіть фактичну дату виконання, не пізніше сьогодні.' using errcode='P2001';
  end if;
  if not exists(select 1 from public.acts where application_id=a.id and status in ('pending','approved'))
    and not exists(select 1 from public.rpv_service_reports where application_id=a.id) then
   raise exception 'Фактичну дату можна уточнити після подання результату або акта.' using errcode='P2001';
  end if;
 end if;
 -- Update submitted structured results first so the existing volume guard still
 -- enforces agreement. Original files and the full original report remain in audit.
 perform set_config('rpv.owner_edit_actor',p_actor::text,true);
 perform set_config('rpv.owner_edit_application',a.id::text,true);
 perform set_config('rpv.finance_actor',p_actor::text,true);
 update public.acts t set
  contractor_id=n.contractor_id,
  service_report=case when n.actual_volume is distinct from a.actual_volume or v_date is not null
    or n.contractor_id is distinct from a.contractor_id and t.service_report is not null then
   coalesce(t.service_report,'{}'::jsonb)
    || case when n.actual_volume is distinct from a.actual_volume then jsonb_build_object('volume',n.actual_volume) else '{}'::jsonb end
    || case when v_date is not null then jsonb_build_object('work_date',v_date) else '{}'::jsonb end
    || case when n.contractor_id is distinct from a.contractor_id then jsonb_build_object('contractor_id',n.contractor_id) else '{}'::jsonb end
   else t.service_report end,
  act_date=case when v_date is not null then v_date::timestamp at time zone 'Europe/Kyiv' else t.act_date end
 where t.application_id=a.id and t.status in ('pending','approved')
  and (n.actual_volume is distinct from a.actual_volume or v_date is not null or n.contractor_id is distinct from a.contractor_id);
 update public.applications set customer_site_id=n.customer_site_id,title=n.title,address=n.address,azk_code=n.azk_code,
  description=n.description,manager_comment=n.manager_comment,contractor_id=n.contractor_id,
  scheduled_at=n.scheduled_at,deadline_at=n.deadline_at,actual_volume=n.actual_volume,
  unit_price=n.unit_price,payout_amount=n.payout_amount,updated_at=clock_timestamp()
 where id=a.id;
 update public.rpv_service_reports set volume=n.actual_volume,contractor_id=n.contractor_id,
  work_date=coalesce(v_date,work_date),updated_at=clock_timestamp()
 where application_id=a.id and (n.actual_volume is distinct from a.actual_volume or v_date is not null or n.contractor_id is distinct from a.contractor_id);
 update public.rpv_customer_act_data set site_id=n.customer_site_id,pumped_m3=n.actual_volume,work_date=coalesce(v_date,work_date)
 where application_id=a.id and (n.actual_volume is distinct from a.actual_volume or v_date is not null or n.customer_site_id is distinct from a.customer_site_id);
 -- Legacy approved acts can lack a counter publication. Repair only with an
 -- explicit passport, positive actual volume and a known/entered work date.
 if (n.actual_volume is distinct from a.actual_volume or v_date is not null or n.customer_site_id is distinct from a.customer_site_id)
  and not exists(select 1 from public.rpv_customer_act_data where application_id=a.id) then
  select * into v_act from public.acts where application_id=a.id and status='approved' order by created_at desc,id limit 1;
  if found then
   v_publish_date:=coalesce(v_date,(v_act.service_report->>'work_date')::date,(v_act.act_date at time zone 'Europe/Kyiv')::date);
   if n.customer_site_id is null or not public.rpv_valid_work_volume(n.actual_volume) or v_publish_date is null
    or v_publish_date<'2020-01-01' or v_publish_date>(now() at time zone 'Europe/Kyiv')::date then
    raise exception 'Для історії прийнятого акта вкажіть об’єкт, фактичну дату виконання та обсяг.' using errcode='P2001';
   end if;
   insert into public.rpv_customer_act_data(act_id,application_id,site_id,work_date,pumped_m3)
   values(v_act.id,a.id,n.customer_site_id,v_publish_date,n.actual_volume);
  end if;
 end if;
 update public.work_history set title=n.title,description=n.description,contractor_id=n.contractor_id,
  completed_at=case when v_date is not null then v_date::timestamp at time zone 'Europe/Kyiv' else completed_at end
 where application_id=a.id and (n.title,n.description,n.contractor_id) is distinct from (a.title,a.description,a.contractor_id)
  or application_id=a.id and v_date is not null;
 v_after:=public.rpv_owner_order_snapshot(a.id);
 -- Human-readable changes in the order timeline; full snapshots in append-only audit.
 for v_key in select jsonb_object_keys(p_patch) loop
  if v_key='work_date' then
   v_old:=coalesce(v_before->'publication'->'work_date',v_before->'report'->'work_date',v_before->'acts'->0->'act_date','null'::jsonb);
   v_new:=to_jsonb(v_date);
  else v_old:=v_before->'application'->v_key;v_new:=v_after->'application'->v_key;end if;
  if v_old is distinct from v_new then v_changes:=v_changes||jsonb_build_object(v_key,jsonb_build_object('before',v_old,'after',v_new));end if;
 end loop;
 if v_changes='{}'::jsonb then raise exception 'Немає змін для збереження.' using errcode='P2001';end if;
 insert into public.rpv_order_revisions(id,application_id,actor_user_id,reason,patch,before_data,after_data)
 values(p_request,a.id,p_actor,v_reason,p_patch,v_before,v_after);
 select coalesce(nullif(full_name,''),'Головний адміністратор') into v_name from public.admin_users where user_id=p_actor;
 insert into public.application_events(application_id,event_type,title,description,actor_user_id,actor_name,metadata)
 values(a.id,'owner_order_edited','Заявку відредагував головний адміністратор',v_reason,p_actor,v_name,
  jsonb_build_object('revision',p_request,'changes',v_changes,'before_title',a.title,'after_title',n.title,
   'before_contractor',(select btrim(concat_ws(' ',first_name,last_name)) from public.contractors where id=a.contractor_id),
   'after_contractor',(select btrim(concat_ws(' ',first_name,last_name)) from public.contractors where id=n.contractor_id)));
 insert into public.rpv_portal_events(actor,action,application_id,details)
 values(p_actor::text,'owner_order_edited',a.id,jsonb_build_object('revision',p_request,'reason',v_reason,'changes',v_changes));
 perform set_config('rpv.owner_edit_actor','',true);
 perform set_config('rpv.owner_edit_application','',true);
 perform set_config('rpv.finance_actor','',true);
 return jsonb_build_object('ok',true,'changed',true,'revision',p_request);
end $$;
revoke all on function public.rpv_owner_order_edit(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rpv_owner_order_edit(uuid,uuid,text,uuid,text,jsonb) to service_role;
