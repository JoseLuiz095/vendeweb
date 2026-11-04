import assert from 'node:assert/strict';

export async function testContent({ db, rpc, session, store, other, owner, nutritionist, student, student2, manager }) {
  await session(owner);
  const exercises = [{name:'Movimento fictício',sets:2,repetitions:'8',rest_seconds:60,load_or_effort:'Revisão profissional',instructions:'Instrução fictícia para teste.',alternative:'Alternativa revisada',day:'B',primary_muscles:['quadriceps'],secondary_muscles:['glutes'],equipment:'Banco',objective:'Teste',tempo:'Controlado',range_of_motion:'Conforme revisão',common_mistakes:'Revisar estabilidade',precautions:'Interromper em caso de desconforto',professional_notes:'Nota de teste',media_key:'squat'}];
  const saved = await rpc('food_fitness_save_workout',[store,null,'basic','Ficha estruturada','Conteúdo de teste',JSON.stringify(exercises),'custom']);
  let workout = (await rpc('food_fitness_list_workouts',[store])).find(w=>w.id===saved.id);
  assert.equal(workout.exercises[0].day,'B');
  assert.deepEqual(workout.exercises[0].primary_muscles,['quadriceps']);
  await assert.rejects(()=>rpc('food_fitness_save_workout',[store,saved.id,'basic','Ficha estruturada','',JSON.stringify([{...exercises[0],day:'Z'}]),'custom']));
  await rpc('food_fitness_approve_workout',[store,saved.id]);
  await assert.rejects(()=>rpc('food_fitness_save_workout',[store,saved.id,'basic','Alteração proibida','',JSON.stringify(exercises),'custom']));
  const revision = await rpc('food_fitness_workout_revision_v1',[store,saved.id]);
  assert.notEqual(revision.id,saved.id);
  workout=(await rpc('food_fitness_list_workouts',[store])).find(w=>w.id===revision.id);
  assert.equal(workout.status,'draft');
  assert.equal(workout.previous_version_id,saved.id);
  await session(manager);
  await assert.rejects(()=>rpc('food_fitness_workout_revision_v1',[store,saved.id]));

  await session(student);
  await rpc('food_fitness_student_authorize_professional',[store,nutritionist,'nutrition',true]);
  await session(nutritionist);
  const meals=[{day:'Segunda',name:'Refeição de teste',time:'12:00',instructions:'Preparação definida pelo profissional',seasonings:'Somente conforme prescrição',items:[{name:'Alimento fictício',group:'Cereais',amount:80,unit:'g',weight_state:'cooked',household_measure:'Medida definida pelo profissional',alternatives:'Alternativa revisada'}]}];
  const plan = await rpc('food_fitness_nutrition_save_v1',[store,null,student,'Plano de teste','2030-12-31',JSON.stringify(meals),'Informação fictícia informada pelo aluno','Observação de teste']);
  await session(student);
  assert.deepEqual(await rpc('food_fitness_nutrition_list_v1',[store]),[],'rascunho não chega ao aluno');
  await session(owner);
  assert.deepEqual(await rpc('food_fitness_nutrition_list_v1',[store]),[],'CREF/owner não recebe conteúdo CRN');
  await assert.rejects(()=>rpc('food_fitness_nutrition_approve_v1',[store,plan.id]));
  await session(nutritionist);
  await assert.rejects(()=>rpc('food_fitness_nutrition_approve_v1',[other,plan.id]));
  await rpc('food_fitness_nutrition_approve_v1',[store,plan.id]);
  await assert.rejects(()=>rpc('food_fitness_nutrition_save_v1',[store,plan.id,student,'Alterar aprovado','2030-12-31',JSON.stringify(meals),'','']));
  await session(student);
  assert.equal((await rpc('food_fitness_nutrition_list_v1',[store]))[0].meals[0].items[0].amount,80);
  await rpc('food_fitness_student_authorize_professional',[store,nutritionist,'nutrition',false]);
  assert.deepEqual(await rpc('food_fitness_nutrition_list_v1',[store]),[],'revogação impede leitura');
  await session(nutritionist);
  assert.deepEqual(await rpc('food_fitness_nutrition_list_v1',[store]),[],'revogação impede leitura profissional também');
  await session(student2);
  assert.deepEqual(await rpc('food_fitness_nutrition_list_v1',[store]),[]);
  await assert.rejects(()=>db.query('select * from public.food_fitness_nutrition_plans'),'sem leitura direta de conteúdo clínico');
  console.log('OK conteúdo Fitness: campos, versões imutáveis, CRN/CREF, aluno, consentimento e isolamento.');
}
