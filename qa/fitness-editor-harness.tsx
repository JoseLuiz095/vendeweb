import { createRoot } from 'react-dom/client';
import { FitnessWorkouts } from '../src/platform/FitnessWorkouts';
import { fitnessApi, type FitnessWorkout } from '../src/services/fitnessApi';
import { SupabaseHttpError } from '../src/lib/supabaseRest';
import '../src/platform/business.css';
import '../src/platform/fitness.css';

let workouts: FitnessWorkout[] = location.search.includes('approved=1') ? [{id:'approved',title:'Ficha aprovada',level:'basic',source:'custom',status:'approved',description:'',approved_at:'2026-11-01',exercises:[{id:'exercise-1',position:1,name:'Exercício existente',sets:3,repetitions:'10',rest_seconds:30,load_or_effort:'moderado',instructions:'Movimento controlado',alternative:'Alternativa',day:'A',professional_notes:'Nota profissional'}]}] : [];
Object.assign(fitnessApi, {
  listWorkouts: async () => workouts,
  reviseWorkout: async () => { throw new SupabaseHttpError('RPC ausente',404,'PGRST202'); },
  listStudents: async () => ({ students: [] }),
  saveWorkout: async (_store: string, workout: FitnessWorkout) => {
    if (sessionStorage.getItem('fail-save') === 'yes') throw new Error('Falha de teste ao salvar.');
    workouts = [{ ...workout, id: 'saved', exercises: workout.exercises.map(row => ({ ...row })) }];
    return { id: 'saved' };
  },
});
createRoot(document.getElementById('root')!).render(<div className="business-workspace"><FitnessWorkouts store="test-store" professional={true}/></div>);
