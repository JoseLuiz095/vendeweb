-- shared_future / printing3d. Additive evolution; review and test before deployment.
begin;
alter table public.food_print_jobs
  add column classification text not null default 'unclassified' check(classification in ('unclassified','catalog','custom','private')),
  add column product_id uuid,
  add column source_fingerprint text,
  add column imported_metadata jsonb,
  add constraint food_print_product_tenant foreign key(product_id,store_id) references public.food_products(id,store_id),
  add constraint food_print_private_no_sale check(classification<>'private' or (request_id is null and order_id is null and agreed_total_cents is null)),
  add constraint food_print_catalog_product check((classification='catalog')=(product_id is not null)),
  add constraint food_print_import_shape check(source_fingerprint is null or source_fingerprint ~ '^[a-f0-9]{64}:[A-Za-z0-9_-]{1,50}$');
create unique index food_print_import_once on public.food_print_jobs(store_id,source_fingerprint) where source_fingerprint is not null;
alter table public.food_print_records add column material_cost_cents bigint;
alter table public.food_module_settings add column print_cost_defaults jsonb;

create function food_modules_private.print_cost(p_cost jsonb,p_urgency integer default 0) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text; val numeric; fees numeric; margin numeric; base numeric; suggested numeric;
begin
 if jsonb_typeof(p_cost) is distinct from 'object' then raise exception 'Custos inválidos.'; end if;
 for k,val in select key,value::numeric from jsonb_each_text(p_cost) loop
   if k not in ('grams','cents_per_gram','watts','energy_cents_kwh','hours','machine_cents_hour','labor_cents','finishing_cents','margin_bps','loss_bps','packaging_cents','other_cents','fixed_fee_cents','payment_fee_bps','tax_bps','base_cents','suggested_cents','urgency_bps')
     or val is null or val::text in ('NaN','Infinity','-Infinity') or val<0 or val>100000000 then raise exception 'Custo inválido.'; end if;
 end loop;
 fees:=coalesce((p_cost->>'payment_fee_bps')::numeric,0)+coalesce((p_cost->>'tax_bps')::numeric,0);
 margin:=coalesce((p_cost->>'margin_bps')::numeric,0);
 if margin+fees>=10000 or coalesce((p_cost->>'loss_bps')::numeric,0)>10000 or p_urgency not between 0 and 10000 then raise exception 'Revise margem, taxas e perdas.'; end if;
 base:=round((coalesce((p_cost->>'grams')::numeric,0)*coalesce((p_cost->>'cents_per_gram')::numeric,0)
   +coalesce((p_cost->>'hours')::numeric,0)*(coalesce((p_cost->>'watts')::numeric,0)/1000*coalesce((p_cost->>'energy_cents_kwh')::numeric,0)+coalesce((p_cost->>'machine_cents_hour')::numeric,0)))
   *(1+coalesce((p_cost->>'loss_bps')::numeric,0)/10000)
   +coalesce((p_cost->>'labor_cents')::numeric,0)+coalesce((p_cost->>'finishing_cents')::numeric,0)
   +coalesce((p_cost->>'packaging_cents')::numeric,0)+coalesce((p_cost->>'other_cents')::numeric,0)+coalesce((p_cost->>'fixed_fee_cents')::numeric,0));
 suggested:=round(base*10000/(10000-margin-fees)*(10000+p_urgency)/10000);
 if suggested>9007199254740991 then raise exception 'Preço excede o limite.'; end if;
 return (p_cost-'base_cents'-'suggested_cents'-'urgency_bps')||jsonb_build_object('base_cents',base,'suggested_cents',suggested,'urgency_bps',p_urgency);
end $$;
revoke all on function food_modules_private.print_cost(jsonb,integer) from public,anon,authenticated;

-- Preserve the mature stock transaction and its guards. Every command still passes
-- the original authorization, row revisions and idempotency checks.
alter function food_modules_private.print_command(uuid,text,jsonb,uuid) rename to print_command_base_20261127;
revoke all on function food_modules_private.print_command_base_20261127(uuid,text,jsonb,uuid) from public,anon,authenticated;
-- Existing job preparation had an ambiguous local-variable/column reference.
-- Patch only the reviewed expression; fail closed if the installed body differs.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('food_modules_private.print_command_base_20261127(uuid,text,jsonb,uuid)'::regprocedure);
 if position('plan=plan,' in definition)=0 then raise exception 'Corpo da rotina de produção diverge da base revisada. Compare antes de aplicar.'; end if;
 definition:=regexp_replace(definition,'\mdeclare\M','<<printing_legacy>>'||chr(10)||'declare','i');
 execute replace(definition,'plan=plan,','plan=printing_legacy.plan,');
end $$;
create function food_modules_private.print_command(p_store uuid,p_action text,p_data jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; j public.food_print_jobs%rowtype; op food_modules_private.print_operations%rowtype;
 result jsonb; obj uuid; kind text; product uuid; fingerprint text; metadata jsonb; costs jsonb; urgency integer; amount bigint; had_job boolean;
begin
 select organization_id into org from public.food_module_stores where store_id=p_store;
 if auth.uid() is null or org is null or not food_modules_private.food_modules_access(org,p_store,true)
   or not public.food_is_store_admin(p_store) or not food_modules_private.food_modules_enabled(p_store,'custom')
   or not exists(select 1 from public.food_business_profiles where store_id=p_store and primary_segment='printing3d') then
   raise exception 'Sem acesso à produção 3D desta loja.' using errcode='42501'; end if;
 if p_key is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Dados inválidos.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('printing3d:'||p_store::text,0));
 select * into op from food_modules_private.print_operations where store_id=p_store and key=p_key;
 if found then
   if op.action is distinct from p_action or op.payload_hash is distinct from md5(p_data::text) then raise exception 'Identificador já utilizado para outra operação.' using errcode='23505'; end if;
   return op.result||jsonb_build_object('duplicate',true);
 end if;
 if p_action='cost_defaults' then
   costs:=food_modules_private.print_cost(p_data->'costs',0);
   update public.food_module_settings set print_cost_defaults=costs-'base_cents'-'suggested_cents'-'urgency_bps' where store_id=p_store;
   perform food_modules_private.food_modules_audit(p_store,'printing3d.cost_defaults',p_store);
   result:=jsonb_build_object('id',p_store);
   insert into food_modules_private.print_operations values(p_store,p_key,p_action,md5(p_data::text),result);
   return result;
 end if;
 if p_action='quote_save' then
   had_job:=exists(select 1 from public.food_print_jobs where request_id=nullif(p_data->>'id','')::uuid and store_id=p_store and retry_of is null);
 end if;
 if p_action='repeat' then
   select * into j from public.food_print_jobs where id=(p_data->>'id')::uuid and store_id=p_store for update;
   if not found or j.status<>'completed' or j.revision is distinct from (p_data->>'revision')::integer then raise exception 'Atualize a impressão concluída antes de reimprimir.'; end if;
   if exists(select 1 from public.food_print_jobs where retry_of=j.id and status in ('waiting','printing')) then raise exception 'Já existe uma reimpressão deste trabalho aguardando ou em andamento.'; end if;
   perform food_modules_private.print_check_order(p_store,j.order_id);
   insert into public.food_print_jobs(store_id,organization_id,request_id,order_id,retry_of,description,quantity,plan,quote_snapshot,agreed_total_cents,classification,product_id,imported_metadata,created_by)
     values(p_store,org,j.request_id,j.order_id,j.id,j.description,j.quantity,j.plan,j.quote_snapshot,j.agreed_total_cents,j.classification,j.product_id,j.imported_metadata,auth.uid()) returning id into obj;
   result:=jsonb_build_object('id',obj);
   insert into food_modules_private.print_operations values(p_store,p_key,p_action,md5(p_data::text),result);
   perform food_modules_private.food_modules_audit(p_store,'printing3d.repeat',obj,jsonb_build_object('original_job',j.id));
   return result;
 end if;
 if p_action in ('job_save','job_classify') then
   obj:=nullif(p_data->>'id','')::uuid;
   if obj is not null then
     select * into j from public.food_print_jobs where id=obj and store_id=p_store for update;
     if not found or j.revision is distinct from (p_data->>'revision')::integer then raise exception 'Impressão alterada. Atualize a lista.'; end if;
   end if;
   kind:=coalesce(p_data->>'classification',j.classification,'unclassified');
   product:=case when kind='catalog' then nullif(p_data->>'product_id','')::uuid else null end;
   if kind not in ('unclassified','catalog','custom','private') or kind='catalog' and product is null then raise exception 'Revise finalidade e produto.'; end if;
   if product is not null and not exists(select 1 from public.food_products where id=product and store_id=p_store) then raise exception 'Produto de outra loja ou indisponível.'; end if;
   if product is not null and exists(select 1 from public.food_product_recipes where product_id=product and store_id=p_store and active) then raise exception 'Este produto usa baixa por ficha técnica. Revise essa automação antes de associar uma produção com consumo próprio, para evitar débito duplicado.'; end if;
   if kind='private' and (j.request_id is not null or nullif(p_data->>'order_id','') is not null or (p_action='job_classify' and j.order_id is not null)) then raise exception 'Impressão vinculada a venda/orçamento não pode ser privada.'; end if;
   if p_action='job_classify' then
     if obj is null or length(trim(coalesce(p_data->>'reason','')))<3 then raise exception 'Informe impressão e motivo da alteração.'; end if;
     update public.food_print_jobs set classification=kind,product_id=product,agreed_total_cents=case when kind='private' then null else agreed_total_cents end,revision=revision+1 where id=obj;
     perform food_modules_private.food_modules_audit(p_store,'printing3d.classify',obj,jsonb_build_object('before',jsonb_build_object('classification',j.classification,'product_id',j.product_id),'after',jsonb_build_object('classification',kind,'product_id',product),'reason',left(trim(p_data->>'reason'),500)));
     result:=jsonb_build_object('id',obj);
     insert into food_modules_private.print_operations values(p_store,p_key,p_action,md5(p_data::text),result);
     return result;
   end if;
   fingerprint:=coalesce(nullif(p_data->>'source_fingerprint',''),j.source_fingerprint);
   metadata:=coalesce(nullif(p_data->'imported_metadata','null'),j.imported_metadata);
   if metadata is not null and (jsonb_typeof(metadata) is distinct from 'object' or octet_length(metadata::text)>16000
     or coalesce(metadata->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(metadata->>'plate','') !~ '^[A-Za-z0-9_-]{1,50}$') then raise exception 'Metadados de importação inválidos.'; end if;
   if fingerprint is not null then
     if fingerprint !~ '^[a-f0-9]{64}:[A-Za-z0-9_-]{1,50}$' or jsonb_typeof(metadata) is distinct from 'object' or octet_length(metadata::text)>16000
       or fingerprint is distinct from (metadata->>'sha256')||':'||(metadata->>'plate') then raise exception 'Referência de importação inválida.'; end if;
     if exists(select 1 from public.food_print_jobs where store_id=p_store and source_fingerprint=fingerprint and id is distinct from obj) then
       raise exception 'Este arquivo e mesa já foram importados. Abra o trabalho existente; para repetir a produção, crie uma nova tentativa ou impressão avulsa.' using errcode='23505';
     end if;
   end if;
 end if;
 -- Legacy routine records the exact original payload hash; no changed retry payload.
 result:=food_modules_private.print_command_base_20261127(p_store,p_action,p_data,p_key);
 obj:=(result->>'id')::uuid;
 if p_action='job_save' then
   if jsonb_typeof(p_data->'quote')='object' then costs:=food_modules_private.print_cost(p_data->'quote',0); end if;
   amount:=nullif(p_data->>'agreed_total_cents','')::bigint;
   if amount<0 or amount>9007199254740991 then raise exception 'Preço inválido.'; end if;
   update public.food_print_jobs set classification=kind,product_id=product,source_fingerprint=fingerprint,imported_metadata=metadata,
     quote_snapshot=coalesce(costs,quote_snapshot),agreed_total_cents=case when kind='private' then null when p_data?'agreed_total_cents' then amount else agreed_total_cents end where id=obj;
 elsif p_action='retry' then
   update public.food_print_jobs n set classification=o.classification,product_id=o.product_id,imported_metadata=o.imported_metadata
     from public.food_print_jobs o where n.id=obj and o.id=n.retry_of;
 elsif p_action='quote_save' then
   if jsonb_typeof(p_data->'quote')='object' then
     select case when coalesce((p_data->>'urgent')::boolean,false) then urgency_bps else 0 end into urgency from public.food_module_settings where store_id=p_store;
     costs:=food_modules_private.print_cost(p_data->'quote',urgency);
     update public.food_custom_requests set quote=costs where id=obj and store_id=p_store;
   end if;
   -- Newly approved work only; never replace the original quote on an existing job.
   if not had_job then update public.food_print_jobs set quote_snapshot=coalesce(costs,quote_snapshot),classification='custom' where request_id=obj and retry_of is null; end if;
 elsif p_action in ('finish','correct') then
   update public.food_print_records r set material_cost_cents=(select round(-coalesce(sum(m.total_cost),0)*100) from public.food_inventory_movements m where m.store_id=p_store and m.source_type='printing3d' and m.source_reference=obj::text)
     where r.job_id=obj and r.revision=(select revision from public.food_print_jobs where id=obj);
 end if;
 return result;
end $$;
-- Handle preferences separately without broadening the legacy routine.
create or replace function public.food_printing3d_command_v1(p_store uuid,p_action text,p_data jsonb,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin return food_modules_private.print_command(p_store,p_action,p_data,p_key); end $$;
revoke all on function food_modules_private.print_command(uuid,text,jsonb,uuid) from public,anon;
grant execute on function food_modules_private.print_command(uuid,text,jsonb,uuid) to authenticated;

-- Public customers receive only a scoped, expiring upload capability. No public
-- SELECT/INSERT policies and no customer data or capability hashes in analytics.
create function public.food_printing3d_public_available_v1(p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(food_modules_private.food_modules_enabled(p_store,'custom'),false) and exists(select 1 from public.food_business_profiles where store_id=p_store and primary_segment='printing3d')
$$;
revoke all on function public.food_printing3d_public_available_v1(uuid) from public,anon,authenticated;
grant execute on function public.food_printing3d_public_available_v1(uuid) to service_role;
create table food_modules_private.print_public_capabilities (
 store_id uuid not null references public.food_stores(id), request_id uuid not null primary key,
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'), payload_hash text not null,
 expires_at timestamptz not null default now()+interval '24 hours',
 foreign key(request_id) references public.food_custom_requests(id)
);
alter table food_modules_private.print_public_capabilities enable row level security;
revoke all on food_modules_private.print_public_capabilities from public,anon,authenticated;
create function public.food_printing3d_public_v1(p_store uuid,p_action text,p_data jsonb,p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; r public.food_custom_requests%rowtype; cap food_modules_private.print_public_capabilities%rowtype; obj uuid; filepath text;
begin
 select organization_id into org from public.food_module_stores where store_id=p_store;
 if org is null or not food_modules_private.food_modules_enabled(p_store,'custom') or not exists(select 1 from public.food_business_profiles where store_id=p_store and primary_segment='printing3d') then raise exception 'Solicitações indisponíveis nesta loja.'; end if;
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Solicitação inválida.'; end if;
 obj:=(p_data->>'request_id')::uuid;
 if obj is null then raise exception 'Solicitação inválida.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('print-public:'||obj::text,0));
 select * into cap from food_modules_private.print_public_capabilities where request_id=obj and store_id=p_store;
 if p_action='create' then
   if cap.request_id is not null then
     if cap.token_hash is distinct from p_token_hash or cap.payload_hash is distinct from md5(p_data::text) then raise exception 'Solicitação indisponível.' using errcode='42501'; end if;
     return jsonb_build_object('id',obj,'duplicate',true);
   end if;
   if length(trim(coalesce(p_data->>'customer_name',''))) not between 2 and 120 or coalesce(p_data->>'customer_phone','') !~ '^[0-9+ ()-]{10,25}$'
     or length(regexp_replace(coalesce(p_data->>'customer_phone',''),'[^0-9]','','g')) not between 10 and 15
     or length(trim(coalesce(p_data->>'description',''))) not between 5 and 2000 or (p_data->>'quantity')::integer not between 1 and 100000
     or (p_data->>'due_at')::timestamptz < now() then raise exception 'Revise contato, descrição, quantidade e prazo.'; end if;
   insert into public.food_custom_requests(id,organization_id,store_id,customer_name,customer_phone,quantity,size,material,color,due_at,notes,status)
     values(obj,org,p_store,trim(p_data->>'customer_name'),trim(p_data->>'customer_phone'),(p_data->>'quantity')::integer,left(coalesce(p_data->>'size','A definir'),200),left(coalesce(p_data->>'material','A definir'),100),left(coalesce(p_data->>'color','A definir'),100),(p_data->>'due_at')::timestamptz,trim(p_data->>'description'),'quote');
   insert into food_modules_private.print_public_capabilities(store_id,request_id,token_hash,payload_hash) values(p_store,obj,p_token_hash,md5(p_data::text));
   return jsonb_build_object('id',obj);
 end if;
 if cap.request_id is null or cap.token_hash is distinct from p_token_hash or cap.expires_at<now() then raise exception 'Solicitação indisponível ou envio expirado.' using errcode='42501'; end if;
 select * into strict r from public.food_custom_requests where id=obj and store_id=p_store;
 if p_action='authorize_upload' then
   return jsonb_build_object('prefix',org::text||'/'||p_store::text||'/'||obj::text||'/');
 elsif p_action='file_register' then
   filepath:=p_data->>'storage_path';
   if filepath is null or not starts_with(filepath,org::text||'/'||p_store::text||'/'||obj::text||'/') or filepath !~ '/[a-f0-9]{64}\.(png|jpg|jpeg|webp|stl|obj|3mf|pdf)$'
     or filepath like '%..%' or (p_data->>'size_bytes')::integer not between 1 and 26214400
     or not exists(select 1 from storage.objects where bucket_id='food-custom-files' and name=filepath) then raise exception 'Arquivo inválido.'; end if;
   if exists(select 1 from public.food_custom_files where storage_path=filepath) then return jsonb_build_object('id',obj,'duplicate',true); end if;
   if (select count(*) from public.food_custom_files where request_id=obj)>=5 then raise exception 'Até cinco arquivos por solicitação.'; end if;
   insert into public.food_custom_files(request_id,organization_id,store_id,storage_path,name,size_bytes) values(obj,org,p_store,filepath,left(p_data->>'name',200),(p_data->>'size_bytes')::integer);
   return jsonb_build_object('id',obj);
 else raise exception 'Ação inválida.'; end if;
end $$;
revoke all on function public.food_printing3d_public_v1(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.food_printing3d_public_v1(uuid,text,jsonb,text) to service_role;
commit;
