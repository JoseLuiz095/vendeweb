import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { moveWorkoutExercise } from '../src/platform/fitnessWorkoutOrder.ts';

test('reordena preservando todos os exercícios, inclusive de outros dias', () => {
  const rows = [{name:'Supino',day:'A'}, {name:'Agachamento',day:'B'}, {name:'Remada',day:'A'}];
  const moved = moveWorkoutExercise(rows, 1, -1);
  assert.deepEqual(moved.map(row=>row.name), ['Agachamento','Supino','Remada']);
  assert.deepEqual(rows.map(row=>row.name), ['Supino','Agachamento','Remada']);
  assert.deepEqual(moveWorkoutExercise(moved, 0, 1), rows);
  assert.equal(moveWorkoutExercise(rows, 0, -1), rows);
  assert.equal(moveWorkoutExercise(rows, 2, 1), rows);
  assert.equal(moveWorkoutExercise(rows, -1, 1), rows);
});
