/** 拡張機能内で使うメッセージ種別。 */
export const MSG = {
  /** content script → background: APIレスポンスを取り込んだ */
  CAPTURED: 'captured',
  /** content script → background: DOMからユーザー候補・ログインユーザーを抽出した */
  USERS_DETECTED: 'users-detected',
  /** popup → background: 取り込み状況の取得 */
  GET_STATUS: 'get-status',
  /** popup → background: 差分プレビューの生成 */
  BUILD_PREVIEW: 'build-preview',
  /** popup → background: 同期の実行 */
  APPLY_SYNC: 'apply-sync',
  /** options → background: 対象オリジンへのスクリプト登録 */
  REGISTER_ORIGIN: 'register-origin',
  /** options → background: カレンダー一覧の取得 */
  LIST_CALENDARS: 'list-calendars',
  /** options → background: Google連携の解除 */
  REVOKE_AUTH: 'revoke-auth',
  /** options → background: 取り込み済みシフトデータの破棄 */
  CLEAR_CAPTURES: 'clear-captures',
};

/** ページ側（MAIN world）から content script へ渡すときの識別子。 */
export const PAGE_MESSAGE_SOURCE = 'shift2gcal-interceptor';
