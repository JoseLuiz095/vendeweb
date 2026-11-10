import { useEffect, useRef, useState } from 'react';
import { remainingRestSeconds } from './fitnessRestTimer';
import { FitnessMuscles } from './FitnessMuscles';
import { FitnessMovement } from './FitnessMovement';
import { fitnessIllustrationByKey } from './fitnessExerciseIllustrationLibrary';
import type { FitnessWorkout } from '../services/fitnessApi';

/** Session controls are deliberately volatile: the server has no progress/history contract yet. */
export function FitnessWorkoutSession({ workout }: { workout: FitnessWorkout }) {
  const [current, setCurrent] = useState(0);
  const [completed, setCompleted] = useState<Record<string, number>>({});
  const [remaining, setRemaining] = useState(0);
  const restDeadline = useRef(0);
  const [day,setDay]=useState('');
  const days=[...new Set(workout.exercises.map(item=>item.day||'A'))];
  const visible=workout.exercises.filter(item=>(item.day||'A')===(day||days[0]));
  const exercise = visible[current];
  useEffect(() => {
    if (remaining <= 0) return;
    const update = () => setRemaining(remainingRestSeconds(restDeadline.current, Date.now()));
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [remaining]);
  useEffect(() => { setCurrent(0); setCompleted({}); setRemaining(0); setDay(''); }, [workout.id]);
  if (!exercise) return <p>Esta ficha ainda não possui exercícios. Peça orientação ao profissional.</p>;
  const done = completed[exercise.id] || 0;
  const total = workout.exercises.reduce((count, item) => count + item.sets, 0);
  const progress = workout.exercises.reduce((count, item) => count + (completed[item.id] || 0), 0);
  return <div className="fitness-session" aria-label={`Sequência de ${workout.title}`}>
    <label>Dia de treino<select value={day||days[0]} onChange={e=>{setDay(e.target.value);setCurrent(0);setRemaining(0);}}>{days.map(item=><option key={item} value={item}>Dia {item}</option>)}</select></label>
    <p className="business-muted">Sequência {current + 1} de {visible.length} · {progress} de {total} séries marcadas nesta sessão</p>
    <nav className="fitness-session-steps fitness-sequence-cards" aria-label="Exercícios da ficha">
      {visible.map((item, index) => { const image = item.media_key ? fitnessIllustrationByKey.get(item.media_key) : undefined; return <button type="button" key={item.id} aria-current={index === current ? 'step' : undefined} onClick={() => { setCurrent(index); setRemaining(0); }}>
        {image && <img src={`/assets/fitness-exercises/${image.id}-${image.pose === 'single' ? 'main' : 'start'}.webp`} alt="" loading="lazy"/>}<span><strong>{index + 1}. {item.name}</strong><small>{completed[item.id] || 0}/{item.sets} séries</small></span>
      </button>; })}
    </nav>
    <div className="fitness-session-focus">
      <h4>{exercise.name}</h4><FitnessMovement kind={exercise.media_key}/><details><summary>Músculos trabalhados</summary><FitnessMuscles primary={exercise.primary_muscles} secondary={exercise.secondary_muscles}/></details>
      <p>{exercise.sets} séries · {exercise.repetitions} repetições · {exercise.rest_seconds}s de descanso</p>
      <p><strong>Carga/esforço:</strong> {exercise.load_or_effort}</p>
      <p><strong>Execução:</strong> {exercise.instructions}</p><details><summary>Ver alternativa e orientações adicionais</summary><p><strong>Alternativa:</strong> {exercise.alternative}</p>{exercise.equipment&&<p>Equipamento: {exercise.equipment}</p>}{exercise.tempo&&<p>Ritmo: {exercise.tempo}</p>}{exercise.range_of_motion&&<p>Amplitude: {exercise.range_of_motion}</p>}{exercise.common_mistakes&&<p>Erros comuns: {exercise.common_mistakes}</p>}{exercise.precautions&&<p>Cuidados: {exercise.precautions}</p>}{exercise.professional_notes&&<p>Notas profissionais: {exercise.professional_notes}</p>}</details>
      <div className="fitness-session-actions">
        <button type="button" className="primary-button" disabled={done >= exercise.sets} onClick={() => {
          setCompleted(previous => ({ ...previous, [exercise.id]: Math.min(exercise.sets, (previous[exercise.id] || 0) + 1) }));
          restDeadline.current = Date.now() + exercise.rest_seconds * 1000;
          setRemaining(exercise.rest_seconds);
        }}>Marcar série {Math.min(done + 1, exercise.sets)} concluída</button>
        {done > 0 && <button type="button" className="secondary-button" onClick={() => { setCompleted(previous => ({ ...previous, [exercise.id]: Math.max(0, (previous[exercise.id] || 0) - 1) })); setRemaining(0); }}>Desfazer última série</button>}
        {current > 0 && <button type="button" className="secondary-button" onClick={() => { setCurrent(current - 1); setRemaining(0); }}>Exercício anterior</button>}
        {current < visible.length - 1 && <button type="button" className="secondary-button" onClick={() => { setCurrent(current + 1); setRemaining(0); }}>Próximo exercício</button>}
      </div>
      {remaining > 0 && <p role="timer" aria-label={`Descanso: ${remaining} segundos restantes`}>Descanso: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} <button type="button" className="text-link" onClick={() => setRemaining(0)}>Pular descanso</button></p>}
      {progress === total && <p role="status">Sequência concluída nesta tela. Seu progresso ainda não é salvo no servidor.</p>}
    </div>
    <p className="business-muted">As marcações e o cronômetro são temporários e somem ao sair ou recarregar. Siga somente a ficha aprovada pelo profissional.</p>
  </div>;
}
