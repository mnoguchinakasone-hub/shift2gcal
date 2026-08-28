/**
 * Google OAuth アクセストークンの取得。
 *
 * Chrome拡張向けの chrome.identity.getAuthToken を使う。
 * client_id は manifest.json の oauth2.client_id に設定する。
 */

/** アクセストークンを取得する。interactive=true なら必要に応じて同意画面を出す。 */
export function getAccessToken({ interactive = true } = {}) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const error = chrome.runtime.lastError;
      if (error || !token) {
        reject(new Error(error?.message ?? 'Googleアカウントの認証に失敗しました。'));
        return;
      }
      resolve(token);
    });
  });
}

/** 失効したトークンをキャッシュから破棄する。401 を受けたときに呼ぶ。 */
export function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

/** 保存済みの認可を取り消す（オプション画面の「連携を解除」用）。 */
export async function revokeAccess() {
  let token;
  try {
    token = await getAccessToken({ interactive: false });
  } catch {
    return; // 未認証なら何もしない。
  }
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
  });
  await removeCachedToken(token);
}
