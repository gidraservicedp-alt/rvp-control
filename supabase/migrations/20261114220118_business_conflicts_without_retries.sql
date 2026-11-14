-- Business conflicts must not masquerade as serialization failures. PostgREST
-- 14.x can retry SQLSTATE 40001 indefinitely; PT409 returns one HTTP 409.
-- Keep the existing predicates, locks, ownership checks, signatures and grants.
-- Rebuild only the reviewed functions from their current definitions so earlier
-- volume, act, finance and owner-edit protections cannot be reverted by this fix.
do $migration$
declare
 signature text;
 function_id oid;
 definition text;
 corrected text;
begin
 foreach signature in array array[
  'public.gidra_internal_task_action(uuid,bigint,bigint,bigint,text,text,integer,bigint,boolean,text)',
  'public.rpv_finance_change(uuid,uuid,bigint,text,numeric,uuid)',
  'public.rpv_office_work_volume(uuid,uuid,timestamp with time zone,numeric)',
  'public.rpv_owner_order_edit(uuid,uuid,text,uuid,text,jsonb)',
  'public.rpv_register_primary_file(uuid)',
  'public.rpv_service_assign(uuid,uuid,uuid,timestamp with time zone)',
  'public.rpv_service_attach(bigint,uuid,uuid,text,text,text)',
  'public.rpv_service_report(bigint,uuid,timestamp with time zone,date,numeric,text)',
  'public.rpv_service_review(text,uuid,text,text)',
  'public.rpv_service_transition(bigint,uuid,text,timestamp with time zone,text)'
 ] loop
  function_id := pg_catalog.to_regprocedure(signature);
  -- Supports older installations where an optional workflow is not installed.
  if function_id is null then continue; end if;
  definition := pg_catalog.pg_get_functiondef(function_id);
  corrected := pg_catalog.regexp_replace(definition,
   $pattern$(errcode[[:space:]]*=[[:space:]]*)'40001'$pattern$,
   $replacement$\1'PT409'$replacement$, 'gi');
  if corrected <> definition then execute corrected; end if;
 end loop;
end
$migration$;
