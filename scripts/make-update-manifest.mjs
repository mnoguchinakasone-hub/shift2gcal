/**
 * 自前ホスティング用の更新マニフェスト（updates.xml）を生成する。
 *
 * バージョンは manifest.json から読むため、拡張機能側と食い違わない。
 *
 * 使い方:
 *   node scripts/make-update-manifest.mjs <crxのURL> [出力先]
 *
 * 例:
 *   node scripts/make-update-manifest.mjs https://example.com/ext/shift2gcal-0.1.0.crx
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = new URL('../', import.meta.url);

/** XMLの属性値に埋め込めるようエスケープする。 */
function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (char) => {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char];
  });
}

/** 拡張機能IDの形式（a〜p の32文字）。 */
const EXTENSION_ID = /^[a-p]{32}$/;

function main() {
  const [crxUrl, outPath = 'updates.xml'] = process.argv.slice(2);

  if (!crxUrl) {
    console.error('使い方: node scripts/make-update-manifest.mjs <crxのURL> [出力先]');
    process.exit(1);
  }
  if (!/^(https?|file):/.test(crxUrl)) {
    console.error(`crxのURLは http / https / file のいずれかで指定してください: ${crxUrl}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8'));
  const extensionId = process.env.SHIFT2GCAL_EXTENSION_ID ?? '';

  if (!EXTENSION_ID.test(extensionId)) {
    console.error(
      '環境変数 SHIFT2GCAL_EXTENSION_ID に拡張機能ID（a〜pの32文字）を設定してください。\n' +
        'IDは chrome://extensions で確認できます。',
    );
    process.exit(1);
  }

  const xml = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${escapeXml(extensionId)}'>
    <updatecheck codebase='${escapeXml(crxUrl)}' version='${escapeXml(manifest.version)}' />
  </app>
</gupdate>
`;

  // 出力先は実行時のカレントディレクトリ基準で解決する（絶対パスもそのまま使える）。
  const outFile = resolve(process.cwd(), outPath);
  writeFileSync(outFile, xml, 'utf8');
  console.log(`${outFile} を生成しました（version ${manifest.version}）。`);
}

main();
