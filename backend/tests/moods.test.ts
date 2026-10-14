import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moodDay } from '../src/moods.js';

test('mood dates follow the chosen timezone across UTC midnight and year boundaries', () => {
  const now = new Date('2027-01-01T00:30:00Z');
  assert.equal(moodDay('UTC', now), '2027-01-01');
  assert.equal(moodDay('America/Los_Angeles', now), '2026-12-31');
  assert.equal(moodDay('Pacific/Kiritimati', new Date('2026-12-31T12:30:00Z')), '2027-01-01');
  assert.equal(moodDay('Asia/Kolkata', new Date('2026-10-13T20:00:00Z')), '2026-10-14');
});

test('mood dates respect daylight saving changes without shifting the local calendar day', () => {
  assert.equal(moodDay('America/New_York', new Date('2026-03-08T06:59:00Z')), '2026-03-08');
  assert.equal(moodDay('America/New_York', new Date('2026-03-08T07:01:00Z')), '2026-03-08');
  assert.equal(moodDay('America/New_York', new Date('2026-11-01T05:30:00Z')), '2026-11-01');
  assert.equal(moodDay('America/New_York', new Date('2026-11-01T06:30:00Z')), '2026-11-01');
});

test('mood dates reject missing, malformed, and fixed-offset timezone input', () => {
  for (const value of [undefined, null, [], {}, 1, '', 'unknown/place', '+05:30', '-08:00', 'x'.repeat(101)]) {
    assert.equal(moodDay(value), null);
  }
});
