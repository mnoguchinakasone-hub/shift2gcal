import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildMonthPlan,
  detectMonth,
  extractShiftRecords,
  isShiftRecord,
  listUsers,
} from '../src/lib/shift.js';
import { DEFAULT_SETTINGS } from '../src/lib/config.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/get-preview.json', import.meta.url)), 'utf8'),
);

const settings = { ...DEFAULT_SETTINGS, targetUserId: '1001' };

/** 対象日のプランを取り出す。 */
const entryOf = (plan, targetDay) => plan.entries.find((entry) => entry.targetDay === targetDay);

test('レスポンスが配列でなくてもシフトレコードを抽出できる', () => {
  const records = extractShiftRecords(fixture);
  assert.equal(records.length, 8);
  assert.ok(records.every(isShiftRecord));
});

test('生の配列レスポンスからも抽出できる', () => {
  const records = extractShiftRecords(fixture.shifts);
  assert.equal(records.length, 8);
});

test('インデックスをキーにしたオブジェクト形式からも抽出できる', () => {
  const indexed = { ...Object.fromEntries(fixture.shifts.map((r, i) => [i, r])), isClosing: false };
  const records = extractShiftRecords(indexed);
  assert.equal(records.length, 8);
});

test('shift 以外のオブジェクトはレコードとみなさない', () => {
  assert.equal(isShiftRecord({ target_day: '2026-10-01' }), false); // type が無い
  assert.equal(isShiftRecord({ target_day: '2026/10/01', type: 'work_input' }), false);
  assert.equal(isShiftRecord(null), false);
  assert.equal(isShiftRecord([{ target_day: '2026-10-01', type: 'x' }]), false);
});

test('レコードの多数派から対象月を判定する', () => {
  assert.equal(detectMonth(extractShiftRecords(fixture)), '2026-10');
});

test('対象月の全日分のプランが作られる', () => {
  const plan = buildMonthPlan({ month: '2026-10', records: extractShiftRecords(fixture), settings });
  assert.equal(plan.entries.length, 31);
  assert.deepEqual(plan.warnings, []);
});

test('差分に無い日は既定の勤務時刻で登録される', () => {
  const plan = buildMonthPlan({ month: '2026-10', records: extractShiftRecords(fixture), settings });
  const entry = entryOf(plan, '2026-10-01');
  assert.equal(entry.kind, 'default');
  assert.equal(entry.title, '勤務');
  assert.equal(entry.allDay, false);
  assert.equal(entry.start.dateTime, '2026-10-01T09:00:00');
  assert.equal(entry.end.dateTime, '2026-10-01T18:00:00');
  assert.equal(entry.start.timeZone, 'Asia/Tokyo');
});

test('work_input は API の時刻をそのまま使う', () => {
  const plan = buildMonthPlan({ month: '2026-10', records: extractShiftRecords(fixture), settings });
  const entry = entryOf(plan, '2026-10-05');
  assert.equal(entry.kind, 'override');
  assert.equal(entry.title, '勤務時間変更');
  assert.equal(entry.start.dateTime, '2026-10-05T08:00:00+09:00');
  assert.equal(entry.end.dateTime, '2026-10-05T18:00:00+09:00');
});

test('半休は午前・午後どちらもAPIの時刻で登録される', () => {
  const plan = buildMonthPlan({ month: '2026-10', records: extractShiftRecords(fixture), settings });
  const morning = entryOf(plan, '2026-10-17');
  assert.equal(morning.start.dateTime, '2026-10-17T08:00:00+09:00');
  assert.equal(morning.end.dateTime, '2026-10-17T12:00:00+09:00');

  const afternoon = entryOf(plan, '2026-10-26');
  assert.equal(afternoon.start.dateTime, '2026-10-26T13:00:00+09:00');
  assert.equal(afternoon.end.dateTime, '2026-10-26T17:00:00+09:00');
});

test('公休・定休は終日イベントになり end は翌日になる', () => {
  const plan = buildMonthPlan({ month: '2026-10', records: extractShiftRecords(fixture), settings });
  const holiday = entryOf(plan, '2026-10-03');
  assert.equal(holiday.kind, 'holiday');
  assert.equal(holiday.title, '公休');
  assert.equal(holiday.allDay, true);
  assert.deepEqual(holiday.start, { date: '2026-10-03' });
  assert.deepEqual(holiday.end, { date: '2026-10-04' });

  assert.equal(entryOf(plan, '2026-10-04').title, '定休');
});

test('月末の公休でも end が翌月1日になる', () => {
  const plan = buildMonthPlan({ month: '2026-10', records: extractShiftRecords(fixture), settings });
  assert.deepEqual(entryOf(plan, '2026-10-31').end, { date: '2026-11-01' });
});

test('createHolidayEvents=false なら休日は登録対象から外れる', () => {
  const plan = buildMonthPlan({
    month: '2026-10',
    records: extractShiftRecords(fixture),
    settings: { ...settings, createHolidayEvents: false },
  });
  assert.equal(plan.entries.length, 28); // 31日 - 公休2日 - 定休1日
  assert.equal(entryOf(plan, '2026-10-03'), undefined);
  assert.equal(entryOf(plan, '2026-10-04'), undefined);
  assert.equal(entryOf(plan, '2026-10-31'), undefined);
});

test('対象ユーザーID以外のレコードは無視される', () => {
  const records = [
    ...extractShiftRecords(fixture),
    { id: 1, user_id: 1002, target_day: '2026-10-06', type: 'public_holiday', title: '他人の公休', work_start: null, work_end: null },
  ];
  const plan = buildMonthPlan({ month: '2026-10', records, settings });
  assert.equal(entryOf(plan, '2026-10-06').kind, 'default');
});

test('対象ユーザーが1人だけならID未指定でも処理できる', () => {
  const records = [
    { id: 1, user_id: 1002, target_day: '2026-10-06', type: 'public_holiday', title: '公休', work_start: null, work_end: null },
  ];
  const plan = buildMonthPlan({ month: '2026-10', records, settings: { ...settings, targetUserId: '' } });
  assert.equal(entryOf(plan, '2026-10-06').kind, 'holiday');
});

test('複数ユーザーが混在しID未指定なら例外になる', () => {
  const records = [
    ...extractShiftRecords(fixture),
    { id: 900, user_id: 1002, target_day: '2026-10-06', type: 'public_holiday', title: '公休', work_start: null, work_end: null },
  ];
  assert.throws(
    () => buildMonthPlan({ month: '2026-10', records, settings: { ...settings, targetUserId: '' } }),
    /2 人分が含まれています/,
  );
});

test('指定した対象ユーザーが対象月のデータに居なければ例外になる', () => {
  assert.throws(
    () =>
      buildMonthPlan({
        month: '2026-10',
        records: extractShiftRecords(fixture),
        settings: { ...settings, targetUserId: '9999' },
      }),
    /含まれていません/,
  );
});

test('listUsers は user_id を件数の多い順に返す', () => {
  const records = [
    { id: 1, user_id: 1002, target_day: '2026-10-06', type: 'public_holiday', title: '公休', work_start: null, work_end: null },
    ...extractShiftRecords(fixture),
  ];
  assert.deepEqual(listUsers(records), [
    { userId: '1001', count: 8 },
    { userId: '1002', count: 1 },
  ]);
});

test('listUsers は月を指定するとその月だけ数える', () => {
  const records = [
    ...extractShiftRecords(fixture),
    { id: 900, user_id: 1002, target_day: '2026-09-06', type: 'public_holiday', title: '公休', work_start: null, work_end: null },
  ];
  assert.deepEqual(listUsers(records, '2026-10'), [{ userId: '1001', count: 8 }]);
});

test('listUsers は user_id を持たないレコードを無視する', () => {
  assert.deepEqual(listUsers([{ target_day: '2026-10-06', type: 'public_holiday' }]), []);
});

test('対象月以外のレコードは反映されない', () => {
  const records = [
    { id: 1, user_id: 1001, target_day: '2026-09-03', type: 'public_holiday', title: '公休', work_start: null, work_end: null },
  ];
  const plan = buildMonthPlan({ month: '2026-10', records, settings });
  assert.ok(plan.entries.every((entry) => entry.kind === 'default'));
});

test('同じ日に複数レコードがあると警告が出る', () => {
  const records = [
    { id: 1, user_id: 1001, target_day: '2026-10-06', type: 'public_holiday', title: '公休', work_start: null, work_end: null },
    { id: 2, user_id: 1001, target_day: '2026-10-06', type: 'work_input', title: '勤務時間変更', work_start: '2026-10-06T10:00:00+09:00', work_end: '2026-10-06T19:00:00+09:00' },
  ];
  const plan = buildMonthPlan({ month: '2026-10', records, settings });
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /2026-10-06/);
  assert.equal(entryOf(plan, '2026-10-06').kind, 'override'); // 後勝ち
});

test('内容が同じならハッシュも同じ、変われば変わる', () => {
  const build = (overrides) =>
    buildMonthPlan({
      month: '2026-10',
      records: extractShiftRecords(fixture),
      settings: { ...settings, ...overrides },
    });
  assert.equal(entryOf(build({}), '2026-10-01').hash, entryOf(build({}), '2026-10-01').hash);
  assert.notEqual(
    entryOf(build({}), '2026-10-01').hash,
    entryOf(build({ defaultWorkStart: '10:00' }), '2026-10-01').hash,
  );
});

test('既定勤務時刻が不正なら例外になる', () => {
  assert.throws(
    () => buildMonthPlan({ month: '2026-10', records: [], settings: { ...settings, defaultWorkStart: '25:00' } }),
    /既定勤務時刻/,
  );
});

test('対象月の形式が不正なら例外になる', () => {
  assert.throws(() => buildMonthPlan({ month: '2026/10', records: [], settings }), /対象月/);
});

test('2月は日数どおりのプランになる（うるう年）', () => {
  assert.equal(buildMonthPlan({ month: '2028-02', records: [], settings }).entries.length, 29);
  assert.equal(buildMonthPlan({ month: '2027-02', records: [], settings }).entries.length, 28);
});
