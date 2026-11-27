import { useEffect, useRef, useState } from 'react';
import { remainingRestSeconds } from './fitnessRestTimer';

type Props = {
  contextKey: string;
  restSeconds: number;
  restTrigger: number;
  onDismissRest?: () => void;
};
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Changing exercise/day remounts the clocks; nothing is saved as workout history. */
export function FitnessSessionTimers(props: Props) {
  const [vibration, setVibration] = useState(false);
  return <SessionTimers key={props.contextKey} {...props} vibration={vibration} setVibration={setVibration}/>;
}

function SessionTimers({ restSeconds, restTrigger, onDismissRest, vibration, setVibration }: Props & { vibration: boolean; setVibration: (enabled: boolean) => void }) {
  const [exerciseSeconds, setExerciseSeconds] = useState(0);
  const [exerciseRunning, setExerciseRunning] = useState(false);
  const exerciseElapsed = useRef(0);
  const exerciseStart = useRef(0);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restRunning, setRestRunning] = useState(false);
  const [restFinished, setRestFinished] = useState(false);
  const restDeadline = useRef(0);
  const restPaused = useRef(0);
  const previousTrigger = useRef(restTrigger);
  const vibrationEnabled = useRef(vibration);
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const [vibrationNotice, setVibrationNotice] = useState('');

  useEffect(() => {
    if (!exerciseRunning) return;
    const update = () => setExerciseSeconds(Math.floor((exerciseElapsed.current + Math.max(0, Date.now() - exerciseStart.current)) / 1000));
    const timer = window.setInterval(update, 250);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [exerciseRunning]);

  useEffect(() => {
    const increased = restTrigger > previousTrigger.current;
    previousTrigger.current = restTrigger;
    if (!increased) return;
    const duration = Number.isFinite(restSeconds) ? Math.max(0, Math.floor(restSeconds)) : 0;
    restDeadline.current = Date.now() + duration * 1000;
    restPaused.current = 0;
    setRestRemaining(duration);
    setRestFinished(false);
    setVibrationNotice('');
    setRestRunning(duration > 0);
  }, [restTrigger, restSeconds]);

  useEffect(() => {
    if (!restRunning) return;
    let finished = false;
    const update = () => {
      if (finished) return;
      const remaining = remainingRestSeconds(restDeadline.current, Date.now());
      setRestRemaining(remaining);
      if (remaining === 0) {
        finished = true;
        setRestRunning(false);
        setRestFinished(true);
        // Hidden documents cannot vibrate reliably. The visible completion stays
        // available on return; never request camera access or repeated alerts.
        if (vibrationEnabled.current && document.visibilityState === 'visible' && typeof navigator.vibrate === 'function') {
          try {
            if (!navigator.vibrate([200, 100, 200])) setVibrationNotice('O aparelho não confirmou a vibração. Confira o aviso na tela.');
          } catch { setVibrationNotice('A vibração está indisponível. Confira o aviso na tela.'); }
        }
      }
    };
    const timer = window.setInterval(update, 250);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [restRunning, restTrigger]);

  useEffect(() => () => {
    if (vibrationEnabled.current && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(0); } catch { /* Device capability is optional. */ }
    }
  }, []);

  const clearRest = () => {
    restDeadline.current = 0; restPaused.current = 0;
    setRestRemaining(0); setRestRunning(false); setRestFinished(false);
    onDismissRest?.();
  };
  const pauseExercise = () => {
    exerciseElapsed.current += Math.max(0, Date.now() - exerciseStart.current);
    setExerciseSeconds(Math.floor(exerciseElapsed.current / 1000));
    setExerciseRunning(false);
  };

  return <section className="fitness-session-timers" aria-label="Cronômetros do treino">
    <div className="fitness-timer-card">
      <h5>Execução</h5>
      <output className="fitness-timer-value" role="timer" aria-live="off" aria-label={`Tempo de execução: ${exerciseSeconds} segundos`}>{clock(exerciseSeconds)}</output>
      <div className="fitness-session-actions">
        <button type="button" className="secondary-button" onClick={() => {
          if (exerciseRunning) pauseExercise();
          else { exerciseStart.current = Date.now(); setExerciseRunning(true); }
        }}>{exerciseRunning ? 'Pausar execução' : exerciseSeconds > 0 ? 'Continuar execução' : 'Iniciar execução'}</button>
        <button type="button" className="text-link" onClick={() => {
          exerciseElapsed.current = 0; exerciseStart.current = 0;
          setExerciseRunning(false); setExerciseSeconds(0);
        }}>Zerar execução</button>
      </div>
    </div>
    <div className="fitness-timer-card">
      <h5>Descanso</h5>
      <output className="fitness-timer-value" role="timer" aria-live="off" aria-label={`Descanso: ${restRemaining} segundos restantes`}>{clock(restRemaining)}</output>
      <p className="business-muted">{restFinished ? 'Descanso encerrado' : restRemaining > 0 ? restRunning ? 'Contando descanso' : 'Descanso pausado' : restSeconds > 0 ? `Começa ao concluir uma série · ${restSeconds} s` : 'Sem descanso definido na ficha'}</p>
      {restRemaining > 0 && <div className="fitness-session-actions">
        <button type="button" className="secondary-button" onClick={() => {
          if (restRunning) {
            restPaused.current = Math.max(0, restDeadline.current - Date.now());
            setRestRemaining(Math.ceil(restPaused.current / 1000)); setRestRunning(false);
          } else {
            restDeadline.current = Date.now() + restPaused.current; setRestRunning(true);
          }
        }}>{restRunning ? 'Pausar descanso' : 'Continuar descanso'}</button>
        <button type="button" className="text-link" onClick={clearRest}>Encerrar descanso</button>
      </div>}
    </div>
    <label className="fitness-check fitness-timer-preference"><input type="checkbox" disabled={!canVibrate} checked={vibration} onChange={event => {
      const enabled = event.target.checked;
      vibrationEnabled.current = enabled; setVibration(enabled); setVibrationNotice('');
    }}/><span>Vibrar ao terminar o descanso{!canVibrate && ' · indisponível neste navegador'}</span></label>
    <p className="business-muted fitness-timer-limit">Mantenha esta tela aberta. Vibração depende do aparelho; não há alerta garantido com a tela bloqueada.</p>
    {restFinished && <div className="fitness-rest-finished" role="status">
      <strong>✓ Descanso concluído</strong><p>Confira a próxima série quando estiver pronto.</p>
      <button type="button" className="primary-button" onClick={clearRest}>Entendi</button>
    </div>}
    {vibrationNotice && <p role="status">{vibrationNotice}</p>}
  </section>;
}
