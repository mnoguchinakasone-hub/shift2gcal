/**
 * 日付ユーティリティ。
 *
 * タイムゾーンのズレを避けるため Date オブジェクトは使わず、
 * "YYYY-MM-DD" 文字列を数値計算だけで組み立てる。
 */

/** 月の日数を返す（month は 1〜12）。 */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "YYYY-MM" を { year, month } に分解する。不正な形式なら null。 */
export function parseMonth(month) {
  const matched = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!matched) return null;
  const year = Number(matched[1]);
  const monthNumber = Number(matched[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  return { year, month: monthNumber };
}

/** { year, month } を "YYYY-MM" に整形する。 */
export function formatMonth(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** 対象月の全日付を "YYYY-MM-DD" の配列で返す。 */
export function listMonthDays(year, month) {
  const total = daysInMonth(year, month);
  const days = [];
  for (let day = 1; day <= total; day += 1) {
    days.push(`${formatMonth(year, month)}-${String(day).padStart(2, '0')}`);
  }
  return days;
}

/** "YYYY-MM-DD" から "YYYY-MM" を取り出す。 */
export function monthOf(targetDay) {
  return typeof targetDay === 'string' ? targetDay.slice(0, 7) : '';
}

/** 翌日の "YYYY-MM-DD" を返す。終日イベントの end（排他的）用。 */
export function nextDay(targetDay) {
  const [year, month, day] = targetDay.split('-').map(Number);
  const total = daysInMonth(year, month);
  if (day < total) return `${formatMonth(year, month)}-${String(day + 1).padStart(2, '0')}`;
  if (month < 12) return `${formatMonth(year, month + 1)}-01`;
  return `${formatMonth(year + 1, 1)}-01`;
}

/** "YYYY-MM-DD" と "HH:MM" からタイムゾーン非依存のローカル日時文字列を作る。 */
export function localDateTime(targetDay, time) {
  return `${targetDay}T${normalizeTime(time)}:00`;
}

/** "9:00" や "0900" のような入力を "HH:MM" に正規化する。不正なら null。 */
export function normalizeTime(time) {
  const matched = /^(\d{1,2}):?(\d{2})$/.exec(String(time ?? '').trim());
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 曜日を日本語1文字で返す（"日"〜"土"）。 */
export function weekdayLabel(targetDay) {
  const [year, month, day] = targetDay.split('-').map(Number);
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return ['日', '月', '火', '水', '木', '金', '土'][index];
}

/** 翌月の "YYYY-MM" を返す。 */
export function nextMonth(month) {
  const parsed = parseMonth(month);
  if (!parsed) throw new Error(`対象月の形式が不正です: ${month}`);
  return parsed.month === 12
    ? formatMonth(parsed.year + 1, 1)
    : formatMonth(parsed.year, parsed.month + 1);
}

/** 前月の "YYYY-MM" を返す。 */
export function previousMonth(month) {
  const parsed = parseMonth(month);
  if (!parsed) throw new Error(`対象月の形式が不正です: ${month}`);
  return parsed.month === 1
    ? formatMonth(parsed.year - 1, 12)
    : formatMonth(parsed.year, parsed.month - 1);
}
