/** ポップアップ：対象月の選択 → 差分プレビュー → 同期実行。 */

import { MSG } from '../lib/messages.js';
import { weekdayLabel } from '../lib/dates.js';

const el = {
  setupNotice: document.getElementById('setup-notice'),
  monthSelect: document.getElementById('month-select'),
  captureMeta: document.getElementById('capture-meta'),
  previewBtn: document.getElementById('preview-btn'),
  syncBtn: document.getElementById('sync-btn'),
  messagePanel: document.getElementById('message-panel'),
  message: document.getElementById('message'),
  summaryPanel: document.getElementById('summary-panel'),
  showUnchanged: document.getElementById('show-unchanged'),
  diffBody: document.getElementById('diff-body'),
  openOptions: document.getElementById('open-options'),
  counts: {
    create: document.getElementById('count-create'),
    update: document.getElementById('count-update'),
    remove: document.getElementById('count-remove'),
    unchanged: document.getElementById('count-unchanged'),
  },
};

/** 直近のプレビュー結果。同期ボタンと再描画で使う。 */
let currentPreview = null;
/** 取り込み済みの月ごとのメタ情報。 */
let captures = [];
/** 対象ユーザーの判定結果（設定と候補名）。 */
let targetUser = { userId: '', name: '' };

/** background へメッセージを送り、失敗時は例外にする。 */
async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error ?? '拡張機能の内部エラーです。');
  return response.data;
}

/** メッセージ欄に表示する。 */
function showMessage(text, isError = false) {
  el.message.textContent = text;
  el.message.classList.toggle('error', isError);
  el.messagePanel.hidden = !text;
}

/** 登録プランの時間帯を短く表示する。 */
function formatRange(entry) {
  if (entry.allDay) return '終日';
  const time = (value) => String(value ?? '').slice(11, 16);
  return `${time(entry.start.dateTime)}-${time(entry.end.dateTime)}`;
}

/** 既存イベント（更新前・削除対象）を短く表示する。 */
function formatBefore(before) {
  if (!before) return '';
  const isAllDay = before.start.length === 10;
  const time = (value) => value.slice(11, 16);
  const range = isAllDay ? '終日' : `${time(before.start)}-${time(before.end)}`;
  return `${before.title} ${range}`;
}

/** 区分ラベル。通常勤務だけは由来が分かるように固定文言にする。 */
function kindLabel(entry) {
  return entry.kind === 'default' ? '通常勤務' : entry.title;
}

/** 初期表示。 */
async function init() {
  el.openOptions.addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  el.previewBtn.addEventListener('click', runPreview);
  el.syncBtn.addEventListener('click', runSync);
  el.showUnchanged.addEventListener('change', renderDiff);
  el.monthSelect.addEventListener('change', () => {
    currentPreview = null;
    el.syncBtn.disabled = true;
    el.summaryPanel.hidden = true;
    showMessage('');
    updateCaptureMeta();
  });

  try {
    const status = await send(MSG.GET_STATUS);
    el.setupNotice.hidden = status.configured;
    captures = status.captures;
    targetUser = { userId: status.settings.targetUserId, name: status.targetUserName };

    if (captures.length === 0) {
      el.captureMeta.textContent =
        'シフトデータが未取得です。業務管理アプリのシフト画面を開き直すと自動で取り込みます。';
      el.previewBtn.disabled = true;
      return;
    }

    for (const capture of captures) {
      const option = document.createElement('option');
      option.value = capture.month;
      option.textContent = capture.month;
      el.monthSelect.append(option);
    }
    updateCaptureMeta();
  } catch (error) {
    showMessage(error.message, true);
  }
}

/** 選択中の月の取り込み情報を表示する。 */
function updateCaptureMeta() {
  const capture = captures.find((item) => item.month === el.monthSelect.value);
  if (!capture) {
    el.captureMeta.textContent = '';
    return;
  }
  const capturedAt = new Date(capture.capturedAt).toLocaleString('ja-JP');
  const lines = [`差分データ ${capture.recordCount} 件 / 取得日時 ${capturedAt}`];

  // レスポンスには全ユーザー分が含まれるため、誰の分を登録するのかを必ず見せる。
  if (targetUser.userId) {
    const label = targetUser.name ? `${targetUser.name}（${targetUser.userId}）` : targetUser.userId;
    lines.push(`対象ユーザー: ${label} / データ内 ${capture.userCount} 人分`);
  } else if (capture.userCount > 1) {
    lines.push(`${capture.userCount} 人分が含まれています。設定画面で対象ユーザーを選んでください。`);
  }
  el.captureMeta.textContent = lines.join('\n');
}

/** プレビューを生成する。 */
async function runPreview() {
  el.previewBtn.disabled = true;
  el.syncBtn.disabled = true;
  showMessage('差分を計算しています...');
  try {
    currentPreview = await send(MSG.BUILD_PREVIEW, { month: el.monthSelect.value });
    renderSummary();
    renderDiff();

    const { create, update, remove } = currentPreview.counts;
    const hasChanges = create + update + remove > 0;
    el.syncBtn.disabled = !hasChanges;

    const lines = hasChanges ? [] : ['変更はありません。'];
    lines.push(...currentPreview.warnings);
    showMessage(lines.join('\n'));
  } catch (error) {
    currentPreview = null;
    el.summaryPanel.hidden = true;
    showMessage(error.message, true);
  } finally {
    el.previewBtn.disabled = false;
  }
}

/** 同期を実行し、完了後に差分を再計算して結果を確認できるようにする。 */
async function runSync() {
  const { create, update, remove } = currentPreview.counts;
  const confirmed = window.confirm(
    `${currentPreview.month} のカレンダーを更新します。\n新規 ${create} / 更新 ${update} / 削除 ${remove}\n実行しますか？`,
  );
  if (!confirmed) return;

  const month = currentPreview.month;
  el.previewBtn.disabled = true;
  el.syncBtn.disabled = true;
  showMessage('カレンダーへ反映しています...');
  try {
    const result = await send(MSG.APPLY_SYNC, { month });
    const lines = [
      `同期が完了しました（新規 ${result.created} / 更新 ${result.updated} / 削除 ${result.removed}）。`,
    ];
    if (result.errors.length > 0) lines.push('', '失敗した項目:', ...result.errors);
    showMessage(lines.join('\n'), result.errors.length > 0);

    currentPreview = await send(MSG.BUILD_PREVIEW, { month });
    renderSummary();
    renderDiff();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    el.previewBtn.disabled = false;
    const counts = currentPreview?.counts;
    el.syncBtn.disabled = !counts || counts.create + counts.update + counts.remove === 0;
  }
}

/** 件数サマリを描画する。 */
function renderSummary() {
  el.summaryPanel.hidden = false;
  for (const [key, node] of Object.entries(el.counts)) {
    node.textContent = String(currentPreview.counts[key]);
  }
}

/** 差分テーブルを描画する。 */
function renderDiff() {
  if (!currentPreview) return;
  const { diff } = currentPreview;
  const withDay = (item) => ({ ...item, targetDay: item.entry.targetDay });
  const rows = [
    ...diff.create.map(withDay),
    ...diff.update.map(withDay),
    ...diff.remove,
    ...(el.showUnchanged.checked ? diff.unchanged.map(withDay) : []),
  ].sort((a, b) => a.targetDay.localeCompare(b.targetDay));

  const labels = { create: '新規', update: '更新', remove: '削除', unchanged: '-' };
  el.diffBody.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement('tr');
      tr.className = `op-${row.action}`;

      const day = document.createElement('td');
      day.textContent = row.targetDay
        ? `${row.targetDay.slice(5)}(${weekdayLabel(row.targetDay)})`
        : '-';

      const kind = document.createElement('td');
      kind.textContent = row.entry ? kindLabel(row.entry) : '（登録対象外）';

      const content = document.createElement('td');
      if (row.entry) content.append(formatRange(row.entry));
      if (row.before) {
        const before = document.createElement('span');
        before.className = 'before';
        before.textContent = formatBefore(row.before);
        content.append(before);
      }

      const op = document.createElement('td');
      op.className = 'op';
      op.textContent = labels[row.action];

      tr.append(day, kind, content, op);
      return tr;
    }),
  );
}

init();
