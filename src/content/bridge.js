/**
 * ISOLATED world の中継役。
 * MAIN world の interceptor が postMessage したレスポンスを background へ転送する。
 */
(() => {
  const PAGE_MESSAGE_SOURCE = 'shift2gcal-interceptor';

  window.addEventListener('message', (event) => {
    // 同一ウィンドウ・同一オリジンからのメッセージだけを受け取る。
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== PAGE_MESSAGE_SOURCE) return;

    // content script はモジュールとして読み込めないため、
    // messages.js の MSG.CAPTURED をリテラルで持つ（値を変えるときは両方を直す）。
    chrome.runtime
      .sendMessage({
        type: 'captured',
        url: data.url,
        payload: data.payload,
        capturedAt: data.capturedAt,
      })
      .catch(() => {
        // service worker 停止中などは取りこぼす。次回のAPI呼び出しで再取得される。
      });
  });
})();
