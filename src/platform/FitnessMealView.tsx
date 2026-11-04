import type { Meal } from '../services/fitnessNutritionApi';

export const weightStates = { raw:'Cru', cooked:'Cozido', prepared:'Preparado', not_applicable:'Não se aplica' };
export function FitnessMealView({meal}:{meal:Meal}) {
  const compatible=meal.items.length>0&&meal.items.every(item=>item.unit==='g'&&item.weight_state===meal.items[0].weight_state&&item.weight_state!=='not_applicable');
  return <article className="fitness-meal-view">
    <h4>{meal.day} · {meal.name} {meal.time}</h4>
    <div className="fitness-meal-layout">
      <svg viewBox="0 0 220 220" role="img" aria-label="Prato esquemático: áreas de identificação sem proporção de peso">
        <circle cx="110" cy="110" r="102" fill="none" stroke="currentColor" strokeWidth="3"/>
        {meal.items.map((item,index)=>{
          const count=meal.items.length, a=index*2*Math.PI/count-Math.PI/2,b=(index+1)*2*Math.PI/count-Math.PI/2,mid=(a+b)/2;
          const x=110+90*Math.cos(a),y=110+90*Math.sin(a),ex=110+90*Math.cos(b),ey=110+90*Math.sin(b);
          return <g key={index}>{count===1?<circle cx="110" cy="110" r="90" fill="currentColor" fillOpacity=".08"/>:<path d={`M110 110L${x} ${y}A90 90 0 ${b-a>Math.PI?1:0} 1 ${ex} ${ey}Z`} fill="currentColor" fillOpacity={index%2 ? '.14':'.06'} stroke="currentColor"/>}<text x={110+55*Math.cos(mid)} y={115+55*Math.sin(mid)} textAnchor="middle" fill="currentColor">{index+1}</text></g>;
        })}
      </svg>
      <ol>{meal.items.map((item,index)=><li key={index}><strong>{item.name}</strong> — {item.amount} {item.unit==='unit'?'unidade(s)':item.unit} · {weightStates[item.weight_state]}<br/>{item.group} · {item.household_measure}{item.alternatives&&<p>Alternativas aprovadas: {item.alternatives}</p>}</li>)}</ol>
    </div>
    {compatible?<p>Soma das massas informadas: {meal.items.reduce((sum,item)=>sum+item.amount,0).toLocaleString('pt-BR')} g ({weightStates[meal.items[0].weight_state].toLowerCase()}). O peso total não substitui a orientação profissional.</p>:<p>Sem soma de massas: unidades ou estados não são compatíveis.</p>}
    <p className="business-muted">As áreas do prato identificam os itens; não representam gramas nem proporções recomendadas.</p>
    {meal.instructions&&<p><strong>Preparo:</strong> {meal.instructions}</p>}
    {meal.seasonings&&<p><strong>Temperos prescritos:</strong> {meal.seasonings}</p>}
  </article>;
}
