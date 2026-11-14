-- One approved, published act per application; never join manager grants here.
create or replace view public.rpv_confirmed_volumes with (security_invoker=true) as
select d.act_id, d.application_id, d.site_id, d.work_date, d.pumped_m3
from public.rpv_customer_act_data d
join public.acts a on a.id=d.act_id and a.application_id=d.application_id and a.status='approved'
join public.applications p on p.id=d.application_id
join public.rpv_customer_sites s on s.id=d.site_id and s.merged_into is null;
revoke all on public.rpv_confirmed_volumes from public, anon, authenticated;
grant select on public.rpv_confirmed_volumes to service_role;

create or replace function public.rpv_customer_total(p_user bigint, p_month date)
returns numeric language sql stable security invoker set search_path='' as $$
  select coalesce(sum(v.pumped_m3),0)
  from public.rpv_confirmed_volumes v
  where v.work_date>=p_month and v.work_date<(p_month+interval '1 month')::date
    and v.work_date<=(now() at time zone 'Europe/Kyiv')::date
    and exists(select 1 from public.rpv_customer_visible_sites s where s.telegram_id=p_user and s.id=v.site_id);
$$;
revoke all on function public.rpv_customer_total(bigint,date) from public,anon,authenticated;
grant execute on function public.rpv_customer_total(bigint,date) to service_role;

create index if not exists rpv_customer_act_work_date on public.rpv_customer_act_data(work_date,site_id);

create or replace function public.rpv_office_volume_report(
  p_month date, p_network text default null, p_region text default null,
  p_site uuid default null, p_group text default 'network',
  p_offset integer default 0, p_export boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_today date := (now() at time zone 'Europe/Kyiv')::date; v_result jsonb;
begin
  if p_month is null or p_month<>date_trunc('month',p_month)::date
    or p_month<'2020-01-01'::date or p_month>date_trunc('month',v_today)::date
    or p_group is null or p_group not in ('network','region','site')
    or p_offset is null or p_offset<0 or p_export is null then
    raise exception 'Invalid report filters' using errcode='22023';
  end if;
  with registry as materialized (
    select s.id, s.label, coalesce(s.passport_azk_code,'') as code,
      coalesce(nullif(upper(btrim(s.passport_network)),''),'_unknown') as network,
      coalesce(substring(s.passport_city_code from '^UA[0-9]{2}'),'_unknown') as region
    from public.rpv_customer_sites s where s.merged_into is null
  ), selected as (
    select * from registry s where (p_network is null or s.network=p_network)
      and (p_region is null or s.region=p_region) and (p_site is null or s.id=p_site)
  ), per_site as materialized (
    select s.id,s.label,s.code,s.network,s.region,
      coalesce(sum(v.pumped_m3),0) as volume,count(v.act_id)::integer as acts
    from selected s left join public.rpv_confirmed_volumes v on v.site_id=s.id
      and v.work_date>=p_month and v.work_date<(p_month+interval '1 month')::date and v.work_date<=v_today
    group by s.id,s.label,s.code,s.network,s.region
  ), grouped as materialized (
    select case p_group when 'network' then s.network when 'region' then s.region else s.id::text end as key,
      case when p_group in ('network','site') then s.network end as network,
      case when p_group in ('region','site') then s.region end as region,
      case when p_group='site' then s.id end as site_id,
      case when p_group='site' then s.code end as code,
      case when p_group='site' then s.label end as label,
      sum(s.volume) as volume,sum(s.acts)::integer as acts,
      count(*) filter(where s.acts>0)::integer as sites
    from per_site s group by 1,2,3,4,5,6
  ), page_rows as (
    select * from grouped order by volume desc,key
    limit case when p_export then null else 50 end
    offset case when p_export then 0 else p_offset end
  )
  select jsonb_build_object(
    'month',to_char(p_month,'YYYY-MM'),'period_start',p_month,
    'period_end',least(v_today,(p_month+interval '1 month - 1 day')::date),
    'total',coalesce((select sum(volume) from per_site),0),
    'act_count',coalesce((select sum(acts) from per_site),0),
    'site_count',(select count(*) from per_site where acts>0),
    'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.volume desc,r.key) from page_rows r),'[]'::jsonb),
    'row_count',(select count(*) from grouped),
    'more',not p_export and (select count(*) from grouped)>p_offset+50,
    'networks',coalesce((select jsonb_agg(n.network order by n.network) from (select distinct network from registry) n),'[]'::jsonb),
    'regions',coalesce((select jsonb_agg(r.region order by r.region) from (select distinct region from registry where p_network is null or network=p_network) r),'[]'::jsonb),
    'sites',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'network',network,'region',region,'label',label) order by network,code,id)
      from registry where (p_network is null or network=p_network) and (p_region is null or region=p_region)),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.rpv_office_volume_report(date,text,text,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.rpv_office_volume_report(date,text,text,uuid,text,integer,boolean) to service_role;
