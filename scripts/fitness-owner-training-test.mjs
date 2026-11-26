import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Isolated PGlite fixture; never uses production students or payment providers.
export async function testOwnerTraining({db,rpc,session,store,other,owner,nutritionist,manager,student}) {
  const row=async(sql,params=[]) => (await db.query(sql,params)).rows[0];
  await session(owner);
  assert.equal((await rpc('food_fitness_ensure_owner_training',[store])).created,true);
  const own=await row('select name,registration,kind,active from food_service_professionals where store_id=$1 and user_id=$2',[store,owner]);
  assert.equal(own.registration,''); assert.equal(own.kind,'training'); assert.equal(own.active,true);
  assert.equal(own.name,'fitness-test');
  const audit=await row('select count(*)::int n from food_business_audit where store_id=$1',[store]);
  assert.equal((await rpc('food_fitness_ensure_owner_training',[store])).created,false);
  assert.equal((await row('select count(*)::int n from food_business_audit where store_id=$1',[store])).n,audit.n);
  for(const [target,kind,council] of [[nutritionist,'training','CREF'],[owner,'nutrition','CRN'],[owner,'general','OUTRO']]) {
    await assert.rejects(()=>rpc('food_service_professional_upsert',[store,target,'Pessoa de teste',kind,council,'',true]));
  }
  await assert.rejects(()=>rpc('food_service_professional_upsert',[store,owner,'Pessoa de teste','training','CREF','12',true]));
  for(const account of [student,nutritionist,manager]) {
    await session(account);
    await assert.rejects(()=>rpc('food_fitness_ensure_owner_training',[store]),/proprietário ativo/);
    await assert.rejects(()=>rpc('food_fitness_ensure_owner_training',[other]),/proprietário ativo/);
    await assert.rejects(()=>rpc('food_service_professional_upsert',[store,account,'Pessoa de teste','training','CREF','',true]));
  }
  await db.exec('reset role');
  assert.equal((await row("select has_function_privilege('anon','public.food_fitness_ensure_owner_training(uuid)','EXECUTE') allowed")).allowed,false);
  assert.equal((await row("select has_table_privilege('authenticated','public.food_service_professionals','INSERT') allowed")).allowed,false);
  // Inactive profiles stay inactive in either identity table.
  for(const table of ['food_service_professionals','food_fitness_professionals']) {
    await db.exec('reset role');
    await db.query(`update ${table} set active=false where store_id=$1 and user_id=$2`,[store,owner]);
    await session(owner);
    assert.equal((await rpc('food_fitness_ensure_owner_training',[store])).available,false);
    await db.exec('reset role');
    assert.equal((await row(`select active from ${table} where store_id=$1 and user_id=$2`,[store,owner])).active,false);
    await db.query(`update ${table} set active=true where store_id=$1 and user_id=$2`,[store,owner]);
  }
  // Demotion and leaving Fitness revoke only the optional owner profile.
  for(const transition of ['role','segment','inactive']) {
    await db.exec('reset role');
    if(transition==='role')await db.query("update food_store_users set role='attendant' where store_id=$1 and user_id=$2",[store,owner]);
    else if(transition==='inactive')await db.query("update food_store_users set active=false where store_id=$1 and user_id=$2",[store,owner]);
    else await db.query("update food_business_profiles set primary_segment='personal' where store_id=$1",[store]);
    assert.equal((await row('select active from food_service_professionals where store_id=$1 and user_id=$2',[store,owner])).active,false);
    assert.equal((await row('select active from food_fitness_professionals where store_id=$1 and user_id=$2',[store,owner])).active,false);
    await db.query("update food_store_users set role='owner',active=true where store_id=$1 and user_id=$2",[store,owner]);
    await db.query("update food_business_profiles set primary_segment='fitness' where store_id=$1",[store]);
    await session(owner);
    assert.equal((await rpc('food_fitness_ensure_owner_training',[store])).available,false,'retorno não reativa perfil');
    await db.exec('reset role');
    await db.query('update food_service_professionals set active=true where store_id=$1 and user_id=$2',[store,owner]);
    await db.query('update food_fitness_professionals set active=true where store_id=$1 and user_id=$2',[store,owner]);
  }
  // All non-Fitness sectors keep the existing registration requirement.
  for(const segment of ['food','nutrition','personal','retail','printing3d','rentals','services','florist','creator']) {
    const id=randomUUID();
    await db.exec('reset role');
    await db.query('insert into food_stores(id,slug,name) values($1,$2,$2)',[id,`owner-${segment}`]);
    await db.query("insert into food_store_users(store_id,user_id,role) values($1,$2,'owner')",[id,owner]);
    await db.query('insert into food_business_profiles(store_id,primary_segment,initialized_by) values($1,$2,$3)',[id,segment,owner]);
    await session(owner);
    await assert.rejects(()=>rpc('food_fitness_ensure_owner_training',[id]),/proprietário ativo/);
    await assert.rejects(()=>rpc('food_service_professional_upsert',[id,owner,'Outra loja','training','CREF','',true]));
    await rpc('food_service_professional_upsert',[id,owner,'Outra loja','training','CREF','12345-G/ES',true]);
    assert.equal((await row('select registration from food_service_professionals where store_id=$1',[id])).registration,'12345-G/ES');
  }
  // Explicit professional name and number are never replaced by the default.
  await session(owner);
  await rpc('food_service_professional_upsert',[other,owner,'Nome preservado','training','CREF','12345-G/ES',true]);
  await rpc('food_fitness_ensure_owner_training',[other]);
  assert.equal((await row('select name from food_service_professionals where store_id=$1 and user_id=$2',[other,owner])).name,'Nome preservado');
  assert.equal((await row('select registration from food_service_professionals where store_id=$1 and user_id=$2',[other,owner])).registration,'12345-G/ES');
  // An existing CRN profile cannot be silently converted to training.
  await db.exec('reset role');
  await db.query("update food_service_professionals set kind='nutrition',council='CRN' where store_id=$1 and user_id=$2",[other,owner]);
  await session(owner);
  assert.equal((await rpc('food_fitness_ensure_owner_training',[other])).available,false);
  assert.equal((await row('select kind from food_service_professionals where store_id=$1 and user_id=$2',[other,owner])).kind,'nutrition');
  await db.exec('reset role');
  await db.query("update food_service_professionals set kind='training',council='CREF' where store_id=$1 and user_id=$2",[other,owner]);
  await session(owner);
  console.log('OK proprietário Fitness: sem CREF, idempotência, perfil preservado, CRN, permissões e nove outros segmentos.');
}
