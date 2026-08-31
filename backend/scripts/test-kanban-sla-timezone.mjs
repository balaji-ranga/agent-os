import assert from 'node:assert/strict';
import { parseDbTimestampMs, slaState } from '../src/services/kanban-sla.js';

const originalTz = process.env.TZ;
try {
  const expectedDue = Date.parse('2026-08-31T22:59:06Z');
  const expectedCreated = Date.parse('2026-08-31T14:59:06Z');

  for (const timezone of ['UTC', 'Asia/Singapore', 'America/New_York']) {
    process.env.TZ = timezone;
    assert.equal(
      parseDbTimestampMs('2026-08-31 22:59:06'),
      expectedDue,
      `SQLite UTC deadline must not shift in ${timezone}`
    );
    assert.equal(parseDbTimestampMs('2026-08-31T22:59:06Z'), expectedDue);
    assert.equal(parseDbTimestampMs('2026-09-01T06:59:06+08:00'), expectedDue);

    const task = {
      status: 'in_progress',
      eta_hours: 8,
      created_at: '2026-08-31 14:59:06',
      due_at: '2026-08-31 22:59:06',
    };
    assert.equal(
      slaState(task, Date.parse('2026-08-31T15:00:01Z')),
      'green',
      `fresh eight-hour task must remain green in ${timezone}`
    );
    assert.equal(slaState(task, Date.parse('2026-08-31T21:30:00Z')), 'amber');
    assert.equal(slaState(task, expectedDue), 'red');
    assert.equal(slaState({ ...task, status: 'completed' }, expectedDue + 1), 'none');
  }

  assert.equal(parseDbTimestampMs('2026-08-31 14:59:06'), expectedCreated);
  assert.equal(Number.isNaN(parseDbTimestampMs('not-a-date')), true);
  assert.equal(Number.isNaN(parseDbTimestampMs(null)), true);
  console.log('kanban-sla-timezone: OK');
} finally {
  if (originalTz == null) delete process.env.TZ;
  else process.env.TZ = originalTz;
}
