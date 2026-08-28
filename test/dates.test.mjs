import assert from 'node:assert/strict';
import test from 'node:test';

import {
  daysInMonth,
  formatMonth,
  listMonthDays,
  localDateTime,
  monthOf,
  nextDay,
  nextMonth,
  normalizeTime,
  parseMonth,
  previousMonth,
  weekdayLabel,
} from '../src/lib/dates.js';

test('月の日数を返す', () => {
  assert.equal(daysInMonth(2026, 10), 31);
  assert.equal(daysInMonth(2026, 11), 30);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2027, 2), 28);
  assert.equal(daysInMonth(2100, 2), 28); // 400年ルール
});

test('対象月を分解・整形する', () => {
  assert.deepEqual(parseMonth('2026-10'), { year: 2026, month: 10 });
  assert.equal(parseMonth('2026-13'), null);
  assert.equal(parseMonth('2026-00'), null);
  assert.equal(parseMonth('2026/10'), null);
  assert.equal(parseMonth(undefined), null);
  assert.equal(formatMonth(2026, 3), '2026-03');
});

test('対象月の全日付を返す', () => {
  const days = listMonthDays(2026, 10);
  assert.equal(days.length, 31);
  assert.equal(days[0], '2026-10-01');
  assert.equal(days.at(-1), '2026-10-31');
});

test('翌日を返す（月またぎ・年またぎ）', () => {
  assert.equal(nextDay('2026-10-03'), '2026-10-04');
  assert.equal(nextDay('2026-10-31'), '2026-11-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.equal(nextDay('2028-02-29'), '2028-03-01');
});

test('前月・翌月を返す（年またぎ）', () => {
  assert.equal(nextMonth('2026-10'), '2026-11');
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(previousMonth('2026-10'), '2026-09');
  assert.equal(previousMonth('2026-01'), '2025-12');
});

test('時刻を HH:MM に正規化する', () => {
  assert.equal(normalizeTime('9:00'), '09:00');
  assert.equal(normalizeTime('0900'), '09:00');
  assert.equal(normalizeTime('18:30'), '18:30');
  assert.equal(normalizeTime('24:00'), null);
  assert.equal(normalizeTime('09:60'), null);
  assert.equal(normalizeTime(''), null);
});

test('タイムゾーンを含まないローカル日時を作る', () => {
  assert.equal(localDateTime('2026-10-01', '9:00'), '2026-10-01T09:00:00');
});

test('日付から月・曜日を取り出す', () => {
  assert.equal(monthOf('2026-10-03'), '2026-10');
  assert.equal(weekdayLabel('2026-10-03'), '土');
  assert.equal(weekdayLabel('2026-10-04'), '日');
  assert.equal(weekdayLabel('2026-10-05'), '月');
});
