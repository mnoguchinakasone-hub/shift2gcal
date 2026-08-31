# shift2gcal

**日時**: 2026年08月27日
**ステータス**: ドラフト

## 目的

業務管理アプリのシフト画面が受け取るAPIレスポンス（差分JSON）を取り込み、対象月の勤務予定を
Googleカレンダーへ同期するChrome拡張機能（Manifest V3）。

## 概要

画面のDOM解析ではなく、アプリのバックエンド通信に含まれる差分JSONを利用する。
「デフォルト ＋ 差分オーバーライド方式」で、対象月の全日付を生成したうえで差分がある日だけ内容を差し替える。

| シフト区分 | APIデータ (`type` / `work_start`) | カレンダー登録内容 |
| --- | --- | --- |
| 通常勤務 | 差分データに含まれない | 設定した既定時刻（初期値 09:00〜18:00） |
| 時間変更 | `work_input` / 時刻あり | `work_start` 〜 `work_end` |
| 半休 | `public_holiday_half_work` / 時刻あり | `work_start` 〜 `work_end`（午前/午後は時刻に従う） |
| 公休・定休 | `public_holiday` / `legal_holiday`、`work_start: null` | 終日イベント（設定でスキップ可） |

区分の判定は `type` の名称ではなく `work_start` / `work_end` の有無で行う。
未知の `type` が追加されても、時刻があれば時間指定イベント、無ければ終日イベントとして扱う。

### 対象ユーザーの絞り込み

シフト取得APIのレスポンスには画面上の**全ユーザー分**が含まれる。個人利用を前提とするため、
自分1人分だけを抽出してカレンダーに登録する。

対象ユーザーの `user_id` は、シフト画面を開いたときに content script がDOMから自動抽出する。
サイドナビのログインユーザー表示には氏名しか無く、`user_id` はシフト表側にしか無いため、
**氏名で突き合わせて `user_id` を得る**のが基本の判定方法になる。

読み取るDOM:

```html
<!-- サイドナビ: ログイン中のユーザー。氏名のみで user_id は無い -->
<li class="user_info_box">
  <a href="/users/user-setting" class="face_icon">山太</a>
  <p class="name_box">山田　太郎<br><small>YamadaTaro</small></p>
</li>

<!-- シフト表: 全ユーザー分。氏名と user_id の対応が取れる -->
<tr class="user_tr">
  <th class="actions user_label"><a href="...AttendanceDays[user_id]=1003">山田太郎</a></th>
  <td class="actions day_input" data-day="2026-10-01" data-user_id="1003">…
```

判定は次の優先順で行う。

| 優先 | 判定方法 | 内容 |
| --- | --- | --- |
| 1 | `selector` | 設定した「ログインユーザーのセレクタ」から読めた `user_id` |
| 2 | `name` | サイドナビの氏名と一致するシフト表の行の `user_id` |
| 3 | `url` | 現在のURLに含まれる `user_id`（`AttendanceDays[user_id]` 形式にも対応） |
| 4 | `single` | 画面に1人分しか出ていない場合はその1人 |

氏名の比較では空白をすべて無視する。サイドナビは「山田　太郎」（全角スペース入り）、
シフト表は「山田太郎」と表記が異なるため。氏名（`山田　太郎`）と英字名（`YamadaTaro`）の
両方で照合し、同姓同名が複数居る場合は特定できないものとして扱う。

`url` を `name` より下に置くのは、シフト表に他ユーザーの出勤簿へのリンクがあり、
そのURLにも `user_id` が載るため。同僚の画面を開いただけで対象が入れ替わらないよう、
`url` と `single` による判定は「まだ対象が決まっていないとき」に限って採用する。

一度決まった対象ユーザーを変更するときは設定画面で選び直す
（選び直すと以降は自動判定の対象外になる）。
対象ユーザーが未確定のままプレビューを実行すると、誤って全員分を登録しないようエラーになる。

メモ行（`tr.schedule_tr`）も `user_label` と `data-user_id` を持つが、
氏名リンクが無いため候補には入らない。

## 処理フロー

1. 業務管理アプリのシフト画面を開くと、content script がAPIレスポンスを取り込み、対象月ごとに保存する
2. ポップアップで対象月を選び「プレビュー」を押すと、対象月の全日付から登録プランを組み立てる
3. カレンダーの既存同期イベントを取得し、新規 / 更新 / 削除 / 変更なしの差分を表示する
4. 「同期を実行」で差分をGoogleカレンダーへ反映する

重複登録は拡張プロパティ（`source=shift2gcal`、`targetDay`、`hash`）で防ぐ。
拡張プロパティを持たない予定（手動で追加した予定）は同期の対象外なので、上書きも削除もされない。

## セットアップ

### 1. OAuthクライアントIDを発行する

`chrome.identity.getAuthToken` を使うため、Google Cloud側の設定が必要。

1. Google Cloud Console でプロジェクトを作成し、**Google Calendar API** を有効にする
2. OAuth同意画面を設定し、以下2つのスコープを追加する

   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/calendar.events`

3. 「認証情報」→「OAuth クライアント ID」→ アプリケーションの種類に **Chrome 拡張機能** を選び、
   拡張機能のIDを入力する
4. 発行されたクライアントIDを `manifest.json` の `oauth2.client_id` に設定する

`calendar.events` はイベントの読み書き用スコープで、カレンダー一覧の取得
（オプション画面の「Googleに接続してカレンダー一覧を取得」＝ `calendarList.list`）は対象外になる。
`calendar.events` だけだと以下のエラーになるため、`calendar` も併せて指定する。

```txt
Google Calendar API エラー (403): Request had insufficient authentication scopes.
```

スコープを変更した場合、既に発行済みのトークンには古いスコープが残る。
オプション画面の「Googleとの連携を解除」を実行してから、再度接続し直すこと。

未署名の拡張機能はIDが環境ごとに変わり、OAuthクライアントと結び付けられない。
IDの固定手順は「社内配布」の「1. 拡張機能IDを固定する」を参照。
先にIDを固定してから、そのIDでOAuthクライアントを作成すること。

### 2. 拡張機能を読み込む

1. Chromeで `chrome://extensions` を開き、「デベロッパーモード」をオンにする
2. 「パッケージ化されていない拡張機能を読み込む」でこのリポジトリのルートを選ぶ

### 3. 設定する

拡張機能の「設定」（オプション画面）で以下を入力する。

- **対象オリジン**: 業務管理アプリのURL（例: `https://example.co.jp/*`）。
  入力後に「このオリジンへのアクセスを許可」を押して権限を付与する
- **APIのURLフィルタ**（任意）: 取り込むAPIのURLに含まれる文字列。空欄ならレスポンスの形状だけで判定する
- **対象ユーザー**: シフト画面を開くと氏名の突き合わせで自動判定される。
  判定できなかった場合のみ、集まった候補の一覧から自分を選ぶ
- **ログインユーザーのセレクタ**（任意）: 画面構成が変わって自動判定できなくなった場合に、
  ログインユーザーの要素を指すCSSセレクタを指定する
- **通常勤務の既定値**: 差分データに無い日に使う始業・終業時刻と件名
- **カレンダー**: 「Googleに接続してカレンダー一覧を取得」で選択する

## 社内配布

Chrome Enterprise Core に登録した端末へ、自前ホスティングの `.crx` を強制インストールする。

### 前提条件

ウェブストア外の拡張機能を強制インストールするには、対象端末が次のいずれかを満たす必要がある。

- Microsoft Active Directory ドメインに参加している
- Microsoft Entra ID（旧 Azure AD）に参加している
- **Chrome Enterprise Core に登録されている**

3つ目は Admin console で発行した登録トークンを配布すれば満たせるため、
ドメイン参加していない端末でも対応できる。Chrome Enterprise Core の利用に追加料金はかからない。

Windows向けヘルプには「Active Directory ドメイン参加が必要」とだけ書かれた記述も残っており、
ドキュメント間で表現に差がある。**全社展開の前に実機1台で検証すること。**

### 1. 拡張機能IDを固定する

`.pem`（秘密鍵）から導出されるIDを固定し、開発時の unpacked 読み込みと配布物で
同じIDになるようにする。OAuthクライアントもこのIDで作成する。

```bash
# 1. chrome://extensions →「拡張機能をパッケージ化」で .crx と .pem を生成する
# 2. .pem から公開鍵を取り出す
openssl rsa -in shift2gcal.pem -pubout -outform DER | openssl base64 -A
```

出力された文字列を `manifest.json` の `key` に設定する。

`.pem` が漏れると第三者が同一IDの拡張機能を作成できるため、リポジトリには含めない
（`.gitignore` で除外済み）。紛失すると同じIDで更新を配布できなくなるので、
組織のパスワード管理などに保管する。

### 2. ホスティング先を決める

`.crx` と更新マニフェスト（`updates.xml`）を置く。URLのスキームは `http` / `https` / `file` が使える。

| 候補 | 可否 | 注意 |
| --- | --- | --- |
| GitHub Releases / Pages | ○ | **公開リポジトリのみ**。privateは認証が必要でChromeが取得できない |
| 社内ファイルサーバ（`file://`） | ○ | 全端末から同じパスで参照できること |
| 社内Webサーバ | ○ | HTTPS推奨 |
| Google Drive | ✗ | 直リンク配信とヘッダ制御ができない |

`.crx` を配信するときは Content-Type を `application/x-chrome-extension` または
`application/octet-stream` にし、`X-Content-Type-Options: nosniff` を付けないこと。

### 3. パッケージと更新マニフェストを作る

`manifest.json` に更新確認先を追加する（初回のみ）。

```json
"update_url": "https://example.com/ext/updates.xml"
```

リリースのたびに次を実行する。

```bash
# manifest.json の version を上げてから .crx を再パッケージ（1で作った .pem を指定する）
# updates.xml を生成する（version は manifest.json から読むのでズレない）
SHIFT2GCAL_EXTENSION_ID=<拡張機能ID> npm run updates-xml -- https://example.com/ext/shift2gcal-0.1.0.crx
```

生成した `.crx` と `updates.xml` をホスティング先へ配置する。

### 4. Admin console で強制インストールする

1. Admin console →「Chrome ブラウザ」→「アプリと拡張機能」→「ユーザーとブラウザ」
2. 右下の「＋」→「Chrome アプリまたは拡張機能をIDで追加」
3. 拡張機能IDを入力し、「カスタムURLから」を選んで `updates.xml` のURLを指定する
4. インストールポリシーを「強制インストール」または「強制インストール＋固定」にする

以降、Chromeが数時間おきに `updates.xml` を確認し、`version` が上がっていれば自動更新する。

## ディレクトリ構成

```txt
manifest.json          拡張機能の定義（MV3）
src/
  background/
    service-worker.js  メッセージルータ、取り込み保存、プレビュー生成、同期実行
  content/
    interceptor.js     MAIN world。fetch / XHR のJSONレスポンスを監視する
    bridge.js          ISOLATED world。取り込んだレスポンスを background へ中継する
    user-detect.js     ISOLATED world。DOMからユーザー候補とログインユーザーを抽出する
  lib/
    shift.js           差分JSON → 登録プラン（純粋ロジック）
    diff.js            登録プラン vs 既存イベントの差分計算（純粋ロジック）
    calendar.js        Google Calendar API v3 クライアント
    auth.js            OAuthトークンの取得・破棄
    config.js          設定の既定値とストレージ操作
    dates.js           日付ユーティリティ
    users.js           ログインユーザーの特定と候補の統合（純粋ロジック）
    hash.js            変更検知用の短いハッシュ
    messages.js        メッセージ種別の定数
  popup/               対象月の選択、差分プレビュー、同期実行
  options/             設定画面
test/                  純粋ロジックのテスト（node:test）
scripts/
  make-update-manifest.mjs  自前ホスティング用 updates.xml の生成
```

`shift.js` / `diff.js` / `users.js` は `chrome.*` とDOMに依存しないため、Node.js だけでテストできる。
content script はDOMから値を読むだけにとどめ、どれを採用するかの判定は `users.js` に寄せている。

## コマンド

```bash
# テスト
npm test

# 配布用の updates.xml を生成（社内配布の手順3を参照）
SHIFT2GCAL_EXTENSION_ID=<拡張機能ID> npm run updates-xml -- <crxのURL>
```

依存パッケージは無く、拡張機能自体にビルド手順も無い。`npm install` は不要。

## セキュリティ上の扱い

- 取り込んだシフトデータは `chrome.storage.local` に保存され、Googleカレンダー以外へは送信しない
- オプション画面の「取り込み済みシフトデータを消去」で保存内容を破棄できる
- ホスト権限は初期状態では Google API のみ。業務管理アプリへのアクセスは利用者が明示的に許可する
- `calendar` スコープはカレンダー自体の管理権限まで含む。拡張機能が実際に行うのは
  設定したカレンダーに対するイベントの参照・作成・更新・削除のみ

## 確認済みの方針

### 1. 対象アプリの情報をリポジトリに置かない

業務管理アプリの本番オリジンとシフト差分APIのパスは、セキュリティの観点から本リポジトリに保存しない。
どちらも設定画面で入力する形式とし、コードや設定ファイルには埋め込まない。

### 2. レスポンス内の複数ユーザーデータ

レスポンスには全ユーザー分が含まれる。「対象ユーザーの絞り込み」に記載のとおり、
DOMから自分の `user_id` を自動抽出し、一致する要素だけをカレンダー連携に回す。

### 3. ログインユーザーの判定

シフト画面の全文DOMで確認済み。サイドナビ（`.user_info_box .name_box`）に氏名が表示され、
シフト表（`tr.user_tr`）に氏名と `user_id` の対応がある。両者を氏名で突き合わせて特定する。
初回設定でのユーザーID入力は不要。

### 4. OAuth同意画面の公開範囲

**内部（社内・組織）** に設定済み。Google Workspace 組織のユーザーだけが認可でき、
Googleの審査（機密スコープの検証）も不要。

### 5. 想定規模

社内配布で、多くても数十名。Google Calendar API のクォータには十分収まる。

### 6. 配布方法

**Chrome Enterprise Core（無料）＋ 自前ホスティングの強制インストール**を採用する。
利用者側の操作は不要で、自動更新も効く。ウェブストアの登録料もかからない。

`.crx` を配って各自がインストールする方式は採用できない。Chrome は Windows / macOS で
ウェブストア以外からの拡張機能インストールをブロックしており、`chrome://extensions` へ
ドラッグしても追加できないため。ウェブストア外の配布は企業ポリシー経由に限られる。

手順は「社内配布」を参照。


## ヒアリングが必要な項目（不明事項リスト）

### 1. 配布の実施

方式は決定済み（「6. 配布方法」）。展開前に確認・決定が必要なもの。

- [ ] ウェブストア外の強制インストールが対象端末で実際に動くか（**要検証**）
  - AD / Entra ID 参加なしの端末では Chrome Enterprise Core への登録が必要
  - ドキュメント間で要件の記述に差があるため、実機1台で先に確認する
- [ ] `.crx` と `updates.xml` のホスティング先（**要決定**）
- [ ] `.pem`（署名用の秘密鍵）の保管場所と管理者

---

**作成日**: 2026-08-27
**最終更新**: 2026-08-29
**ステータス**: ドラフト
