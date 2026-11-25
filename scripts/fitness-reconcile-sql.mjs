import { readFileSync } from 'node:fs';
const root = new URL('../supabase/migrations/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const strip = sql => sql.replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');
export function fitnessReconcileSql() {
  const compat = read('20261109015413_fitness_workout_editor_compat.sql');
  const advanced = compat.slice(compat.indexOf('  if advanced then\n    execute $fn$'), compat.indexOf('\n  else\n    execute $fn$'));
  const functions = [...advanced.matchAll(/execute \$fn\$([\s\S]*?)\$fn\$;/g)].map(m=>m[1]).join('\n');
  if (!functions.includes('student_session_active') || !functions.includes('workout_exercise_notes')) throw new Error('Contrato de privacidade/sessão não encontrado');
  const files = ['20261030114215_service_professional_identity.sql','20261030120000_food_fitness_phone_student_sessions.sql','20261030143000_professional_content_student_reminders.sql','20261030150000_food_fitness_phone_session_enforcement.sql','20261030170000_food_fitness_pilot_offers.sql','20261103164300_food_fitness_content_delivery.sql','20261103164842_food_fitness_paid_appointments.sql'];
  const body = files.map(name=> {
    let sql=strip(read(name));
    if(name.includes('content_delivery')) sql=sql.replace(/(alter table public\.food_fitness_exercises add column) /g,'$1 if not exists ');
    // Shared appointment trigger must preserve every non-Fitness branch.
    if(name.includes('service_professional_identity')) sql=sql.replace("begin\n  if new.status", "begin\n  if not food_fitness_private.is_fitness(new.store_id) then return new; end if;\n  if new.status");
    return `-- Source: ${name}\n${sql}`;
  }).join('\n');
  return `begin;
-- Reconcile only the known 27/10 + private-notes compatibility baseline.
do $guard$ begin
 if to_regclass('public.food_service_professionals') is not null or to_regclass('public.food_fitness_student_sessions') is not null or to_regclass('public.food_fitness_offers') is not null then raise exception 'Fitness parcialmente instalado: revisão obrigatória'; end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('food_business_private.public_offers(uuid)')) is distinct from 'c6dde170eb2cf69821763d3fd244b197' then raise exception 'Projeção pública diferente da baseline revisada'; end if;
 if to_regclass('food_fitness_private.workout_exercise_notes') is null or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.food_fitness_save_workout(uuid,uuid,text,text,text,jsonb,text)')) is distinct from '61e9517ea8d7fede6767581aaebc4e59' or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.food_fitness_list_workouts(uuid)')) is distinct from 'b51e9d6241745a282e165605148a07fb' then raise exception 'Contrato Fitness desconhecido'; end if;
 execute replace(pg_get_functiondef('food_business_private.public_offers(uuid)'::regprocedure),'FUNCTION food_business_private.public_offers(', 'FUNCTION food_business_private.public_offers_before_fitness(');
end $guard$;
revoke all on function food_business_private.public_offers_before_fitness(uuid) from public,anon,authenticated;
${body}
-- Keep professional notes private, including existing notes and advanced fields.
alter table public.food_fitness_exercises drop column professional_notes;
${functions}
-- Keep the exact old public projection for all other business branches.
do $copy$ begin
 execute replace(pg_get_functiondef('food_business_private.public_offers(uuid)'::regprocedure),'FUNCTION food_business_private.public_offers(', 'FUNCTION food_business_private.public_offers_fitness_reconciled(');
end $copy$;
revoke all on function food_business_private.public_offers_fitness_reconciled(uuid) from public,anon,authenticated;
create or replace function food_business_private.public_offers(p_store uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if food_fitness_private.is_fitness(p_store) then return food_business_private.public_offers_fitness_reconciled(p_store); end if;
 return food_business_private.public_offers_before_fitness(p_store);
end; $$;
notify pgrst, 'reload schema';
commit;`;
}
if (process.argv[1] === new URL(import.meta.url).pathname) process.stdout.write(fitnessReconcileSql());
