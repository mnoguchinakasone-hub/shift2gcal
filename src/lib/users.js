/**
 * ログイン中ユーザーの特定と、ユーザー候補の管理（純粋ロジック）。
 *
 * シフト画面のDOMからは次の2つが取れる。
 *   - サイドナビのログインユーザー表示 … 氏名は分かるが user_id は載っていない
 *   - シフト表の各行           … 氏名と user_id の対応が取れる
 * そのため「氏名で突き合わせて user_id を得る」のが基本の判定方法になる。
 *
 * DOMアクセスは content script 側に閉じ込め、ここでは抽出済みの値だけを扱う。
 */

/**
 * 氏名を比較用に正規化する。
 *
 * サイドナビは「山田　太郎」（全角スペース入り）、シフト表は「山田太郎」のように
 * 同じ人でも空白の有無が異なるため、空白をすべて落としてから比較する。
 */
export function normalizeName(name) {
  return String(name ?? '')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase();
}

/**
 * ログイン中のユーザーIDを決める。
 *
 * 判定の優先順位:
 *   1. selector … 利用者が設定したCSSセレクタから読めた値。明示指定なので最優先
 *   2. name     … サイドナビの氏名とシフト表の氏名が一致した行の user_id
 *   3. url      … 現在のURLに含まれる user_id
 *   4. single   … 画面に1人分しか出ていない場合はその1人
 *
 * url を name より下に置くのは、シフト表に他ユーザーの出勤簿へのリンクがあり、
 * そのURLにも user_id が載るため。氏名一致の方が「自分」を指す確度が高い。
 *
 * @param {object} params
 * @param {{userId: string, name: string}[]} params.candidates シフト表から集めた候補
 * @param {string[]} params.currentUserNames サイドナビのログインユーザー表示（氏名・英字名）
 * @param {string} params.selectorUserId 設定セレクタから読めた user_id
 * @param {string} params.urlUserId 現在のURLから読めた user_id
 * @returns {{ userId: string, source: 'selector'|'name'|'url'|'single'|'none' }}
 */
export function resolveCurrentUser({
  candidates = [],
  currentUserNames = [],
  selectorUserId = '',
  urlUserId = '',
} = {}) {
  if (selectorUserId) return { userId: String(selectorUserId), source: 'selector' };

  const matched = matchByName(candidates, currentUserNames);
  if (matched) return { userId: matched, source: 'name' };

  if (urlUserId) return { userId: String(urlUserId), source: 'url' };

  if (candidates.length === 1) return { userId: String(candidates[0].userId), source: 'single' };

  return { userId: '', source: 'none' };
}

/**
 * 氏名の一致する候補の user_id を返す。
 * 同じ氏名が複数居る場合は誰か特定できないため、一致なしとして扱う。
 */
function matchByName(candidates, currentUserNames) {
  const targets = currentUserNames.map(normalizeName).filter(Boolean);
  if (targets.length === 0) return '';

  for (const target of targets) {
    const hits = candidates.filter((candidate) => normalizeName(candidate.name) === target);
    if (hits.length === 1) return String(hits[0].userId);
    if (hits.length > 1) return ''; // 同姓同名。自動では決められない。
  }
  return '';
}

/**
 * 既知のユーザー候補に新しい候補をマージする。
 *
 * 別の月・別の部署を開いても既存の候補が消えないよう、user_id をキーに統合する。
 * 氏名は後から取れた方を優先し、空文字では上書きしない。
 */
export function mergeKnownUsers(existing, candidates) {
  const merged = new Map();
  for (const user of [...(existing ?? []), ...(candidates ?? [])]) {
    const userId = String(user?.userId ?? '').trim();
    if (!userId) continue;
    const name = String(user?.name ?? '').trim();
    const previous = merged.get(userId);
    merged.set(userId, { userId, name: name || previous?.name || '' });
  }
  return [...merged.values()].sort((a, b) => Number(a.userId) - Number(b.userId));
}
