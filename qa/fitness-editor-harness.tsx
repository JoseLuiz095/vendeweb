import { createRoot } from 'react-dom/client';
import { FitnessWorkouts } from '../src/platform/FitnessWorkouts';
import { fitnessApi, type FitnessWorkout } from '../src/services/fitnessApi';
import '../src/platform/business.css';
import '../src/platform/fitness.css';

let workouts: FitnessWorkout[] = [];
Object.assign(fitnessApi, {
  listWorkouts: async () => workouts,
  listStudents: async () => ({ students: [] }),
  saveWorkout: async (_store: string, workout: FitnessWorkout) => {
    if (sessionStorage.getItem('fail-save') === 'yes') throw new Error('Falha de teste ao salvar.');
    workouts = [{ ...workout, id: 'saved', exercises: workout.exercises.map(row => ({ ...row })) }];
    return { id: 'saved' };
  },
});
createRoot(document.getElementById('root')!).render(<div className="business-workspace"><FitnessWorkouts store="test-store" professional={true}/></div>);
