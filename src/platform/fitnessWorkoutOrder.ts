/** Move a single exercise without dropping exercises belonging to other days. */
export function moveWorkoutExercise<T>(exercises: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= exercises.length || target < 0 || target >= exercises.length) return exercises;
  const result = [...exercises];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}
