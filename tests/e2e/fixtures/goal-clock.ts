import '../../../server/env.js';
import assert from 'node:assert/strict';
import { db } from '../../../server/db.js';
import { initializeGoalHistory, saveGoals, localDateInTimeZone } from '../../../server/goals.js';

let now = Date.parse('2024-03-30T23:30:00Z');
Date.now = () => now;
try {
  const user = Number(db.prepare('INSERT INTO users (email,created_at) VALUES (?,?)')
    .run('clock@test.local', now).lastInsertRowid);
  assert.equal(localDateInTimeZone('Europe/Amsterdam'), '2024-03-31');
  assert.equal(localDateInTimeZone('America/Los_Angeles'), '2024-03-30');
  const baseline = initializeGoalHistory(user, 'Europe/Amsterdam');
  const first = baseline.goal_history[0];
  assert.ok(first);
  assert.equal(first.effective_date, '2024-03-31');
  const original = first.goals;
  now = Date.parse('2024-04-01T12:00:00Z');
  assert.equal(saveGoals(user, original, 'Europe/Amsterdam').goal_history.length, 1);
  const zero = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const saved = saveGoals(user, zero, 'Europe/Amsterdam');
  assert.deepEqual(saved.goal_history, [
    { effective_date: '2024-03-31', goals: original },
    { effective_date: '2024-04-01', goals: zero },
  ]);
  now = Date.parse('2024-04-01T23:30:00Z');
  saveGoals(user, original, 'Europe/Amsterdam');
  assert.throws(() => saveGoals(user, zero, 'America/Los_Angeles'), { message: 'goal_date_before_latest' });
} finally {
  db.close();
}
process.stdout.write('goal-clock-ok');
