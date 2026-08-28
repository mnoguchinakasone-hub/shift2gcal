/**
 * 変更検知用の短いハッシュ。暗号用途ではない。
 * djb2 を32bitで回し、符号なし16進文字列にする。
 */
export function shortHash(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
