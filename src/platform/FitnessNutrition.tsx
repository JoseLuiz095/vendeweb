import { useEffect, useState, type FormEvent } from 'react';
import { nutritionApi, type Meal, type MealItem, type NutritionPlan } from '../services/fitnessNutritionApi';
import { professionalApi, type AuthorizedStudent } from './professionalApi';
import { FitnessMealView, weightStates } from './FitnessMealView';

const blankItem=():MealItem=>({name:'',group:'',amount:0,unit:'g',weight_state:'prepared',household_measure:'',alternatives:''});
const blankMeal=():Meal=>({day:'',name:'',time:'',instructions:'',seasonings:'',items:[blankItem()]});
const blankPlan=():NutritionPlan=>({id:'',student_user_id:'',title:'',valid_until:'',meals:[blankMeal()],reported_restrictions:'',notes:'',status:'draft'});

export function FitnessNutrition({store,token,editor=false}:{store:string;token?:string;editor?:boolean}) {
  const [plans,setPlans]=useState<NutritionPlan[]>([]),[students,setStudents]=useState<AuthorizedStudent[]>([]);
  const [draft,setDraft]=useState<NutritionPlan|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const reload=async()=>{const rows=await nutritionApi.list(store,token);if(!Array.isArray(rows))throw new Error('Resposta de planos inválida.');setPlans(rows);};
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setPlans([]);setDraft(null);setStudents([]);
    void Promise.all([nutritionApi.list(store,token),editor?professionalApi.authorizedStudents(store):Promise.resolve([])]).then(([rows,people])=>{if(active){setPlans(rows);setStudents(people.filter(p=>p.purpose==='nutrition'));}}).catch(cause=>{if(active)setError((cause as Error).message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[store,token,editor]);
  const act=async(fn:()=>Promise<unknown>,success:string)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();await reload();setDraft(null);setNotice(success);}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}};
  const save=(event:FormEvent)=>{event.preventDefault();if(draft)void act(()=>nutritionApi.save(store,draft),'Rascunho salvo. A aprovação continua sendo uma ação separada.');};
  const updateMeal=(index:number,patch:Partial<Meal>)=>setDraft(current=>current&&({...current,meals:current.meals.map((m,i)=>i===index?{...m,...patch}:m)}));
  const updateItem=(mi:number,ii:number,patch:Partial<MealItem>)=>{if(draft)updateMeal(mi,{items:draft.meals[mi].items.map((item,i)=>i===ii?{...item,...patch}:item)});};
  return <section className="fitness-nutrition" aria-label={editor?'Editor de planos alimentares':'Planos alimentares autorizados'}>
    {editor&&<><h2>Planos alimentares</h2><p>Somente a nutricionista com CRN ativo e autorização do aluno pode preparar e aprovar um plano. Não há cálculo ou prescrição automática.</p><button className="secondary-button" type="button" disabled={busy||!students.length} onClick={()=>setDraft(blankPlan())}>Novo rascunho alimentar</button>{!loading&&!students.length&&<p>Nenhum aluno autorizou esta profissional para Nutrição. Configure o vínculo CRN e solicite consentimento no portal.</p>}</>}
    {error&&<p role="alert">{error} <button type="button" onClick={()=>void reload().catch(cause=>setError((cause as Error).message))}>Tentar novamente</button></p>}
    {notice&&<p role="status">{notice}</p>}
    {loading?<p role="status">Consultando planos autorizados…</p>:!error&&!plans.length&&<p>Nenhum plano alimentar individual está disponível. A publicação exige nutricionista habilitada, sua autorização específica e revisão profissional.</p>}
    {draft&&<form className="fitness-workout-edit" onSubmit={save}>
      <label>Aluno autorizado<select required disabled={Boolean(draft.id)} value={draft.student_user_id} onChange={e=>setDraft({...draft,student_user_id:e.target.value})}><option value="">Selecione</option>{students.map(s=><option key={s.student_user_id} value={s.student_user_id}>{s.name}</option>)}</select></label>
      <label>Título do plano<input required minLength={3} maxLength={120} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
      <label>Validade<input required type="date" value={draft.valid_until} onChange={e=>setDraft({...draft,valid_until:e.target.value})}/></label>
      <label>Alergias/intolerâncias informadas<textarea maxLength={2000} value={draft.reported_restrictions} onChange={e=>setDraft({...draft,reported_restrictions:e.target.value})}/></label>
      {draft.meals.map((meal,mi)=><fieldset key={mi}><legend>Refeição {mi+1}</legend>
        <label>Dia<input required maxLength={30} value={meal.day} onChange={e=>updateMeal(mi,{day:e.target.value})}/></label>
        <label>Refeição<input required minLength={2} maxLength={120} value={meal.name} onChange={e=>updateMeal(mi,{name:e.target.value})}/></label>
        <label>Horário<input type="time" value={meal.time} onChange={e=>updateMeal(mi,{time:e.target.value})}/></label>
        {meal.items.map((item,ii)=><fieldset key={ii}><legend>Alimento {ii+1}</legend>
          <label>Alimento<input required minLength={2} maxLength={120} value={item.name} onChange={e=>updateItem(mi,ii,{name:e.target.value})}/></label>
          <label>Grupo<input maxLength={120} value={item.group} onChange={e=>updateItem(mi,ii,{group:e.target.value})}/></label>
          <label>Quantidade prescrita<input required type="number" min="0.01" max="10000" step="0.01" value={item.amount||''} onChange={e=>updateItem(mi,ii,{amount:Number(e.target.value)})}/></label>
          <label>Unidade<select value={item.unit} onChange={e=>updateItem(mi,ii,{unit:e.target.value as MealItem['unit']})}><option value="g">Gramas</option><option value="ml">Mililitros</option><option value="unit">Unidades</option></select></label>
          <label>Estado do peso<select value={item.weight_state} onChange={e=>updateItem(mi,ii,{weight_state:e.target.value as MealItem['weight_state']})}>{Object.entries(weightStates).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
          <label>Medida caseira<input maxLength={500} value={item.household_measure} onChange={e=>updateItem(mi,ii,{household_measure:e.target.value})}/></label>
          <label>Alternativas/equivalências aprovadas<textarea maxLength={1000} value={item.alternatives} onChange={e=>updateItem(mi,ii,{alternatives:e.target.value})}/></label>
          <button type="button" className="text-link" disabled={meal.items.length<=1} onClick={()=>updateMeal(mi,{items:meal.items.filter((_,i)=>i!==ii)})}>Remover alimento {ii+1}</button>
        </fieldset>)}
        <button type="button" className="secondary-button" disabled={meal.items.length>=30} onClick={()=>updateMeal(mi,{items:[...meal.items,blankItem()]})}>Adicionar alimento</button>
        <label>Modo de preparo<textarea maxLength={2000} value={meal.instructions} onChange={e=>updateMeal(mi,{instructions:e.target.value})}/></label>
        <label>Temperos permitidos/restritos, somente se prescritos<textarea maxLength={1000} value={meal.seasonings} onChange={e=>updateMeal(mi,{seasonings:e.target.value})}/></label>
        <button type="button" className="text-link" disabled={draft.meals.length<=1} onClick={()=>setDraft({...draft,meals:draft.meals.filter((_,i)=>i!==mi)})}>Remover refeição {mi+1}</button>
      </fieldset>)}
      <button type="button" className="secondary-button" disabled={draft.meals.length>=42} onClick={()=>setDraft({...draft,meals:[...draft.meals,blankMeal()]})}>Adicionar refeição/dia</button>
      <label>Observações profissionais<textarea maxLength={2000} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
      <div className="business-actions"><button className="primary-button" disabled={busy}>Salvar rascunho alimentar</button><button type="button" className="secondary-button" onClick={()=>setDraft(null)}>Fechar editor</button></div>
    </form>}
    {plans.map(plan=><article className="fitness-workout-card" key={plan.id}><h3>{plan.title}</h3><p>{plan.status==='approved'?'Aprovado':plan.status==='draft'?'Rascunho':'Revogado'} · Validade: {plan.valid_until}</p><p>{plan.professional_name} · CRN {plan.registration}</p>{plan.reported_restrictions&&<p>Restrições informadas: {plan.reported_restrictions}</p>}{plan.meals.map((meal,index)=><FitnessMealView key={index} meal={meal}/>)}{plan.notes&&<p>{plan.notes}</p>}
      {editor&&plan.status==='draft'&&<div className="business-actions"><button className="secondary-button" disabled={busy} onClick={()=>setDraft(structuredClone(plan))}>Editar plano</button><button className="primary-button" disabled={busy} onClick={()=>{if(window.confirm('Você é a nutricionista responsável e revisou todas as porções, restrições e instruções?'))void act(()=>nutritionApi.approve(store,plan.id),'Plano aprovado pela nutricionista.');}}>Aprovar após revisão CRN</button></div>}
    </article>)}
  </section>;
}
