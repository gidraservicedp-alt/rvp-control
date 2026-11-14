alter table public.applications add column if not exists payout_accrued_at timestamptz;
alter table public.applications add column if not exists payout_version bigint not null default 0;

-- Preserve the completion date, even when the price is agreed or paid later.
update public.applications a set payout_accrued_at=coalesce(
 (select min(completed_at) from public.work_history w where w.application_id=a.id),
 (select min(coalesce(reviewed_at,created_at)) from public.acts t where t.application_id=a.id and t.status='approved'),
 a.updated_at,a.created_at)
where payout_accrued_at is null and (a.status='completed' or a.payout_status='paid');

create or replace view public.rpv_finance_entries with (security_invoker=true) as
select a.id,a.application_number,a.title,a.address,a.status,a.contractor_id,
 coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),'Не призначено') contractor_name,c.phone contractor_phone,
 a.customer_site_id,s.passport_network network,s.passport_city_code city_code,
 a.actual_volume,a.unit_price,a.payout_amount,a.payout_status,a.paid_at,a.payout_accrued_at,a.payout_version,
 a.payout_receipt_file_id,a.payout_receipt_type,a.payout_receipt_name,
 m.amount,
 case when a.status='completed' and a.payout_status is distinct from 'paid' then coalesce(m.amount,0) else 0 end debt,
 a.status='completed' and a.payout_status is distinct from 'paid' pending,
 a.status='completed' and a.payout_status is distinct from 'paid' and m.amount is null needs_amount,
 a.status='completed' and a.payout_status is distinct from 'paid' and a.contractor_id is null needs_contractor
from public.applications a left join public.contractors c on c.id=a.contractor_id
left join public.rpv_customer_sites s on s.id=a.customer_site_id
cross join lateral (select case when a.payout_amount>0 then round(a.payout_amount,2)
 when a.payout_status is distinct from 'paid' and a.actual_volume>0 and a.unit_price>0 then round(a.actual_volume*a.unit_price,2) else null end amount) m
where a.status='completed' or a.payout_status='paid';
revoke all on public.rpv_finance_entries from public,anon,authenticated;
grant select on public.rpv_finance_entries to service_role;

create table public.rpv_payout_events (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.applications(id) on delete restrict,
 contractor_id uuid references public.contractors(id) on delete restrict,
 application_number text,contractor_name text,
 kind text not null check(kind in ('opening','accrued','amount_changed','contractor_changed','paid','status_changed')),
 amount numeric, previous_amount numeric, payout_status text, previous_status text,
 accrued_at timestamptz,paid_at timestamptz,
 occurred_at timestamptz not null default now(),recorded_at timestamptz not null default now(),
 actor_user_id uuid,actor_telegram_id bigint,source text not null default 'system'
);
alter table public.rpv_payout_events enable row level security;
revoke all on public.rpv_payout_events from public,anon,authenticated,service_role;
grant select,insert on public.rpv_payout_events to service_role;
create index rpv_payout_events_application on public.rpv_payout_events(application_id,occurred_at desc,id);
create index rpv_payout_events_contractor on public.rpv_payout_events(contractor_id,occurred_at desc,id);
create index rpv_finance_accrued on public.applications(payout_accrued_at) where payout_accrued_at is not null;

insert into public.rpv_payout_events(application_id,contractor_id,application_number,contractor_name,kind,amount,payout_status,accrued_at,occurred_at,source)
select id,contractor_id,application_number,contractor_name,'opening',amount,'pending',payout_accrued_at,payout_accrued_at,'migration' from public.rpv_finance_entries;
insert into public.rpv_payout_events(application_id,contractor_id,application_number,contractor_name,kind,amount,payout_status,previous_status,accrued_at,paid_at,occurred_at,source)
select id,contractor_id,application_number,contractor_name,'paid',amount,'paid','pending',payout_accrued_at,paid_at,coalesce(paid_at,payout_accrued_at),'migration' from public.rpv_finance_entries where payout_status='paid';

create or replace function rvp_private.prepare_payout() returns trigger language plpgsql set search_path='' as $$
declare v_amount numeric; v_changed boolean;
begin
 if tg_op='UPDATE' then
  if old.payout_status='paid' and (new.payout_status,new.payout_amount,new.actual_volume,new.unit_price,new.paid_at,new.contractor_id,new.status) is distinct from (old.payout_status,old.payout_amount,old.actual_volume,old.unit_price,old.paid_at,old.contractor_id,old.status) then
   raise exception 'Оплачену заявку не можна змінювати без коригування.' using errcode='23514';
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
create trigger zz_rpv_prepare_payout before insert or update on public.applications for each row execute function rvp_private.prepare_payout();

create or replace function rvp_private.capture_payout() returns trigger language plpgsql security definer set search_path='' as $$
declare v_kind text; v_amount numeric; v_previous numeric; v_actor uuid;v_name text;v_old_status text;
begin
 if new.status<>'completed' and new.payout_status is distinct from 'paid' then return new;end if;
 if tg_op='UPDATE' and new.payout_version=old.payout_version then return new;end if;
 v_amount:=case when new.payout_amount>0 then round(new.payout_amount,2) when new.actual_volume>0 and new.unit_price>0 then round(new.actual_volume*new.unit_price,2) end;
 if tg_op='INSERT' then v_kind:=case when new.payout_status='paid' then 'paid' else 'accrued' end;
 else
  v_previous:=case when old.payout_amount>0 then round(old.payout_amount,2) when old.actual_volume>0 and old.unit_price>0 then round(old.actual_volume*old.unit_price,2) end;
  v_old_status:=old.payout_status;
  v_kind:=case when new.payout_status='paid' and old.payout_status is distinct from 'paid' then 'paid'
   when old.status<>'completed' then 'accrued' when new.contractor_id is distinct from old.contractor_id then 'contractor_changed'
   when v_amount is distinct from v_previous then 'amount_changed' else 'status_changed' end;
 end if;
 v_actor:=coalesce(nullif(current_setting('rpv.finance_actor',true),'')::uuid,auth.uid());
 select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into v_name from public.contractors where id=new.contractor_id;
 insert into public.rpv_payout_events(application_id,contractor_id,application_number,contractor_name,kind,amount,previous_amount,payout_status,previous_status,accrued_at,paid_at,actor_user_id,actor_telegram_id,source)
 values(new.id,new.contractor_id,new.application_number,coalesce(v_name,'Не призначено'),v_kind,v_amount,v_previous,new.payout_status,v_old_status,new.payout_accrued_at,new.paid_at,v_actor,new.paid_by,case when v_actor is not null then 'office' else 'system' end);
 insert into public.application_events(application_id,event_type,title,description,actor_user_id,actor_name,metadata)
 values(new.id,'finance_'||v_kind,case when v_kind='paid' then 'Виплату зафіксовано' when v_kind='accrued' then 'Роботу прийнято до розрахунку' else 'Розрахунок із підрядником оновлено' end,
 coalesce(v_amount::text||' грн','Суму ще не вказано')||' · '||case when new.payout_status='paid' then 'Виплачено' else 'Не оплачено' end,
 v_actor,coalesce((select full_name from public.admin_users where user_id=v_actor),'Система'),jsonb_build_object('amount',v_amount,'previous_amount',v_previous,'payout_status',new.payout_status,'paid_at',new.paid_at,'contractor_id',new.contractor_id));
 return new;
end $$;
revoke all on function rvp_private.capture_payout() from public,anon,authenticated;
create trigger zz_rpv_capture_payout after insert or update on public.applications for each row execute function rvp_private.capture_payout();

create or replace function public.rpv_finance_change(p_actor uuid,p_application uuid,p_version bigint,p_action text,p_amount numeric default null,p_contractor uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.applications;v_amount numeric;v_role text;
begin
 select role into v_role from public.admin_users where user_id=p_actor and is_active;
 if v_role is null or v_role not in ('owner','admin','accountant') then raise exception 'Недостатньо прав для виплат.' using errcode='42501';end if;
 if p_action is null or p_action not in ('set_amount','confirm') then raise exception 'Невідома дія.' using errcode='22023';end if;
 select * into a from public.applications where id=p_application for update;
 if not found then raise exception 'Заявку не знайдено.' using errcode='P0002';end if;
 if p_action='confirm' and a.payout_status='paid' then return jsonb_build_object('ok',true,'already_paid',true);end if;
 if a.payout_version is distinct from p_version then raise exception 'Дані змінилися. Оновіть виплату.' using errcode='40001';end if;
 if a.status<>'completed' or a.payout_status='paid' then raise exception 'Редагувати можна лише прийняту неоплачену роботу.' using errcode='23514';end if;
 perform set_config('rpv.finance_actor',p_actor::text,true);
 if p_action='set_amount' then
  if p_amount is null or p_amount<=0 or p_amount>1000000000 or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<>p_amount then raise exception 'Вкажіть суму більше 0, до двох знаків після коми.' using errcode='22023';end if;
  if p_contractor is not null and a.contractor_id is not null and p_contractor<>a.contractor_id then raise exception 'Не можна змінити виконавця прийнятої роботи.' using errcode='23514';end if;
  if a.contractor_id is null and (p_contractor is null or not exists(select 1 from public.contractors where id=p_contractor)) then raise exception 'Оберіть підрядника.' using errcode='22023';end if;
  update public.applications set payout_amount=p_amount,contractor_id=coalesce(a.contractor_id,p_contractor) where id=a.id;
 else
  select amount into v_amount from public.rpv_finance_entries where id=a.id;
  if a.contractor_id is null or coalesce(v_amount,0)<=0 then raise exception 'Спочатку вкажіть підрядника та суму.' using errcode='23514';end if;
  update public.applications set payout_amount=v_amount,payout_status='paid',paid_at=now() where id=a.id;
 end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.rpv_finance_change(uuid,uuid,bigint,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.rpv_finance_change(uuid,uuid,bigint,text,numeric,uuid) to service_role;

create or replace function public.rpv_finance_report(p_month date,p_contractor uuid default null,p_application uuid default null,p_state text default 'all',p_offset integer default 0,p_export boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare d date:=(now() at time zone 'Europe/Kyiv')::date; result jsonb;
begin
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_month<'2020-01-01'::date or p_month>date_trunc('month',d)::date or p_offset is null or p_offset<0 or p_state is null or p_state not in ('all','pending','paid','missing') or p_export is null then raise exception 'Некоректні фільтри.' using errcode='22023';end if;
 with entries as materialized (select * from public.rpv_finance_entries where (p_contractor is null or contractor_id=p_contractor) and (p_application is null or id=p_application)),
 selected as materialized (select * from entries where (p_application is not null or pending or (payout_accrued_at at time zone 'Europe/Kyiv')::date>=p_month and (payout_accrued_at at time zone 'Europe/Kyiv')::date<(p_month+interval '1 month')::date or (paid_at at time zone 'Europe/Kyiv')::date>=p_month and (paid_at at time zone 'Europe/Kyiv')::date<(p_month+interval '1 month')::date)
 and (p_state='all' or p_state='pending' and pending or p_state='paid' and payout_status='paid' or p_state='missing' and (needs_amount or needs_contractor))),
 rows as (select * from selected order by pending desc,payout_accrued_at desc,id limit case when p_export then null else 50 end offset case when p_export then 0 else p_offset end),
 contractors as (select contractor_id,contractor_name,sum(debt) debt,coalesce(sum(amount) filter(where payout_status='paid'),0) paid,count(*) filter(where pending) pending_count,count(*) filter(where needs_amount) missing_amount_count,count(*) filter(where payout_status='paid') paid_count from entries group by contractor_id,contractor_name)
 select jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'as_of',now(),'filter_contractor',p_contractor,'filter_application',p_application,'filter_state',p_state,'stats',jsonb_build_object(
 'accrued_today',coalesce((select sum(amount) from entries where (payout_accrued_at at time zone 'Europe/Kyiv')::date=d),0),
 'accrued_month',coalesce((select sum(amount) from entries where (payout_accrued_at at time zone 'Europe/Kyiv')::date>=p_month and (payout_accrued_at at time zone 'Europe/Kyiv')::date<(p_month+interval '1 month')::date),0),
 'paid_month',coalesce((select sum(amount) from entries where payout_status='paid' and (paid_at at time zone 'Europe/Kyiv')::date>=p_month and (paid_at at time zone 'Europe/Kyiv')::date<(p_month+interval '1 month')::date),0),
 'accrued_total',coalesce((select sum(amount) from entries),0),'paid_total',coalesce((select sum(amount) from entries where payout_status='paid'),0),
 'debt_total',coalesce((select sum(debt) from entries),0),'pending_count',(select count(*) from entries where pending),'missing_amount_count',(select count(*) from entries where needs_amount),'missing_contractor_count',(select count(*) from entries where needs_contractor)),
 'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.pending desc,r.payout_accrued_at desc,r.id) from rows r),'[]'::jsonb),
 'row_count',(select count(*) from selected),'more',not p_export and (select count(*) from selected)>p_offset+50,
 'monthly',coalesce((select jsonb_agg(to_jsonb(t) order by t.month) from (select month,sum(paid) paid,sum(debt) debt from (select to_char(paid_at at time zone 'Europe/Kyiv','YYYY-MM') as month,amount paid,0::numeric debt from entries where payout_status='paid' and paid_at is not null union all select to_char(payout_accrued_at at time zone 'Europe/Kyiv','YYYY-MM'),0::numeric,debt from entries where pending) m group by month) t),'[]'::jsonb),
 'daily',coalesce((select jsonb_agg(to_jsonb(t) order by t.date) from (select (paid_at at time zone 'Europe/Kyiv')::date as date,sum(amount) amount from entries where payout_status='paid' and paid_at>=now()-interval '365 days' group by 1) t),'[]'::jsonb),
 'contractors',coalesce((select jsonb_agg(to_jsonb(c) order by c.debt desc,c.contractor_name) from contractors c),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.rpv_finance_report(date,uuid,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.rpv_finance_report(date,uuid,uuid,text,integer,boolean) to service_role;
