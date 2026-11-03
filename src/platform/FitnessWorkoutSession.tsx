import { useEffect, useState } from 'react';
import type { FitnessWorkout } from '../services/fitnessApi';

/** Session controls are deliberately volatile: the server has no progress/history contract yet. */
export function FitnessWorkoutSession({ workout }: { workout: FitnessWorkout }) {
  const [current, setCurrent] = useState(0);
  const [completed, setCompleted] = useState<Record<string, number>>({});
  const [remaining, setRemaining] = useState(0);
  const exercise = workout.exercises[current];
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);
  useEffect(() => { setCurrent(0); setCompleted({}); setRemaining(0); }, [workout.id]);
  if (!exercise) return <p>Esta ficha ainda não possui exercícios. Peça orientação ao profissional.</p>;
  const done = completed[exercise.id] || 0;
  const total = workout.exercises.reduce((count, item) => count + item.sets, 0);
  const progress = workout.exercises.reduce((count, item) => count + (completed[item.id] || 0), 0);
  return <div className="fitness-session" aria-label={`Sequência de ${workout.title}`}>
    <p className="business-muted">Sequência {current + 1} de {workout.exercises.length} · {progress} de {total} séries marcadas nesta sessão</p>
    <nav className="fitness-session-steps" aria-label="Exercícios da ficha">
      {workout.exercises.map((item, index) => <button type="button" key={item.id} aria-current={index === current ? 'step' : undefined} onClick={() => { setCurrent(index); setRemaining(0); }}>
        {index + 1}. {item.name} <small>{completed[item.id] || 0}/{item.sets}</small>
      </button>)}
    </nav>
    <div className="fitness-session-focus">
      <h4>{exercise.name}</h4>
      <p>{exercise.sets} séries · {exercise.repetitions} repetições · {exercise.rest_seconds}s de descanso</p>
      <p><strong>Carga/esforço:</strong> {exercise.load_or_effort}</p>
      <p><strong>Execução:</strong> {exercise.instructions}</p>
      <p><strong>Alternativa:</strong> {exercise.alternative}</p>
      <div className="fitness-session-actions">
        <button type="button" className="primary-button" disabled={done >= exercise.sets} onClick={() => {
          setCompleted(previous => ({ ...previous, [exercise.id]: Math.min(exercise.sets, (previous[exercise.id] || 0) + 1) }));
          setRemaining(exercise.rest_seconds);
        }}>Marcar série {Math.min(done + 1, exercise.sets)} concluída</button>
        {done > 0 && <button type="button" className="secondary-button" onClick={() => { setCompleted(previous => ({ ...previous, [exercise.id]: Math.max(0, (previous[exercise.id] || 0) - 1) })); setRemaining(0); }}>Desfazer última série</button>}
        {current < workout.exercises.length - 1 && <button type="button" className="secondary-button" onClick={() => { setCurrent(current + 1); setRemaining(0); }}>Próximo exercício</button>}
      </div>
      {remaining > 0 && <p role="timer" aria-label={`Descanso: ${remaining} segundos restantes`}>Descanso: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} <button type="button" className="text-link" onClick={() => setRemaining(0)}>Pular descanso</button></p>}
      {progress === total && <p role="status">Sequência concluída nesta tela. Seu progresso ainda não é salvo no servidor.</p>}
    </div>
    <p className="business-muted">As marcações e o cronômetro são temporários e somem ao sair ou recarregar. Siga somente a ficha aprovada pelo profissional.</p>
  </div>;
}
