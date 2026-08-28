import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeKnownUsers, normalizeName, resolveCurrentUser } from '../src/lib/users.js';

/** シフト画面のDOM構造に合わせた候補（氏名は架空のもの）。 */
const CANDIDATES = [
  { userId: '7', name: '佐藤一郎' },
  { userId: '21', name: '鈴木二郎' },
  { userId: '103', name: '高橋三花' },
  { userId: '256', name: '田中四朗' },
  { userId: '1001', name: '伊藤五月' },
  { userId: '1002', name: '渡辺六美' },
  { userId: '1003', name: '山田太郎' },
];

/** サイドナビの表示（氏名は全角スペース入り、英字名が続く）。 */
const CURRENT_USER_NAMES = ['山田　太郎', 'YamadaTaro'];

test('氏名の比較では空白を無視する', () => {
  assert.equal(normalizeName('山田　太郎'), '山田太郎');
  assert.equal(normalizeName(' 山田 太郎 '), '山田太郎');
  assert.equal(normalizeName('YamadaTaro'), 'yamadataro');
  assert.equal(normalizeName(null), '');
});

test('サイドナビの氏名からログインユーザーのIDを特定する', () => {
  const resolved = resolveCurrentUser({
    candidates: CANDIDATES,
    currentUserNames: CURRENT_USER_NAMES,
  });
  assert.deepEqual(resolved, { userId: '1003', source: 'name' });
});

test('氏名一致はURLの user_id より優先される', () => {
  // 同僚の出勤簿を開いていてもログインユーザーを取り違えない。
  const resolved = resolveCurrentUser({
    candidates: CANDIDATES,
    currentUserNames: CURRENT_USER_NAMES,
    urlUserId: '21',
  });
  assert.deepEqual(resolved, { userId: '1003', source: 'name' });
});

test('設定セレクタによる判定が最優先になる', () => {
  const resolved = resolveCurrentUser({
    candidates: CANDIDATES,
    currentUserNames: CURRENT_USER_NAMES,
    selectorUserId: '256',
  });
  assert.deepEqual(resolved, { userId: '256', source: 'selector' });
});

test('英字名でも一致する', () => {
  const resolved = resolveCurrentUser({
    candidates: [...CANDIDATES, { userId: '900', name: 'YamadaTaro' }],
    currentUserNames: ['該当なしの氏名', 'YamadaTaro'],
  });
  assert.deepEqual(resolved, { userId: '900', source: 'name' });
});

test('同姓同名が居る場合は氏名では決めない', () => {
  const resolved = resolveCurrentUser({
    candidates: [...CANDIDATES, { userId: '900', name: '山田太郎' }],
    currentUserNames: CURRENT_USER_NAMES,
  });
  assert.deepEqual(resolved, { userId: '', source: 'none' });
});

test('氏名が取れなければURLの user_id を使う', () => {
  const resolved = resolveCurrentUser({ candidates: CANDIDATES, urlUserId: '256' });
  assert.deepEqual(resolved, { userId: '256', source: 'url' });
});

test('候補が1人だけならその1人にする', () => {
  const resolved = resolveCurrentUser({ candidates: [{ userId: '1003', name: '山田太郎' }] });
  assert.deepEqual(resolved, { userId: '1003', source: 'single' });
});

test('どの手がかりも無ければ特定しない', () => {
  assert.deepEqual(resolveCurrentUser({ candidates: CANDIDATES }), { userId: '', source: 'none' });
  assert.deepEqual(resolveCurrentUser(), { userId: '', source: 'none' });
});

test('候補に無い氏名なら特定しない', () => {
  const resolved = resolveCurrentUser({
    candidates: CANDIDATES,
    currentUserNames: ['存在しない人'],
  });
  assert.deepEqual(resolved, { userId: '', source: 'none' });
});

test('候補をマージしても既存の氏名は消えない', () => {
  const merged = mergeKnownUsers(
    [{ userId: '1003', name: '山田太郎' }],
    [{ userId: '1003', name: '' }, { userId: '7', name: '佐藤一郎' }],
  );
  assert.deepEqual(merged, [
    { userId: '7', name: '佐藤一郎' },
    { userId: '1003', name: '山田太郎' },
  ]);
});

test('マージ結果は user_id の数値順に並ぶ', () => {
  const merged = mergeKnownUsers([], CANDIDATES);
  assert.deepEqual(
    merged.map((user) => user.userId),
    ['7', '21', '103', '256', '1001', '1002', '1003'],
  );
});

test('user_id が無い候補は無視する', () => {
  assert.deepEqual(mergeKnownUsers([], [{ userId: '', name: 'メモ' }, null]), []);
});
