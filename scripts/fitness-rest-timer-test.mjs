import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { remainingRestSeconds } from '../src/platform/fitnessRestTimer.ts';

test('conta o descanso até o prazo real, mesmo após suspensão da aba', () => {
  const deadline = 100_000;
  assert.equal(remainingRestSeconds(deadline, 70_000), 30);
  assert.equal(remainingRestSeconds(deadline, 99_001), 1);
  assert.equal(remainingRestSeconds(deadline, 100_000), 0);
  assert.equal(remainingRestSeconds(deadline, 150_000), 0);
});
