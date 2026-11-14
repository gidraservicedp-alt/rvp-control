-- The office form selects an existing canonical passport. Identity is copied
-- under a row lock, never accepted as free text from the browser.
create function public.rpv_office_create_application(
 p_actor uuid, p_site uuid, p_request uuid, p_work text, p_date date,
 p_contractor uuid, p_comment text, p_payout numeric
)
returns table(id uuid, application_number text, created boolean)
language plpgsql security invoker set search_path = '' as $$
declare
 v_role text;
 s public.rpv_customer_sites%rowtype;
 a public.applications%rowtype;
 v_work text := btrim(p_work);
 v_comment text := btrim(coalesce(p_comment, ''));
 v_input jsonb;
begin
 select role into v_role from public.admin_users
 where user_id = p_actor and is_active for share;
 if v_role is null or v_role not in ('owner', 'admin', 'dispatcher') then
  raise exception 'Недостатньо прав для створення заявки.' using errcode = '42501';
 end if;
 if p_site is null or p_request is null or p_contractor is null or p_date is null
    or v_work is null or char_length(v_work) not between 1 and 2000
    or char_length(v_comment) > 2000 or p_payout is null
    or p_payout < 0 or p_payout >= 100000000 or p_payout <> round(p_payout, 2) then
  raise exception 'Оберіть паспорт, виконавця, дату та заповніть опис робіт.' using errcode = 'P2001';
 end if;
 if v_role = 'dispatcher' and p_payout <> 0 then
  raise exception 'Суму виплати встановлює адміністратор або бухгалтер.' using errcode = '42501';
 end if;
 v_input := jsonb_build_object('site', p_site, 'contractor', p_contractor,
   'work', v_work, 'date', p_date, 'comment', v_comment, 'payout', p_payout);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rpv-create-request:' || p_request::text, 0));
 select * into a from public.applications where applications.id = p_request;
 if found then
  if not exists (select 1 from public.rpv_portal_events e
    where e.application_id = p_request and e.action = 'office_create'
      and e.actor = p_actor::text and e.details = v_input) then
   raise exception 'Цю заявку вже збережено з іншими даними. Оновіть список заявок.' using errcode = 'P2002';
  end if;
  return query select a.id, a.application_number, false;
  return;
 end if;
 select * into s from public.rpv_customer_sites where rpv_customer_sites.id = p_site for share;
 if not found or s.merged_into is not null then
  raise exception 'Паспорт змінено або об’єднано. Оновіть список і виберіть АЗК знову.' using errcode = 'P2002';
 end if;
 if nullif(btrim(s.label), '') is null or nullif(btrim(s.address), '') is null
    or nullif(btrim(s.passport_network), '') is null or nullif(btrim(s.passport_azk_code), '') is null then
  raise exception 'Заповніть назву, мережу, код АЗК та адресу в паспорті об’єкта.' using errcode = 'P2001';
 end if;
 perform c.id from public.contractors c where c.id = p_contractor
   and c.status = 'active' and c.telegram_id is not null for share;
 if not found then
  raise exception 'Оберіть активного виконавця, який зареєстрований у боті.' using errcode = 'P2002';
 end if;
 -- Office may record earlier work; retain that existing capability.
 if p_date < date '2000-01-01' or p_date > date '2100-12-31' then
  raise exception 'Перевірте дату заявки.' using errcode = 'P2001';
 end if;
 insert into public.applications (
   id, application_number, title, description, address, azk_code, customer_site_id,
   status, contractor_stage, contractor_id, scheduled_at, deadline_at,
   order_date_text, manager_comment, payout_amount, payout_status, request_source
 ) values (
   p_request, 'G-' || upper(substr(replace(p_request::text, '-', ''), 1, 12)),
   s.label, v_work, s.address, s.passport_azk_code, s.id,
   'assigned', 'offered', p_contractor, p_date::timestamp at time zone 'Europe/Kyiv',
   ((p_date + 1)::timestamp at time zone 'Europe/Kyiv') - interval '1 second',
   to_char(now() at time zone 'Europe/Kyiv', 'YYYY-MM-DD'), nullif(v_comment, ''), p_payout, 'pending', 'admin'
 ) returning * into a;
 insert into public.rpv_portal_events(actor, action, application_id, details)
 values (p_actor::text, 'office_create', a.id, v_input);
 return query select a.id, a.application_number, true;
end $$;
revoke all on function public.rpv_office_create_application(uuid,uuid,uuid,text,date,uuid,text,numeric) from public, anon, authenticated;
grant execute on function public.rpv_office_create_application(uuid,uuid,uuid,text,date,uuid,text,numeric) to service_role;
