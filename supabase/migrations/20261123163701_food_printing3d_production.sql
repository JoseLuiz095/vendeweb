-- printing3d: produção consome o estoque existente, sem reserva nem baixa na aprovação.
begin;
alter table public.food_custom_requests add column print_plan jsonb;
alter table public.food_inventory_purchases add column print_procurement_stage text
  check (print_procurement_stage in ('planned','ordered'));

create table public.food_print_jobs (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.food_stores(id),
  organization_id uuid not null, request_id uuid, order_id uuid, retry_of uuid,
  description text not null check(length(trim(description)) between 1 and 300),
  quantity integer not null check(quantity between 1 and 100000),
  plan jsonb not null check(jsonb_typeof(plan)='object'),
  quote_snapshot jsonb, agreed_total_cents bigint,
  status text not null default 'waiting' check(status in ('waiting','printing','completed','interrupted')),
  revision integer not null default 0, created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz, created_by uuid not null references auth.users(id),
  unique(id,store_id),
  foreign key(organization_id,store_id) references public.food_module_stores(organization_id,store_id),
  foreign key(request_id,organization_id,store_id) references public.food_custom_requests(id,organization_id,store_id),
  foreign key(order_id,store_id) references public.food_orders(id,store_id),
  foreign key(retry_of,store_id) references public.food_print_jobs(id,store_id)
);
create unique index food_print_jobs_initial_quote on public.food_print_jobs(request_id) where request_id is not null and retry_of is null;
create index food_print_jobs_store_status on public.food_print_jobs(store_id,status,created_at desc);
create index food_print_jobs_order on public.food_print_jobs(order_id) where order_id is not null;
create table public.food_print_records (
  id uuid primary key default gen_random_uuid(), store_id uuid not null, job_id uuid not null,
  revision integer not null, kind text not null check(kind in ('finish','correction')),
  outcome text not null check(outcome in ('completed','interrupted')),
  pieces integer not null check(pieces between 0 and 100000), hours numeric not null check(hours>=0 and hours<=1000000),
  materials jsonb not null check(jsonb_typeof(materials)='array'),
  reason text not null default '', created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  foreign key(job_id,store_id) references public.food_print_jobs(id,store_id), unique(job_id,revision)
);
create index food_print_records_store_job on public.food_print_records(store_id,job_id,revision desc);
create table food_modules_private.print_operations (
  store_id uuid not null references public.food_stores(id), key uuid not null, action text not null,
  payload_hash text not null, result jsonb not null, primary key(store_id,key)
);
alter table food_modules_private.print_operations enable row level security;
revoke all on food_modules_private.print_operations from public,anon,authenticated;
alter table public.food_print_jobs enable row level security;
alter table public.food_print_records enable row level security;
revoke all on public.food_print_jobs,public.food_print_records from public,anon,authenticated;
grant select on public.food_print_jobs,public.food_print_records to authenticated;
create policy food_print_jobs_read on public.food_print_jobs for select to authenticated
  using(food_modules_private.food_modules_access(organization_id,store_id));
create policy food_print_records_read on public.food_print_records for select to authenticated
  using(exists(select 1 from public.food_print_jobs j where j.id=job_id and j.store_id=food_print_records.store_id));

-- Sem conversão massa/volume. Rejeita perda de precisão na unidade do estoque (3 casas).
create function food_modules_private.print_quantity(p_quantity numeric,p_from text,p_to text) returns numeric
language plpgsql immutable set search_path='' as $$
declare v numeric;
begin
  if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<0 or p_quantity>100000000 then
    raise exception 'Quantidade de material inválida.' using errcode='22023'; end if;
  v:=p_quantity * case when p_from=p_to and p_from in ('g','kg','ml','l','un','pack') then 1
    when p_from='g' and p_to='kg' then 0.001 when p_from='kg' and p_to='g' then 1000
    when p_from='ml' and p_to='l' then 0.001 when p_from='l' and p_to='ml' then 1000 else null end;
  if v is null then raise exception 'Unidades incompatíveis. Resina exige quantidade na mesma dimensão do estoque.' using errcode='22023'; end if;
  if round(v,3)<>v then raise exception 'Quantidade perderia precisão na unidade do estoque. Revise a unidade ou o valor.' using errcode='22023'; end if;
  return v;
end $$;

create function food_modules_private.print_plan(p_store uuid,p_plan jsonb,p_quantity integer) returns jsonb
language plpgsql set search_path='' as $$
declare l jsonb; i public.food_inventory_items%rowtype; q numeric; h numeric; seen uuid[]:='{}';
begin
  if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_quantity is null or p_quantity not between 1 and 100000
    or jsonb_typeof(p_plan->'materials') is distinct from 'array' then raise exception 'Revise o plano da impressão.'; end if;
  if jsonb_array_length(p_plan->'materials')>30 then raise exception 'Use até 30 materiais por impressão.'; end if;
  h:=(p_plan->>'hours')::numeric;
  if h is null or h::text in ('NaN','Infinity','-Infinity') or h<0 or h>1000000 or coalesce(p_plan->>'time_basis','') not in ('piece','batch') then raise exception 'Tempo previsto inválido.'; end if;
  for l in select value from jsonb_array_elements(p_plan->'materials') loop
    if coalesce(l->>'basis','') not in ('piece','batch') then raise exception 'Informe se o material é por peça ou por lote.'; end if;
    q:=(l->>'quantity')::numeric;
    -- Material ainda não associado fica como pendência, sem impedir aceitar o orçamento.
    if nullif(l->>'inventory_item_id','') is null then
      perform food_modules_private.print_quantity(q,l->>'unit',l->>'unit');
    else
      select * into i from public.food_inventory_items where id=(l->>'inventory_item_id')::uuid and store_id=p_store;
      if not found or not i.active or i.id=any(seen) then raise exception 'Material repetido, inativo ou de outra loja.'; end if;
      seen:=array_append(seen,i.id);
      perform food_modules_private.print_quantity(q*case when l->>'basis'='piece' then p_quantity else 1 end,l->>'unit',i.unit);
    end if;
  end loop;
  return jsonb_build_object('materials',p_plan->'materials','hours',h,'time_basis',p_plan->>'time_basis');
end $$;

create function food_modules_private.print_check_order(p_store uuid,p_order uuid) returns void
language plpgsql set search_path='' as $$
begin
  if p_order is null then return; end if;
  perform 1 from public.food_orders where id=p_order and store_id=p_store for update;
  if not found then raise exception 'Pedido não encontrado nesta loja.'; end if;
  if exists(select 1 from public.food_order_items oi join public.food_product_recipes r on r.product_id=oi.product_id and r.store_id=p_store and r.active where oi.order_id=p_order)
     or exists(select 1 from public.food_inventory_order_consumptions where order_id=p_order) then
    raise exception 'Este pedido usa baixa por ficha técnica. Não vincule à produção 3D para evitar consumo duplicado. Use um pedido sem essa automação.';
  end if;
end $$;

-- Se uma ficha for adicionada depois do vínculo, impede a segunda baixa, inclusive por reposição.
create function food_modules_private.print_guard_recipe() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.source_type='order_recipe' and exists(select 1 from public.food_print_jobs j
    where j.store_id=new.store_id and j.order_id::text=new.source_reference) then
    raise exception 'Pedido vinculado à produção 3D: registre o consumo na impressão, sem ficha técnica automática.';
  end if;
  return new;
end $$;
create trigger food_print_guard_recipe before insert on public.food_inventory_movements for each row execute function food_modules_private.print_guard_recipe();

create function food_modules_private.print_guard_purchase() returns trigger
language plpgsql set search_path='' as $$
declare managed boolean;
begin
  if tg_table_name='food_inventory_purchases' then
    managed:=case when tg_op='DELETE' then old.print_procurement_stage is not null
      when tg_op='INSERT' then new.print_procurement_stage is not null
      else old.print_procurement_stage is not null or new.print_procurement_stage is not null end;
  else
    select p.print_procurement_stage is not null into managed from public.food_inventory_purchases p
      where p.id=case when tg_op='DELETE' then old.purchase_id else new.purchase_id end;
    if tg_op='UPDATE' and not coalesce(managed,false) then
      select p.print_procurement_stage is not null into managed from public.food_inventory_purchases p where p.id=old.purchase_id;
    end if;
  end if;
  if managed and current_user in ('authenticated','anon') and coalesce(current_setting('foodweb.print_purchase_write',true),'')<>'on' then raise exception 'Use o recebimento da produção 3D para alterar esta compra.'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger food_print_purchase_guard before insert or update or delete on public.food_inventory_purchases for each row execute function food_modules_private.print_guard_purchase();
create trigger food_print_purchase_item_guard before insert or update or delete on public.food_inventory_purchase_items for each row execute function food_modules_private.print_guard_purchase();

-- Histórico vinculado é alterado somente por funções privilegiadas (ex.: conversão oficial de unidade).
create function food_modules_private.print_guard_movement() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.source_type='printing3d' and current_user in ('authenticated','anon') then raise exception 'Confirme o consumo pela impressão.'; end if;
    return new;
  end if;
  if old.source_type='printing3d' and current_user in ('authenticated','anon') then raise exception 'Corrija o consumo pela impressão, preservando o lançamento original.'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger food_print_movement_history before insert or update or delete on public.food_inventory_movements for each row execute function food_modules_private.print_guard_movement();

create function food_modules_private.print_command(p_store uuid,p_action text,p_data jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  org uuid; op food_modules_private.print_operations%rowtype; j public.food_print_jobs%rowtype;
  prior public.food_print_records%rowtype; purchase public.food_inventory_purchases%rowtype;
  custom public.food_custom_requests%rowtype; i public.food_inventory_items%rowtype;
  plan jsonb; result jsonb; obj uuid; link uuid; l jsonb; oldline jsonb; lines jsonb:='[]';
  q numeric; before_q numeric; delta numeric; after_q numeric; cost numeric; total numeric:=0;
  amount numeric; old_amount numeric; h numeric; pieces integer; qty integer; rev integer; outcome text;
  seen uuid[]:='{}'; rec uuid:=gen_random_uuid(); source text; reason text; material_id uuid;
  previous_mutation text:=coalesce(current_setting('foodweb.inventory_mutation',true),'');
  previous_reconcile text:=coalesce(current_setting('foodweb.recipe_reconcile',true),'');
  previous_purchase text:=coalesce(current_setting('foodweb.print_purchase_write',true),'');
begin
  select organization_id into org from public.food_module_stores where store_id=p_store;
  if auth.uid() is null or org is null or not food_modules_private.food_modules_access(org,p_store,true)
    or not public.food_is_store_admin(p_store)
    or not exists(select 1 from public.food_business_profiles where store_id=p_store and primary_segment='printing3d')
    or not food_modules_private.food_modules_enabled(p_store,'custom') then
    raise exception 'Sem acesso à produção 3D desta loja.' using errcode='42501'; end if;
  if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Identificador ou dados da operação inválidos.'; end if;
  -- Serializa comandos da loja; locks dos insumos também protegem contra outras rotas de estoque.
  perform pg_advisory_xact_lock(hashtextextended('printing3d:'||p_store::text,0));
  select * into op from food_modules_private.print_operations where store_id=p_store and key=p_key;
  if found then
    if op.action is distinct from p_action or op.payload_hash is distinct from md5(p_data::text) then raise exception 'Identificador já utilizado para outra operação.' using errcode='23505'; end if;
    return op.result||jsonb_build_object('duplicate',true);
  end if;

  if p_action='quote_save' then
    result:=public.food_modules_command(p_store,'custom_save',p_data-'print_plan'-'order_id'-'description');
    obj:=(result->>'id')::uuid;
    select * into strict custom from public.food_custom_requests where id=obj and store_id=p_store for update;
    plan:=food_modules_private.print_plan(p_store,p_data->'print_plan',custom.quantity);
    update public.food_custom_requests set print_plan=plan where id=obj;
    if custom.status='approved' and not exists(select 1 from public.food_print_jobs where request_id=obj and retry_of is null) then
      link:=nullif(p_data->>'order_id','')::uuid;
      perform food_modules_private.print_check_order(p_store,link);
      insert into public.food_print_jobs(store_id,organization_id,request_id,order_id,description,quantity,plan,quote_snapshot,agreed_total_cents,created_by)
        values(p_store,org,obj,link,coalesce(nullif(trim(p_data->>'description'),''),'Impressão '||custom.material||' · '||custom.size),custom.quantity,plan,custom.quote,custom.final_cents*custom.quantity,auth.uid());
    end if;
  elsif p_action in ('job_save','retry') then
    obj:=nullif(p_data->>'id','')::uuid;
    if p_action='retry' then
      select * into j from public.food_print_jobs where id=obj and store_id=p_store for update;
      if not found or j.status<>'interrupted' then raise exception 'Nova tentativa exige uma impressão interrompida.'; end if;
      perform food_modules_private.print_check_order(p_store,j.order_id);
      insert into public.food_print_jobs(store_id,organization_id,request_id,order_id,retry_of,description,quantity,plan,quote_snapshot,agreed_total_cents,created_by)
        values(p_store,org,j.request_id,j.order_id,j.id,j.description,j.quantity,j.plan,j.quote_snapshot,j.agreed_total_cents,auth.uid()) returning id into obj;
    else
      qty:=(p_data->>'quantity')::integer;
      plan:=food_modules_private.print_plan(p_store,p_data->'plan',qty);
      link:=nullif(p_data->>'order_id','')::uuid;
      perform food_modules_private.print_check_order(p_store,link);
      if obj is null then
        insert into public.food_print_jobs(store_id,organization_id,order_id,description,quantity,plan,created_by)
          values(p_store,org,link,trim(p_data->>'description'),qty,plan,auth.uid()) returning id into obj;
      else
        select * into j from public.food_print_jobs where id=obj and store_id=p_store for update;
        if not found or j.status<>'waiting' or j.revision is distinct from (p_data->>'revision')::integer then raise exception 'Impressão alterada. Atualize a lista antes de editar.'; end if;
        update public.food_print_jobs set description=trim(p_data->>'description'),quantity=qty,plan=plan,order_id=link,revision=revision+1 where id=obj;
      end if;
    end if;
    result:=jsonb_build_object('id',obj);
  elsif p_action in ('start','finish','correct') then
    select * into j from public.food_print_jobs where id=(p_data->>'id')::uuid and store_id=p_store for update;
    if not found or j.revision is distinct from (p_data->>'revision')::integer then raise exception 'Impressão alterada. Atualize a lista antes de registrar.'; end if;
    perform food_modules_private.print_check_order(p_store,j.order_id);
    if p_action='start' then
      if j.status<>'waiting' then raise exception 'A impressão já foi iniciada ou encerrada.'; end if;
      update public.food_print_jobs set status='printing',started_at=now(),revision=revision+1 where id=j.id;
    else
      if (p_action='finish' and j.status not in ('waiting','printing')) or (p_action='correct' and j.status not in ('completed','interrupted')) then raise exception 'Situação incompatível com este lançamento.'; end if;
      reason:=left(trim(coalesce(p_data->>'reason','')),1000);
      if p_action='correct' and length(reason)<3 then raise exception 'Informe o motivo da correção.'; end if;
      outcome:=p_data->>'outcome'; pieces:=(p_data->>'pieces')::integer; h:=(p_data->>'hours')::numeric;
      if outcome is null or outcome not in ('completed','interrupted') or pieces is null or pieces<0 or pieces>j.quantity
        or h is null or h::text in ('NaN','Infinity','-Infinity') or h<0 or h>1000000 then raise exception 'Revise a situação, peças e tempo registrados.'; end if;
      if jsonb_typeof(p_data->'materials') is distinct from 'array' or jsonb_array_length(p_data->'materials')=0 or jsonb_array_length(p_data->'materials')>30 then raise exception 'Confirme os materiais usados, mesmo quando o consumo for zero.'; end if;
      if p_action='correct' then select * into prior from public.food_print_records where job_id=j.id order by revision desc limit 1; end if;
      -- Normaliza e valida tudo antes de tocar o saldo. Totais referem-se a esta tentativa inteira.
      for l in select value from jsonb_array_elements(p_data->'materials') loop
        material_id:=(l->>'inventory_item_id')::uuid;
        select * into i from public.food_inventory_items where id=material_id and store_id=p_store;
        if not found or not i.active or i.id=any(seen) then raise exception 'Material repetido, inativo ou de outra loja.'; end if;
        seen:=array_append(seen,i.id);
        q:=(l->>'quantity')::numeric;
        perform food_modules_private.print_quantity(q,l->>'unit',i.unit);
        source:=l->>'origin';
        if source is null or source not in ('estimated_confirmed','measured_manual') then raise exception 'Informe a origem do consumo.'; end if;
        if source='estimated_confirmed' and not exists(select 1 from jsonb_array_elements(j.plan->'materials') e
          where e->>'inventory_item_id'=i.id::text and
          food_modules_private.print_quantity((e->>'quantity')::numeric*case when e->>'basis'='piece' then j.quantity else 1 end,e->>'unit',i.unit)=food_modules_private.print_quantity(q,l->>'unit',i.unit)) then
          raise exception 'Consumo diferente da previsão deve ser identificado como medido/informado.'; end if;
        lines:=lines||jsonb_build_array(jsonb_build_object('inventory_item_id',i.id,'name',i.name,'quantity',q,'unit',l->>'unit','origin',source));
      end loop;
      -- Inclui os materiais removidos na correção: estorna só a diferença, nunca apaga o original.
      perform set_config('foodweb.inventory_mutation','on',true);
      perform set_config('foodweb.recipe_reconcile','on',true);
      for material_id in select distinct x.id from (
        select (value->>'inventory_item_id')::uuid id from jsonb_array_elements(lines)
        union select (value->>'inventory_item_id')::uuid from jsonb_array_elements(coalesce(prior.materials,'[]'))) x order by x.id loop
        select * into strict i from public.food_inventory_items where id=material_id and store_id=p_store for update;
        select value into l from jsonb_array_elements(lines) where value->>'inventory_item_id'=i.id::text;
        select value into oldline from jsonb_array_elements(coalesce(prior.materials,'[]')) where value->>'inventory_item_id'=i.id::text;
        amount:=case when l is null then 0 else food_modules_private.print_quantity((l->>'quantity')::numeric,l->>'unit',i.unit) end;
        old_amount:=case when oldline is null then 0 else food_modules_private.print_quantity((oldline->>'quantity')::numeric,oldline->>'unit',i.unit) end;
        delta:=old_amount-amount; before_q:=i.current_quantity; after_q:=before_q+delta;
        if after_q<0 then raise exception 'Saldo insuficiente de %: disponível % %, consumo adicional % %. Confira o estoque ou registre o recebimento.',i.name,before_q,i.unit,-delta,i.unit using errcode='23514'; end if;
        if delta<>0 then
          update public.food_inventory_items set current_quantity=after_q where id=i.id;
          insert into public.food_inventory_movements(store_id,inventory_item_id,movement_type,quantity_delta,quantity_before,quantity_after,unit_cost,total_cost,source_type,source_id,source_reference,reason,created_by)
            values(p_store,i.id,case when delta<0 then 'consumption' else 'return' end,delta,before_q,after_q,i.average_unit_cost,round(delta*i.average_unit_cost,2),'printing3d',rec,j.id::text,
              case when p_action='correct' then 'Correção de consumo 3D: '||reason else 'Consumo da impressão 3D ('||outcome||')' end,auth.uid());
        end if;
      end loop;
      rev:=j.revision+1;
      insert into public.food_print_records(id,store_id,job_id,revision,kind,outcome,pieces,hours,materials,reason,created_by)
        values(rec,p_store,j.id,rev,case when p_action='correct' then 'correction' else 'finish' end,outcome,pieces,h,lines,reason,auth.uid());
      update public.food_print_jobs set status=outcome,finished_at=coalesce(finished_at,now()),revision=rev where id=j.id;
    end if;
    result:=jsonb_build_object('id',j.id);
  elsif p_action='purchase_plan' then
    if coalesce(p_data->>'stage','') not in ('planned','ordered') or jsonb_typeof(p_data->'items') is distinct from 'array'
      or jsonb_array_length(p_data->'items') not between 1 and 30 then raise exception 'Revise os itens e a situação da compra.'; end if;
    perform set_config('foodweb.print_purchase_write','on',true);
    insert into public.food_inventory_purchases(store_id,supplier,occurred_on,status,print_procurement_stage,idempotency_key,created_by)
      values(p_store,left(trim(p_data->>'supplier'),200),current_date,'draft',p_data->>'stage','print:'||p_key::text,auth.uid()) returning id into obj;
    for l in select value from jsonb_array_elements(p_data->'items') loop
      select * into i from public.food_inventory_items where id=(l->>'inventory_item_id')::uuid and store_id=p_store;
      if not found or not i.active or i.id=any(seen) then raise exception 'Material repetido, inativo ou de outra loja.'; end if;
      seen:=array_append(seen,i.id);
      if l->>'unit' is distinct from i.unit then raise exception 'Unidade do insumo alterada. Atualize a lista antes de planejar a compra.'; end if;
      q:=food_modules_private.print_quantity((l->>'quantity')::numeric,l->>'unit',i.unit);
      cost:=(l->>'unit_cost')::numeric;
      if q<=0 or cost is null or cost::text in ('NaN','Infinity','-Infinity') or cost<0 or cost>100000000 or round(cost,4)<>cost then raise exception 'Quantidade ou custo inválido.'; end if;
      insert into public.food_inventory_purchase_items(purchase_id,store_id,inventory_item_id,quantity,unit_cost,notes)
        values(obj,p_store,i.id,q,cost,'Unidade no planejamento: '||i.unit);
      total:=total+round(q*cost,2);
    end loop;
    update public.food_inventory_purchases set total_amount=total where id=obj;
    result:=jsonb_build_object('id',obj);
  elsif p_action in ('purchase_receive','purchase_order','purchase_cancel') then
    select * into purchase from public.food_inventory_purchases where id=(p_data->>'id')::uuid and store_id=p_store for update;
    if not found or purchase.print_procurement_stage is null then raise exception 'Compra planejada não encontrada.'; end if;
    if purchase.status<>'draft' then raise exception 'Compra já recebida ou cancelada. Atualize a lista.'; end if;
    perform set_config('foodweb.print_purchase_write','on',true);
    if p_action='purchase_order' then
      update public.food_inventory_purchases set print_procurement_stage='ordered' where id=purchase.id;
    elsif p_action='purchase_cancel' then
      update public.food_inventory_purchases set status='cancelled' where id=purchase.id;
    else
      perform set_config('foodweb.inventory_mutation','on',true);
      -- Mesmo recebimento integral e custo médio do fluxo existente; pagamento continua no financeiro.
      for l in select to_jsonb(pi) from public.food_inventory_purchase_items pi where pi.purchase_id=purchase.id order by pi.inventory_item_id loop
        select * into i from public.food_inventory_items where id=(l->>'inventory_item_id')::uuid and store_id=p_store for update;
        if not found or not i.active then raise exception 'Material inativo: restaure o cadastro antes de receber.'; end if;
        q:=(l->>'quantity')::numeric; cost:=(l->>'unit_cost')::numeric;
        before_q:=i.current_quantity; after_q:=before_q+q;
        update public.food_inventory_items set current_quantity=after_q,average_unit_cost=round((before_q*i.average_unit_cost+q*cost)/after_q,4),last_unit_cost=cost where id=i.id;
        insert into public.food_inventory_movements(store_id,inventory_item_id,movement_type,quantity_delta,quantity_before,quantity_after,unit_cost,total_cost,source_type,source_id,reason,created_by)
          values(p_store,i.id,'purchase',q,before_q,after_q,cost,round(q*cost,2),'purchase',purchase.id,'Compra recebida',auth.uid());
      end loop;
      update public.food_inventory_purchases set status='received' where id=purchase.id;
    end if;
    result:=jsonb_build_object('id',purchase.id);
  else raise exception 'Comando de produção desconhecido.';
  end if;
  perform set_config('foodweb.inventory_mutation',previous_mutation,true);
  perform set_config('foodweb.recipe_reconcile',previous_reconcile,true);
  perform set_config('foodweb.print_purchase_write',previous_purchase,true);
  insert into food_modules_private.print_operations values(p_store,p_key,p_action,md5(p_data::text),result);
  return result;
end $$;

create function public.food_printing3d_command_v1(p_store uuid,p_action text,p_data jsonb,p_key uuid) returns jsonb
language sql security invoker set search_path='' as $$select food_modules_private.print_command(p_store,p_action,p_data,p_key)$$;
revoke all on function food_modules_private.print_quantity(numeric,text,text),food_modules_private.print_plan(uuid,jsonb,integer),food_modules_private.print_check_order(uuid,uuid),food_modules_private.print_guard_recipe(),food_modules_private.print_guard_purchase(),food_modules_private.print_guard_movement() from public,anon,authenticated;
revoke all on function food_modules_private.print_command(uuid,text,jsonb,uuid), public.food_printing3d_command_v1(uuid,text,jsonb,uuid) from public,anon;
grant execute on function food_modules_private.print_command(uuid,text,jsonb,uuid),public.food_printing3d_command_v1(uuid,text,jsonb,uuid) to authenticated;
commit;
