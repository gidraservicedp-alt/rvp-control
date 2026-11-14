import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
export async function serviceDatabase() {
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table admin_users(user_id uuid primary key,role text,is_active boolean);
create table contractors(id uuid primary key,telegram_id bigint,status text,phone text);
create table rpv_customer_sites(id uuid primary key,site_key text,address text);
create table applications(id uuid primary key,application_number text,contractor_id uuid,title text,description text,address text,status text default 'new',contractor_stage text default 'offered',accepted_at timestamptz,departed_at timestamptz,updated_at timestamptz default now(),awaiting_act boolean default false,has_problem boolean default false,problem_comment text,actual_volume numeric,customer_site_id uuid,payout_amount numeric default 0,unit_price numeric default 0,payout_status text default 'pending',paid_at timestamptz,payout_receipt_file_id text,payout_receipt_type text,payout_receipt_name text,paid_by bigint);
create table acts(id uuid primary key,application_id uuid,contractor_id uuid,telegram_file_id text,file_type text,file_name text,status text,act_number text,act_date timestamptz,created_at timestamptz default now(),reviewed_at timestamptz);
create table act_files(id uuid primary key default gen_random_uuid(),act_id uuid,telegram_file_id text,file_type text,file_name text,created_at timestamptz default now());
create table work_history(id uuid primary key default gen_random_uuid(),application_id uuid references applications(id) on delete set null,contractor_id uuid not null references contractors(id) on delete cascade,title text not null,description text,completed_at timestamptz not null,created_at timestamptz not null default now());
create table rpv_customer_act_data(act_id uuid primary key,application_id uuid unique,site_id uuid,work_date date,pumped_m3 numeric);
create table rpv_portal_events(id bigint generated always as identity primary key,actor text,action text,application_id uuid,details jsonb);
create function rpv_customer_publish(p_act text,p_site text,p_date date,p_volume numeric) returns table(act_id uuid,site_id uuid,work_date date,pumped_m3 numeric,application_number text) language plpgsql set search_path='' as $$
declare v_act public.acts%rowtype;sid uuid;begin
 select * into v_act from public.acts where act_number=p_act and status='approved';
 select s.id into sid from public.rpv_customer_sites s join public.applications a on a.id=v_act.application_id where s.site_key=p_site and s.address=a.address;
 if sid is null then return;end if;
 insert into public.rpv_customer_act_data values(v_act.id,v_act.application_id,sid,p_date,p_volume) on conflict on constraint rpv_customer_act_data_pkey do nothing;
 return query select d.act_id,d.site_id,d.work_date,d.pumped_m3,a.application_number from public.rpv_customer_act_data d join public.applications a on a.id=d.application_id where d.act_id=v_act.id;end$$;
grant usage on schema public,auth to anon,authenticated,service_role;grant all on all tables in schema public to service_role;grant usage,select on all sequences in schema public to service_role;grant select,insert,update,delete on applications,acts,contractors to authenticated;grant select on admin_users to authenticated;`);
await db.exec(await fs.readFile(new URL('../../supabase/migrations/20261111110824_rpv_service_workflow.sql',import.meta.url),'utf8'));
await db.exec('create trigger rpv_sync_application_act_state after insert or update on acts for each row execute function rvp_sync_application_act_state()');
return db;
}
