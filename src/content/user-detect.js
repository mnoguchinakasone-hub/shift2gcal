/**
 * ISOLATED world。シフト画面のDOMからユーザー候補とログインユーザーの手がかりを抽出する。
 *
 * シフト取得APIのレスポンスには画面上の全ユーザー分が含まれるため、
 * カレンダーへ登録する前に「自分の user_id」を特定する必要がある。
 *
 * 実際のDOM構造:
 *   サイドナビ（ログイン中のユーザー。氏名のみで user_id は無い）
 *     <li class="user_info_box">
 *       <a href="/users/user-setting" class="face_icon">山太</a>
 *       <p class="name_box">山田　太郎<br><small>YamadaTaro</small></p>
 *     </li>
 *
 *   シフト表（全ユーザー分。氏名と user_id の対応が取れる）
 *     <tr class="user_tr">
 *       <th class="actions user_label"><a href="...AttendanceDays[user_id]=1003">山田太郎</a></th>
 *       <td class="actions day_input" data-day="2026-10-01" data-user_id="1003">…
 *
 * ここではDOMから値を読むだけで、どれを採用するかの判定は background 側（lib/users.js）が行う。
 */
(() => {
  /** messages.js の MSG.USERS_DETECTED と同じ値（content script はモジュールにできない）。 */
  const MESSAGE_TYPE = 'users-detected';

  /** サイドナビのログインユーザー表示。 */
  const CURRENT_USER_SELECTOR = '.user_info_box .name_box';

  /** URLに現れる user_id のパラメータ名。CakePHP風の `Model[user_id]` 形式にも対応する。 */
  const USER_ID_PARAM = /(?:^|\[)user_id(?:\]|$)/i;

  /** 同じ内容を何度も送らないための直近の送信内容。 */
  let lastSent = '';

  /** 文字列から user_id らしき数値を取り出す。 */
  const userIdFrom = (value) => {
    const matched = /(\d+)/.exec(String(value ?? ''));
    return matched ? matched[1] : '';
  };

  /** URL（絶対・相対どちらも可）のクエリから user_id を取り出す。 */
  const userIdFromUrl = (value) => {
    if (!value) return '';
    let url;
    try {
      url = new URL(value, window.location.href);
    } catch {
      return '';
    }
    for (const [key, param] of url.searchParams) {
      if (USER_ID_PARAM.test(key)) return userIdFrom(param);
    }
    return '';
  };

  /**
   * シフト表の各行からユーザー候補（氏名と user_id）を集める。
   *
   * メモ行（`tr.schedule_tr`）も `user_label` と `data-user_id` を持つが、
   * 氏名リンクが無いため候補には入らない。
   */
  const collectCandidates = () => {
    const candidates = new Map();
    const rows = document.querySelectorAll('tr.user_tr, tr:has(.user_label a[href*="user_id"])');

    for (const row of rows) {
      const link = row.querySelector('.user_label a');
      if (!link) continue;
      const cell = row.querySelector('[data-user_id]');
      const userId =
        userIdFrom(cell?.dataset.user_id) || userIdFromUrl(link.getAttribute('href'));
      if (!userId) continue;

      const name = link.textContent.trim();
      const existing = candidates.get(userId);
      candidates.set(userId, { userId, name: name || existing?.name || '' });
    }

    return [...candidates.values()];
  };

  /**
   * サイドナビからログイン中のユーザーの表示名を読む。
   * `<p class="name_box">山田　太郎<br><small>YamadaTaro</small></p>` から
   * 「山田　太郎」と「YamadaTaro」の2つを取り出す。
   */
  const readCurrentUserNames = () => {
    const box = document.querySelector(CURRENT_USER_SELECTOR);
    if (!box) return [];

    const names = [];
    // <small> より前のテキストノードが氏名。
    const primary = [...box.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .filter(Boolean)
      .join('');
    if (primary) names.push(primary);

    const secondary = box.querySelector('small')?.textContent.trim();
    if (secondary) names.push(secondary);

    return names;
  };

  /** 設定されたセレクタが指す要素から user_id を読む（自動判定できない場合の逃げ道）。 */
  const readSelectorUserId = (selector) => {
    if (!selector) return '';
    let node;
    try {
      node = document.querySelector(selector);
    } catch {
      return ''; // セレクタが不正な場合は無視する。
    }
    if (!node) return '';
    return (
      userIdFrom(node.dataset?.user_id) ||
      userIdFromUrl(node.getAttribute?.('href')) ||
      userIdFrom(node.textContent)
    );
  };

  /** 抽出結果を background へ送る。内容が変わらなければ送らない。 */
  const report = async () => {
    let selector = '';
    try {
      const stored = await chrome.storage.sync.get('settings');
      selector = stored.settings?.currentUserSelector ?? '';
    } catch {
      return; // 拡張機能が再読み込みされた直後などは諦める。
    }

    const candidates = collectCandidates();
    if (candidates.length === 0) return;

    const message = {
      type: MESSAGE_TYPE,
      candidates,
      currentUserNames: readCurrentUserNames(),
      selectorUserId: readSelectorUserId(selector),
      urlUserId: userIdFromUrl(window.location.href),
      pageUrl: window.location.href,
    };

    const signature = JSON.stringify(message);
    if (signature === lastSent) return;
    lastSent = signature;

    chrome.runtime.sendMessage(message).catch(() => {
      // service worker 停止中などは取りこぼす。次の描画で再送される。
    });
  };

  /** 描画が落ち着いてから走らせるための簡易デバウンス。 */
  let timer = null;
  const scheduleReport = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      report().catch(() => {});
    }, 400);
  };

  scheduleReport();

  // シフト表は月切り替え時に非同期で描き替わるため監視する。
  new MutationObserver(scheduleReport).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
