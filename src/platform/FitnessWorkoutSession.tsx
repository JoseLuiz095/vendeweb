import { useEffect, useState } from 'react';
import { FitnessMuscles } from './FitnessMuscles';
import { FitnessMovement } from './FitnessMovement';
import { FitnessSessionTimers } from './FitnessSessionTimers';
import { fitnessIllustrationByKey } from './fitnessExerciseIllustrationLibrary';
import type { FitnessWorkout } from '../services/fitnessApi';
import './fitnessStudentSession.css';

/** Volatile session controls; the saved day and exercise order remain authoritative. */
export function FitnessWorkoutSession({ workout }: { workout: FitnessWorkout }) {
  const [current, setCurrent] = useState(0);
  const [completed, setCompleted] = useState<Record<string, number>>({});
  const [restTrigger, setRestTrigger] = useState(0);
  const [timerRevision, setTimerRevision] = useState(0);
  const [day, setDay] = useState('');
  const days = [...new Set(workout.exercises.map(item => item.day || 'A'))];
  const selectedDay = days.includes(day) ? day : days[0];
  const visible = workout.exercises.filter(item => (item.day || 'A') === selectedDay);
  const exercise = visible[current] || visible[0];
  useEffect(() => { setCurrent(0); setCompleted({}); setRestTrigger(0); setDay(''); }, [workout.id]);
  if (!exercise) return <p>Esta ficha ainda não possui exercícios. Peça orientação ao profissional.</p>;
  const done = completed[exercise.id] || 0;
  const total = visible.reduce((count, item) => count + item.sets, 0);
  const progress = visible.reduce((count, item) => count + (completed[item.id] || 0), 0);
  const changeExercise = (index: number) => { setCurrent(index); setTimerRevision(value => value + 1); };
  const contextKey = `${workout.id}:${selectedDay}:${exercise.id}:${timerRevision}`;
  return <div className="fitness-session fitness-session-app" aria-label={`Sequência de ${workout.title}`}>
    <div className="fitness-day-heading"><label>Dia de treino<select value={selectedDay} onChange={event => { setDay(event.target.value); changeExercise(0); }}>{days.map(item => <option key={item} value={item}>Dia {item}</option>)}</select></label><span>Exercício {visible.indexOf(exercise) + 1} de {visible.length}</span></div>
    <p className="fitness-session-progress">{progress} de {total} séries marcadas nesta sessão · Dia {selectedDay}</p>
    <progress aria-label={`Progresso do dia ${selectedDay}`} max={total || 1} value={progress}/>
    <div className="fitness-session-focus">
      <h4>{exercise.name}</h4>
      <FitnessMovement kind={exercise.media_key}/>
      <dl className="fitness-session-metrics"><div><dt>Séries</dt><dd>{exercise.sets}</dd></div><div><dt>Repetições</dt><dd>{exercise.repetitions}</dd></div><div><dt>Descanso</dt><dd>{exercise.rest_seconds}<small> s</small></dd></div></dl>
      <p className="fitness-session-load"><strong>Carga/esforço</strong><span>{exercise.load_or_effort}</span></p>
      <div className="fitness-series-dots" aria-label={`${done} de ${exercise.sets} séries concluídas`}>{Array.from({ length: exercise.sets }, (_, i) => <span key={i} className={i < done ? 'is-done' : ''} aria-hidden="true">{i < done ? '✓' : i + 1}</span>)}</div>
      <button type="button" className="primary-button fitness-complete-set" disabled={done >= exercise.sets} onClick={() => {
        setCompleted(previous => ({ ...previous, [exercise.id]: Math.min(exercise.sets, (previous[exercise.id] || 0) + 1) }));
        setRestTrigger(value => value + 1);
      }}>Marcar série {Math.min(done + 1, exercise.sets)} concluída</button>
      <FitnessSessionTimers contextKey={contextKey} restSeconds={exercise.rest_seconds} restTrigger={restTrigger}/>
      <details><summary>Como executar e cuidados</summary><p><strong>Execução:</strong> {exercise.instructions}</p><p><strong>Alternativa:</strong> {exercise.alternative}</p>{exercise.equipment && <p>Equipamento: {exercise.equipment}</p>}{exercise.tempo && <p>Ritmo: {exercise.tempo}</p>}{exercise.range_of_motion && <p>Amplitude: {exercise.range_of_motion}</p>}{exercise.common_mistakes && <p>Erros comuns: {exercise.common_mistakes}</p>}{exercise.precautions && <p>Cuidados: {exercise.precautions}</p>}{exercise.professional_notes && <p>Notas profissionais: {exercise.professional_notes}</p>}</details>
      <details><summary>Músculos trabalhados</summary><FitnessMuscles primary={exercise.primary_muscles} secondary={exercise.secondary_muscles}/></details>
      <div className="fitness-session-actions">
        {done > 0 && <button type="button" className="secondary-button" onClick={() => { setCompleted(previous => ({ ...previous, [exercise.id]: Math.max(0, (previous[exercise.id] || 0) - 1) })); setTimerRevision(value => value + 1); }}>Desfazer última série</button>}
        {current > 0 && <button type="button" className="secondary-button" onClick={() => changeExercise(current - 1)}>Exercício anterior</button>}
        {current < visible.length - 1 && <button type="button" className="secondary-button" onClick={() => changeExercise(current + 1)}>Próximo exercício</button>}
      </div>
      {progress === total && <p role="status">Dia {selectedDay} concluído nesta tela. Seu progresso ainda não é salvo no servidor.</p>}
    </div>
    <details className="fitness-session-exercises"><summary>Exercícios do dia {selectedDay} · {visible.length}</summary><nav className="fitness-session-steps fitness-sequence-cards" aria-label="Exercícios da ficha">
      {visible.map((item, index) => { const image = item.media_key ? fitnessIllustrationByKey.get(item.media_key) : undefined; return <button type="button" key={item.id} aria-current={index === current ? 'step' : undefined} onClick={() => changeExercise(index)}>
        {image && <img src={`/assets/fitness-exercises/${image.id}-${image.pose === 'single' ? 'main' : 'start'}.webp`} alt="" loading="lazy"/>}<span><strong>{index + 1}. {item.name}</strong><small>{completed[item.id] || 0}/{item.sets} séries</small></span>
      </button>; })}
    </nav></details>
    <p className="business-muted fitness-session-note">Marcações e cronômetros valem somente nesta sessão e somem ao recarregar.</p>
  </div>;
}
