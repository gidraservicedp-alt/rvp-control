-- A work result is measured in entered cubic metres, never in tank capacity.
-- Legacy closed rows remain unchanged; every new completion requires a volume.
create function public.rpv_valid_work_volume(p_volume numeric) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(p_volume>0 and p_volume<1000000 and p_volume=round(p_volume,3),false)
$$;
revoke all on function public.rpv_valid_work_volume(numeric) from public,anon;
grant execute on function public.rpv_valid_work_volume(numeric) to authenticated,service_role;

create function public.rpv_work_volume_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare changed boolean; a public.applications%rowtype; v numeric;
begin
 if tg_table_name='applications' then
  changed:=tg_op='INSERT';
  if tg_op='UPDATE' then changed:=new.actual_volume is distinct from old.actual_volume;end if;
  if changed and new.actual_volume is not null and not public.rpv_valid_work_volume(new.actual_volume) then
   raise exception 'Вкажіть фактичний обсяг більше 0 м³, до 3 знаків після коми.' using errcode='P2001';
  end if;
  if new.status='completed' and (tg_op='INSERT' or changed or old.status is distinct from 'completed')
   and not public.rpv_valid_work_volume(new.actual_volume) then
   raise exception 'Для завершення заявки вкажіть фактичний обсяг у м³.' using errcode='P2001';
  end if;
  if changed and exists(select 1 from public.acts x where x.application_id=new.id and x.status in ('pending','approved')
    and x.service_report->>'volume' is not null and (x.service_report->>'volume')::numeric is distinct from new.actual_volume) then
   raise exception 'Обсяг має відповідати результату виконавця. Поверніть акт на уточнення.' using errcode='P2002';
  end if;
 elsif new.status='approved' and (tg_op='INSERT' or old.status is distinct from 'approved') then
  select * into a from public.applications where id=new.application_id;
  v:=coalesce((new.service_report->>'volume')::numeric,a.actual_volume);
  if not public.rpv_valid_work_volume(v) or not public.rpv_valid_work_volume(a.actual_volume) then
   raise exception 'Перед підтвердженням акта вкажіть фактичний обсяг у м³.' using errcode='P2001';
  end if;
  if v is distinct from a.actual_volume then
   raise exception 'Обсяг акта не відповідає заявці. Оновіть результат.' using errcode='P2002';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.rpv_work_volume_guard() from public,anon,authenticated;
create trigger rpv_work_volume_guard before insert or update on public.applications
 for each row execute function public.rpv_work_volume_guard();
create trigger rpv_work_volume_guard before insert or update on public.acts
 for each row execute function public.rpv_work_volume_guard();

-- Authenticated office API supplies the verified actor. Direct client execution is denied.
create function public.rpv_office_work_volume(p_actor uuid,p_application uuid,p_version timestamptz,p_volume numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.applications%rowtype;
begin
 if not exists(select 1 from public.admin_users where user_id=p_actor and is_active and role in ('owner','admin','dispatcher')) then
  raise exception 'Недостатньо прав для зміни обсягу.' using errcode='42501';
 end if;
 if not public.rpv_valid_work_volume(p_volume) then
  raise exception 'Вкажіть фактичний обсяг більше 0 м³, до 3 знаків після коми.' using errcode='P2001';
 end if;
 select * into a from public.applications where id=p_application for update;
 if not found or a.updated_at is distinct from p_version or a.status in ('completed','cancelled') then
  raise exception 'Заявка змінилася або вже закрита. Оновіть її.' using errcode='40001';
 end if;
 if a.actual_volume is not distinct from p_volume then
  return jsonb_build_object('ok',true,'volume',p_volume,'version',a.updated_at);
 end if;
 update public.applications set actual_volume=p_volume,updated_at=clock_timestamp() where id=a.id;
 -- A saved draft must not later overwrite the explicitly corrected office volume.
 update public.rpv_service_reports set volume=p_volume,updated_at=clock_timestamp()
  where application_id=a.id and state in ('draft','rejected');
 insert into public.rpv_portal_events(actor,action,application_id,details)
  values(p_actor::text,'work_volume_updated',a.id,jsonb_build_object('previous_volume',a.actual_volume,'volume',p_volume));
 insert into public.application_events(application_id,event_type,title,description,actor_user_id,actor_name,metadata)
  values(a.id,'work_volume_updated','Фактичний обсяг збережено',p_volume::text||' м³',p_actor,'Офіс',jsonb_build_object('previous_volume',a.actual_volume,'volume',p_volume));
 return (select jsonb_build_object('ok',true,'volume',actual_volume,'version',updated_at) from public.applications where id=a.id);
end $$;
revoke all on function public.rpv_office_work_volume(uuid,uuid,timestamptz,numeric) from public,anon,authenticated;
grant execute on function public.rpv_office_work_volume(uuid,uuid,timestamptz,numeric) to service_role;

-- Publication uses the explicit passport link and the same accepted volume as the order.
create or replace function public.rpv_customer_publish(p_act text,p_site text,p_date date,p_volume numeric)
returns table(act_id uuid,site_id uuid,work_date date,pumped_m3 numeric,application_number text)
language plpgsql security invoker set search_path='' as $$
declare v_act public.acts%rowtype;v_app public.applications%rowtype;v_site uuid;
begin
 if p_date is null or p_date<'2020-01-01' or p_date>(now() at time zone 'Europe/Kyiv')::date
    or not public.rpv_valid_work_volume(p_volume) then return;end if;
 select * into strict v_act from public.acts where acts.act_number=p_act and status='approved' for share;
 select * into strict v_app from public.applications where id=v_act.application_id;
 if p_volume is distinct from v_app.actual_volume then return;end if;
 select s.id into strict v_site from public.rpv_customer_sites s where s.site_key=p_site and (
  v_app.customer_site_id=s.id or (v_app.customer_site_id is null and nullif(btrim(v_app.address),'') is not null
   and lower(regexp_replace(s.address,'[[:space:][:punct:]]+','','g'))=lower(regexp_replace(v_app.address,'[[:space:][:punct:]]+','','g')))
 );
 insert into public.rpv_customer_act_data(act_id,application_id,site_id,work_date,pumped_m3)
  values(v_act.id,v_app.id,v_site,p_date,p_volume) on conflict on constraint rpv_customer_act_data_pkey do nothing;
 return query select d.act_id,d.site_id,d.work_date,d.pumped_m3,v_app.application_number
  from public.rpv_customer_act_data d where d.act_id=v_act.id and d.site_id=v_site and d.work_date=p_date and d.pumped_m3=p_volume;
exception when no_data_found or too_many_rows or unique_violation then return;
end $$;
revoke all on function public.rpv_customer_publish(text,text,date,numeric) from public,anon,authenticated;
grant execute on function public.rpv_customer_publish(text,text,date,numeric) to service_role;

create or replace function public.rpv_service_report(p_user bigint,p_application uuid,p_version timestamptz,p_date date,p_volume numeric,p_notes text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c uuid;a public.applications%rowtype;
begin
 if not public.rpv_valid_work_volume(p_volume) then raise exception 'Вкажіть фактичний обсяг у м³.' using errcode='P2001';end if;
 if p_date is null or p_date<'2020-01-01' or p_date>(now() at time zone 'Europe/Kyiv')::date or (p_volume is not null and (p_volume<=0 or p_volume>=1000000 or p_volume<>round(p_volume,3))) or p_notes is null or char_length(p_notes)>2000 then raise exception 'Invalid report' using errcode='22023';end if;
 select id into c from public.contractors where telegram_id=p_user and status='active' and nullif(phone,'') is not null for share;
 if c is null then raise exception 'Access denied' using errcode='42501';end if;
 select * into a from public.applications where id=p_application and contractor_id=c for update;
 if not found or a.updated_at is distinct from p_version or a.status in ('completed','cancelled') or a.awaiting_act or a.arrived_at is null then raise exception 'Report unavailable' using errcode='40001';end if;
 if exists(select 1 from public.acts where application_id=a.id and status in ('pending','approved')) then raise exception 'Act already submitted' using errcode='40001';end if;
 insert into public.rpv_service_reports(application_id,contractor_id,work_date,volume,notes) values(a.id,c,p_date,p_volume,btrim(p_notes)) on conflict(application_id) do update set contractor_id=excluded.contractor_id,work_date=excluded.work_date,volume=excluded.volume,notes=excluded.notes,review_reason='',state='draft',updated_at=now();
 update public.applications set actual_volume=p_volume,updated_at=clock_timestamp() where id=a.id;
 insert into public.application_events(application_id,event_type,title,description,actor_name,metadata)
  values(a.id,'work_volume_reported','Обсяг від виконавця',p_volume::text||' м³','Виконавець',jsonb_build_object('previous_volume',a.actual_volume,'volume',p_volume));
 insert into public.rpv_portal_events(actor,action,application_id,details) values(p_user::text,'service_report',a.id,jsonb_build_object('work_date',p_date,'reported_volume',p_volume));
 return jsonb_build_object('ok',true);
end $$;


create or replace function public.rpv_service_review(p_actor text,p_act uuid,p_decision text,p_reason text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.applications%rowtype;v_act public.acts%rowtype;r public.rpv_service_reports%rowtype;s public.rpv_customer_sites%rowtype;v_app uuid;pub jsonb;tg bigint;v_volume numeric;v_date date;
begin
 if nullif(p_actor,'') is null or p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Invalid review' using errcode='22023';end if;
 select application_id into v_app from public.acts where id=p_act;
 select * into a from public.applications where id=v_app for update;
 if not found then raise exception 'Application missing' using errcode='22023';end if;
 select * into v_act from public.acts where id=p_act for update;
 if v_act.status=p_decision then return jsonb_build_object('ok',true,'changed',false);end if;
 if v_act.status<>'pending' or a.status='cancelled' or a.contractor_id is distinct from v_act.contractor_id then raise exception 'Act unavailable' using errcode='40001';end if;
 if v_act.service_report is not null then r:=jsonb_populate_record(null::public.rpv_service_reports,v_act.service_report);end if;
 select telegram_id into tg from public.contractors where id=a.contractor_id;
 if p_decision='approved' then
  v_volume:=coalesce(r.volume,a.actual_volume);
  v_date:=coalesce(r.work_date,(v_act.act_date at time zone 'Europe/Kyiv')::date,(now() at time zone 'Europe/Kyiv')::date);
  if not public.rpv_valid_work_volume(v_volume) then raise exception 'Для завершення заявки вкажіть фактичний обсяг у м³.' using errcode='P2001';end if;
  if exists(select 1 from public.acts where application_id=a.id and status='approved' and id<>p_act) then raise exception 'Already approved' using errcode='40001';end if;
  update public.applications set actual_volume=v_volume,updated_at=clock_timestamp() where id=a.id;
  update public.acts set status='approved',reviewed_at=now() where id=p_act;
  update public.applications set status='completed',contractor_stage='completed',awaiting_act=false,actual_volume=v_volume,updated_at=now() where id=a.id;
  if not exists(select 1 from public.work_history where application_id=a.id) then
   insert into public.work_history(application_id,contractor_id,title,description,completed_at) values(a.id,a.contractor_id,a.title,a.description,v_date::timestamp at time zone 'Europe/Kyiv');
  end if;
  if a.customer_site_id is not null then
    select * into s from public.rpv_customer_sites where id=a.customer_site_id;
    select to_jsonb(x) into pub from public.rpv_customer_publish(v_act.act_number,s.site_key,v_date,v_volume) x;
    if pub is null then raise exception 'Check object address and previous publication' using errcode='22023';end if;
  end if;
  if r.application_id is not null then
   update public.rpv_service_reports set state='approved',updated_at=now() where application_id=a.id;
  end if;
 else
  if char_length(btrim(coalesce(p_reason,'')))<3 or char_length(p_reason)>2000 then raise exception 'Rejection reason required' using errcode='22023';end if;
  update public.acts set status='rejected',reviewed_at=now() where id=p_act;
  update public.applications set status='in_progress',awaiting_act=false,updated_at=now() where id=a.id;
  update public.rpv_service_reports set state='rejected',review_reason=p_reason,updated_at=now() where application_id=a.id;
 end if;
 insert into public.rpv_portal_events(actor,action,application_id,details) values(p_actor,'service_'||p_decision,a.id,jsonb_build_object('volume',v_volume,'act_id',p_act,'reason',p_reason,'publication',pub));
 return jsonb_build_object('ok',true,'changed',true,'application_id',a.id,'application_number',a.application_number,'contractor_telegram_id',tg,'publication',pub);
end $$;


create or replace function public.rpv_service_attach(p_user bigint,p_application uuid,p_key uuid,p_file text,p_type text,p_name text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c uuid;a public.applications%rowtype;r public.rpv_service_reports%rowtype;v_act public.acts%rowtype;v_created boolean:=false;
begin
 if p_key is null or nullif(p_file,'') is null or char_length(p_file)>1000 or p_type is null or p_type not in ('photo','document') or p_name is null or char_length(p_name)>180 then raise exception 'Invalid file' using errcode='22023';end if;
 select id into c from public.contractors where telegram_id=p_user and status='active' and nullif(phone,'') is not null for share;
 if c is null then raise exception 'Access denied' using errcode='42501';end if;
 select * into a from public.applications where id=p_application and contractor_id=c for update;
 if not found or a.status in ('completed','cancelled') then raise exception 'Application unavailable' using errcode='40001';end if;
 select * into r from public.rpv_service_reports where application_id=a.id and contractor_id=c and state in ('draft','submitted') for update;
 if not found then raise exception 'Report required' using errcode='22023';end if;
 if not public.rpv_valid_work_volume(r.volume) then raise exception 'Спочатку вкажіть фактичний обсяг у м³.' using errcode='P2001';end if;
 select * into v_act from public.acts where application_id=a.id and contractor_id=c and status='pending' order by created_at limit 1 for update;
 if not found then
  if exists(select 1 from public.acts where id=p_key or application_id=a.id and status='approved') then raise exception 'Act key unavailable' using errcode='40001';end if;
  insert into public.acts(id,contractor_id,application_id,telegram_file_id,file_type,file_name,status,act_number,act_date,service_report) values(p_key,c,a.id,p_file,p_type,p_name,'pending','A-'||upper(substr(replace(p_key::text,'-',''),1,16)),r.work_date::timestamp at time zone 'Europe/Kyiv',to_jsonb(r)) returning * into v_act;
  v_created:=true;
 end if;
 if not exists(select 1 from public.act_files where act_id=v_act.id and telegram_file_id=p_file) then
  if (select count(*) from public.act_files where act_id=v_act.id)>=10 then raise exception 'Too many files' using errcode='22023';end if;
  insert into public.act_files(act_id,telegram_file_id,file_type,file_name) values(v_act.id,p_file,p_type,p_name);
 end if;
 update public.rpv_service_reports set state='submitted',updated_at=now() where application_id=a.id;
 update public.applications set status='in_progress',awaiting_act=true,updated_at=now() where id=a.id;
 if v_created then insert into public.rpv_portal_events(actor,action,application_id,details) values(p_user::text,'service_submit',a.id,jsonb_build_object('act_id',v_act.id));end if;
 return jsonb_build_object('ok',true,'act_id',v_act.id,'created',v_created);
end $$;

