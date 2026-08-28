import assert from 'node:assert/strict';
import test from 'node:test';

import { countDiff, diffPlan } from '../src/lib/diff.js';

/** 登録プランのダミー。 */
const entry = (targetDay, hash, extra = {}) => ({
  targetDay,
  hash,
  kind: 'default',
  title: '勤務',
  allDay: false,
  start: { dateTime: `${targetDay}T09:00:00`, timeZone: 'Asia/Tokyo' },
  end: { dateTime: `${targetDay}T18:00:00`, timeZone: 'Asia/Tokyo' },
  ...extra,
});

/** 既存イベントのダミー。 */
const event = (id, targetDay, hash) => ({
  id,
  summary: '勤務',
  start: { dateTime: `${targetDay}T09:00:00+09:00` },
  end: { dateTime: `${targetDay}T18:00:00+09:00` },
  extendedProperties: { private: { source: 'shift2gcal', targetDay, hash } },
});

test('既存イベントが無ければすべて新規になる', () => {
  const diff = diffPlan([entry('2026-10-01', 'a'), entry('2026-10-02', 'b')], []);
  assert.deepEqual(countDiff(diff), { create: 2, update: 0, unchanged: 0, remove: 0 });
});

test('ハッシュが一致する日は変更なしになる', () => {
  const diff = diffPlan([entry('2026-10-01', 'a')], [event('e1', '2026-10-01', 'a')]);
  assert.deepEqual(countDiff(diff), { create: 0, update: 0, unchanged: 1, remove: 0 });
  assert.equal(diff.unchanged[0].eventId, 'e1');
});

test('ハッシュが変わった日は更新になり、既存内容が残る', () => {
  const diff = diffPlan([entry('2026-10-01', 'b')], [event('e1', '2026-10-01', 'a')]);
  assert.deepEqual(countDiff(diff), { create: 0, update: 1, unchanged: 0, remove: 0 });
  assert.equal(diff.update[0].eventId, 'e1');
  assert.deepEqual(diff.update[0].before, {
    title: '勤務',
    start: '2026-10-01T09:00:00+09:00',
    end: '2026-10-01T18:00:00+09:00',
  });
});

test('プランに無くなった同期イベントは削除対象になる', () => {
  const diff = diffPlan([], [event('e1', '2026-10-03', 'a')]);
  assert.deepEqual(countDiff(diff), { create: 0, update: 0, unchanged: 0, remove: 1 });
  assert.equal(diff.remove[0].eventId, 'e1');
  assert.equal(diff.remove[0].targetDay, '2026-10-03');
});

test('同じ日に重複した同期イベントは片方だけ残して削除される', () => {
  const diff = diffPlan(
    [entry('2026-10-01', 'a')],
    [event('e1', '2026-10-01', 'a'), event('e2', '2026-10-01', 'a')],
  );
  assert.deepEqual(countDiff(diff), { create: 0, update: 0, unchanged: 1, remove: 1 });
  assert.equal(diff.remove[0].eventId, 'e2');
});

test('targetDay を持たない同期イベントは削除対象になる', () => {
  const orphan = {
    id: 'e9',
    summary: '勤務',
    start: { date: '2026-10-01' },
    end: { date: '2026-10-02' },
    extendedProperties: { private: { source: 'shift2gcal' } },
  };
  const diff = diffPlan([entry('2026-10-01', 'a')], [orphan]);
  assert.deepEqual(countDiff(diff), { create: 1, update: 0, unchanged: 0, remove: 1 });
  assert.equal(diff.remove[0].eventId, 'e9');
});

test('削除対象は日付順に並ぶ', () => {
  const diff = diffPlan(
    [],
    [event('e2', '2026-10-05', 'a'), event('e1', '2026-10-02', 'a')],
  );
  assert.deepEqual(
    diff.remove.map((item) => item.targetDay),
    ['2026-10-02', '2026-10-05'],
  );
});
