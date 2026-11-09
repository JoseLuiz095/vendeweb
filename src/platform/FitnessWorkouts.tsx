import { InfoHint } from '../components/ui/InfoHint';
import { SupabaseHttpError } from '../lib/supabaseRest';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fitnessApi, type FitnessStudent, type FitnessWorkout } from '../services/fitnessApi';
import { FitnessWorkoutEditor } from './FitnessWorkoutEditor';
import { FitnessWorkoutSession } from './FitnessWorkoutSession';

const levels: Record<FitnessWorkout['level'],string> = { basic:'Básico',medium:'Médio',advanced:'Avançado' };

export function FitnessWorkouts({store,professional}:{store:string;professional:boolean}) {
  const [workouts,setWorkouts]=useState<FitnessWorkout[]>([]);
  const [students,setStudents]=useState<FitnessStudent[]>([]);
  const [selectedStudent,setSelectedStudent]=useState<Record<string,string>>({});
  const [editing,setEditing]=useState<FitnessWorkout|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [search,setSearch]=useState('');
  const [levelFilter,setLevelFilter]=useState<'all'|FitnessWorkout['level']>('all');
  const activeStore=useRef(store); activeStore.current=store;
  const visibleWorkouts=workouts.filter(workout=>(levelFilter==='all'||workout.level===levelFilter) && `${workout.title} ${workout.description}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));

  const reload=useCallback(async()=>{
    const [nextWorkouts,nextStudents]=await Promise.all([fitnessApi.listWorkouts(store),fitnessApi.listStudents(store)]);
    if(!Array.isArray(nextWorkouts)||!Array.isArray(nextStudents.students))throw new Error('O servidor não retornou as fichas e os alunos esperados.');
    if(activeStore.current!==store)return;
    setWorkouts(nextWorkouts);
    setStudents(nextStudents.students);
  },[store]);
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');setNotice('');setWorkouts([]);setStudents([]);setEditing(null);setSelectedStudent({});setSearch('');setLevelFilter('all');setBusy(false);
    void Promise.all([fitnessApi.listWorkouts(store),fitnessApi.listStudents(store)])
      .then(([nextWorkouts,nextStudents])=>{
        if(!Array.isArray(nextWorkouts)||!Array.isArray(nextStudents.students))throw new Error('O servidor não retornou as fichas e os alunos esperados.');
        if(active){setWorkouts(nextWorkouts);setStudents(nextStudents.students);}
      })
      .catch(cause=>{if(active)setError((cause as Error).message);})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[store]);

  const run=async(action:()=>Promise<unknown>,success:string):Promise<boolean>=>{
    if(busy)return false;
    setBusy(true);setError('');setNotice('');
    try{
      await action();
      try{await reload();if(activeStore.current===store)setNotice(success);}
      catch{if(activeStore.current===store)setError('A operação foi confirmada pelo servidor, mas a lista não atualizou. Recarregue antes de repetir.');}
      return activeStore.current===store;
    }catch(cause){if(activeStore.current===store)setError((cause as Error).message);return false;}
    finally{if(activeStore.current===store)setBusy(false);}
  };
  const copyWorkout=async(workout:FitnessWorkout)=>{
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try {
      await fitnessApi.reviseWorkout(store,workout.id);
      try {await reload();if(activeStore.current===store)setNotice('Nova versão criada como rascunho. A versão aprovada foi preservada.');}
      catch {if(activeStore.current===store)setError('A cópia foi criada no servidor, mas a lista não atualizou. Recarregue antes de repetir.');}
    } catch(cause) {
      if(activeStore.current!==store)return;
      if(cause instanceof SupabaseHttpError && cause.status===404 && (cause.details==='PGRST202' || /could not find the function[^\n]*food_fitness_workout_revision_v1/i.test(cause.message))) {
        setEditing({...workout,id:'',source:'custom',status:'draft',approved_at:null,exercises:workout.exercises.map(exercise=>({...exercise,id:crypto.randomUUID()}))});
      } else setError((cause as Error).message);
    } finally {if(activeStore.current===store)setBusy(false);}
  };
  const saveEdit=(draft:FitnessWorkout)=>{
    void run(()=>fitnessApi.saveWorkout(store,draft),'Ficha em rascunho salva no servidor.').then(saved=>{if(saved)setEditing(null);});
  };
  if(editing) return <section className="business-card fitness-workouts" aria-label="Editor de ficha">
    {error && <div className="business-message business-message--error" role="alert">{error.includes('Campos não permitidos no exercício') ? 'O servidor desta loja ainda não aceita os detalhes da ficha. Nenhum dado foi salvo; mantenha a ficha aberta enquanto a compatibilidade é corrigida.' : error}</div>}
    <FitnessWorkoutEditor key={editing.id || 'new'} workout={editing} busy={busy} onSave={saveEdit} onCancel={()=>setEditing(null)}/>
  </section>;

  return <section className="business-card fitness-workouts" aria-label="Fichas de treino">
    <h2>Fichas de treino</h2>
    <InfoHint label="Sobre Fichas de treino">Modelos genéricos para revisão. O Personal Trainer deve conferir, ajustar ao aluno e aprovar antes de atribuir. Estas fichas não são prescrição individualizada.</InfoHint>
    {error&&<div className="business-message business-message--error" role="alert">{error} <button type="button" onClick={()=>void reload().catch(cause=>setError((cause as Error).message))}>Tentar novamente</button></div>}
    {notice&&<div className="business-message" role="status">{notice}</div>}
    {loading?<p role="status">Consultando fichas no servidor…</p>:<>
      <div className="fitness-appointment-actions"><button type="button" className="primary-button" disabled={busy||!professional} onClick={()=>setEditing({id:'',title:'',level:'basic',source:'custom',status:'draft',description:'',approved_at:null,exercises:[]})}>Criar ficha de treino</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>void run(()=>fitnessApi.seedWorkouts(store),'Modelos Básico, Médio e Avançado preparados como rascunho no servidor.')}>Preparar três fichas em rascunho</button></div>
      <details aria-label="Acesso Fitness dos alunos"><summary>Acesso dos alunos</summary><section>
        <h3>Acesso dos alunos</h3>
        <p className="business-muted">Cada sessão é limitada ao aluno e a esta loja. A liberação exige uma sessão Admin com MFA.</p>
        {students.length===0?<p className="business-muted">Nenhum aluno cadastrado nesta loja.</p>:<div className="fitness-workout-list">{students.map(student=><article className="fitness-workout-card" key={student.client_id}>
          <div className="business-card-heading"><h4>{student.name}</h4><span className="business-badge">{student.session_active?'Sessão ativa':'Sem sessão ativa'}</span></div>
          {student.session_active&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>{
            if(!window.confirm('Revogar a sessão Fitness de '+student.name+' e liberar uma nova entrada por SMS?'))return;
            void run(()=>fitnessApi.releaseStudentSession(store,student.client_id,'lost_device'),'Sessão revogada. O aluno precisa entrar novamente por SMS.');
          }}>Revogar e liberar troca de sessão</button>}
        </article>)}</div>}
      </section></details>
      <div className="fitness-discovery"><label className="fitness-catalog-search">Buscar ficha<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nome ou descrição" /></label><label className="fitness-type-select">Nível<select value={levelFilter} onChange={event=>setLevelFilter(event.target.value as typeof levelFilter)}><option value="all">Todos</option><option value="basic">Básico</option><option value="medium">Médio</option><option value="advanced">Avançado</option></select></label></div>
      {workouts.length===0?<p className="business-muted">Nenhuma ficha cadastrada nesta loja.</p>:visibleWorkouts.length===0?<p className="business-muted">Nenhuma ficha corresponde à busca.</p>:<div className="fitness-workout-list">{visibleWorkouts.map(workout=><article className="fitness-workout-card" key={workout.id}>
        <div className="business-card-heading"><h3>{levels[workout.level]} · {workout.title}</h3><span className="business-badge">{workout.status==='approved'?'Aprovada':'Aguardando revisão'}</span></div>
        <p className="business-muted">{workout.exercises.length} {workout.exercises.length===1?'exercício':'exercícios'}</p><details><summary>Ver detalhes e exercícios</summary><p>{workout.description}</p>{workout.professional&&<p className="business-provider">Responsável: <strong>{workout.professional.name}</strong> · {workout.professional.council} {workout.professional.registration}</p>}
        <ol>{workout.exercises.map(exercise=><li key={exercise.id}><strong>{exercise.name}</strong><span>{exercise.sets} séries · {exercise.repetitions} repetições · {exercise.rest_seconds}s de descanso</span><span>Carga/esforço: {exercise.load_or_effort}</span><span>Instruções: {exercise.instructions}</span><span>Alternativa: {exercise.alternative}</span></li>)}</ol></details>
        {workout.status==='draft'&&<div className="fitness-appointment-actions"><button type="button" className="secondary-button" disabled={busy||!professional} onClick={()=>setEditing({...workout,exercises:workout.exercises.map(exercise=>({...exercise}))})}>Revisar e editar</button><button type="button" className="primary-button" disabled={busy||!professional} onClick={()=>void run(()=>fitnessApi.approveWorkout(store,workout.id),'Ficha aprovada pelo Personal Trainer no servidor.')}>Aprovar após revisão profissional</button></div>}
        {workout.status==='approved'&&<button type="button" className="secondary-button" disabled={busy||!professional} onClick={()=>void copyWorkout(workout)}>Criar cópia para adaptar</button>}
        {workout.status==='approved'&&<div className="fitness-appointment-actions"><p className="business-muted">Atribua a ficha a cada aluno após revisão individual.</p><label>Aluno<select value={selectedStudent[workout.id]||''} onChange={event=>setSelectedStudent(current=>({...current,[workout.id]:event.target.value}))}><option value="">Selecione um aluno com conta vinculada</option>{students.map(student=><option value={student.client_id} key={student.client_id}>{student.name}</option>)}</select></label><button type="button" className="secondary-button" disabled={busy||!professional||!selectedStudent[workout.id]} onClick={()=>{
          const student=students.find(item=>item.client_id===selectedStudent[workout.id]);
          if(!student||!window.confirm(`Atribuir a ficha ${workout.title} a ${student.name} após revisão individual?`))return;
          void run(()=>fitnessApi.assignWorkout(store,workout.id,student.client_id),'Ficha atribuída ao aluno no servidor.');
        }}>Atribuir ficha</button></div>}
      </article>)}</div>}
    </>}
  </section>;
}

export function FitnessStudentWorkouts({store,accessToken}:{store:string;accessToken?:string}) {
  const [workouts,setWorkouts]=useState<FitnessWorkout[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');setWorkouts([]);
    void fitnessApi.listWorkouts(store,accessToken)
      .then(rows=>{if(!Array.isArray(rows))throw new Error('Resposta inválida do servidor.');if(active)setWorkouts(rows);})
      .catch(cause=>{if(active)setError((cause as Error).message);})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[store,accessToken]);
  return <section className="business-card fitness-workouts" aria-label="Minhas fichas de treino">
    <h2>Minhas fichas de treino</h2>
    {loading?<p role="status">Consultando fichas atribuídas…</p>:error?<p role="alert">Não foi possível consultar suas fichas: {error}</p>:workouts.length===0?<p>Nenhuma ficha foi atribuída pelo Personal Trainer.</p>:<div className="fitness-workout-list">{workouts.map(workout=><article className="fitness-workout-card" key={workout.id}>
      <h3>{levels[workout.level]} · {workout.title}</h3><p>{workout.description}</p>{workout.professional&&<p className="business-provider">Responsável: <strong>{workout.professional.name}</strong> · {workout.professional.council} {workout.professional.registration}</p>}
      <FitnessWorkoutSession workout={workout}/>
    </article>)}</div>}
  </section>;
}
