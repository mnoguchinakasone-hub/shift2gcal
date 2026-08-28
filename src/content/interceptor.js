/**
 * ページのMAIN worldで動き、fetch / XMLHttpRequest のJSONレスポンスを覗き見る。
 *
 * この world では chrome.* が使えないため、条件に合うレスポンスだけを
 * window.postMessage で ISOLATED world のブリッジへ渡す。
 * 通信内容の書き換えは行わず、元の Promise / イベントはそのまま呼び出し元へ返す。
 */
(() => {
  const PAGE_MESSAGE_SOURCE = 'shift2gcal-interceptor';
  const MAX_BODY_LENGTH = 5_000_000; // 巨大レスポンスの解析は諦める（メモリ保護）。

  /** シフト差分レコードらしさの簡易判定。詳細な抽出は background 側で行う。 */
  const looksLikeShiftRecord = (value) =>
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.target_day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.target_day) &&
    'type' in value;

  /** 再帰的に走査し、レコードらしいオブジェクトが1つでもあれば true。 */
  const containsShiftRecord = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 6) return false;
    if (looksLikeShiftRecord(node)) return true;
    return Object.values(node).some((child) => containsShiftRecord(child, depth + 1));
  };

  const report = (url, text) => {
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_BODY_LENGTH) return;
    const trimmed = text.trimStart();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return; // JSONでなければ対象外。
    }
    if (!containsShiftRecord(payload)) return;

    window.postMessage(
      { source: PAGE_MESSAGE_SOURCE, url: String(url), payload, capturedAt: Date.now() },
      window.location.origin,
    );
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function patchedFetch(...args) {
      return originalFetch.apply(this, args).then((response) => {
        // clone しないと呼び出し元がボディを読めなくなる。
        try {
          const url = response.url || (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
          response
            .clone()
            .text()
            .then((text) => report(url, text))
            .catch(() => {});
        } catch {
          // 監視に失敗しても本来のレスポンスは壊さない。
        }
        return response;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__shift2gcalUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === '' || this.responseType === 'text') {
          report(this.responseURL || this.__shift2gcalUrl, this.responseText);
        } else if (this.responseType === 'json' && this.response) {
          report(this.responseURL || this.__shift2gcalUrl, JSON.stringify(this.response));
        }
      } catch {
        // 監視に失敗しても本来の処理は続行する。
      }
    });
    return originalSend.apply(this, args);
  };
})();
