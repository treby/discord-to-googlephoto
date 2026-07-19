# discord-to-googlephoto

<img src="assets/discord-icon.png" alt="アプリアイコン" width="128" align="right">

特定のDiscordチャンネルに投稿された画像・動画を、自動でGoogle Photosの指定アルバムにアップロードし、
成功したらメッセージに絵文字リアクションを付けるBotです。

個人利用（自分のGoogleアカウント1つ・自分のDiscordサーバー1つ）を前提とした最小構成です。
常時起動プロセスとして動かします（VPS / PaaS想定）。

## 動作の流れ

1. 対象チャンネルの `messageCreate` を監視
2. 添付ファイルのうち `image/jpeg` / `image/png` / `image/webp` / `image/gif` / `video/mp4` / `video/quicktime` / `video/webm` を対象に取得
3. Google Photos Library APIの2ステップ（bytes upload → `mediaItems.batchCreate`）でアルバムへ追加
4. 全て成功 → ✅ リアクション、1つでも失敗 → ❌ リアクション + エラーログ出力

## 必要環境

- Node.js 20 LTS以上

## セットアップ手順

### 1. Discord側の準備

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成し、**Bot** を追加してトークンを取得する
2. Botの **Privileged Gateway Intents** で **Message Content Intent** を有効化する
   （コード上で要求するIntents: `Guilds`, `GuildMessages`, `MessageContent`, `GuildMessageReactions`）
3. OAuth2 URL Generatorで `bot` スコープを選択し、以下の権限を付けて自分のサーバーへ招待する
   - View Channels（メッセージ閲覧）
   - Read Message History（履歴閲覧）
   - Add Reactions（リアクション追加）
4. 対象チャンネルのIDを控える（Discordの設定で開発者モードを有効にし、チャンネル右クリック → 「IDをコピー」）
5. (任意) アプリのアイコンを設定する（**General Information** → **APP ICON** に `assets/discord-icon.png` をアップロード → **Save Changes**）

### 2. Google側の準備

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成する
2. **Photos Library API** を有効化する
3. **OAuth同意画面** を作成する
   - User Type: **External**、公開ステータス: **Testing** のままでよい（本番公開審査は不要）
   - **テストユーザー** に自分のGoogleアカウントを登録する
   - 注意: Testingステータスのリフレッシュトークンは通常7日で失効しません（`photoslibrary` は機密スコープ扱いのため失効する場合があります）。トークンが失効した場合は再度 `npm run get-refresh-token` を実行してください
4. **OAuthクライアントID** を作成する（アプリケーションの種類: **デスクトップアプリ**）
   - client_id / client_secret を控える

### 3. プロジェクトのセットアップ

```bash
npm install
cp .env.example .env
```

`.env` にDiscordのBotトークン・チャンネルID、Googleのclient_id / client_secretを記入します。

### 4. リフレッシュトークンの取得（初回のみ）

```bash
npm run get-refresh-token
```

- コンソールに表示されるURLをブラウザで開き、テストユーザー登録したGoogleアカウントで認可します
- 「このアプリはGoogleで確認されていません」と警告が出た場合は「続行」を選択します
- 認可後、localhostへ自動リダイレクトされ、コンソールに refresh_token が表示されます
- 表示された値を `.env` の `GOOGLE_REFRESH_TOKEN` に転記します

要求するスコープは `photoslibrary.appendonly` のみです（最小権限）。

### 5. アップロード先アルバムの作成

```bash
npm run create-album -- "Discordアップロード"
```

- 作成されたアルバムIDがコンソールに表示されるので、`.env` の `GOOGLE_PHOTOS_ALBUM_ID` に転記します
- **重要**: Google Photos APIの制約上、APIでアイテムを追加できるのは「このアプリ自身が作成したアルバム」のみです。Google Photosアプリで手動作成した既存アルバムのIDは使えないため、必ずこのスクリプトで作成してください

### 6. 起動

```bash
# 開発時
npm run dev

# 本番 (pm2想定)
npm run build
pm2 start dist/index.js --name discord-to-googlephoto
```

## 環境変数一覧

| 変数名 | 説明 |
| --- | --- |
| `DISCORD_BOT_TOKEN` | DiscordのBotトークン |
| `DISCORD_TARGET_CHANNEL_ID` | 監視対象チャンネルのID |
| `DISCORD_SUCCESS_EMOJI` | 成功時リアクション（デフォルト: ✅） |
| `DISCORD_ERROR_EMOJI` | 失敗時リアクション（デフォルト: ❌） |
| `GOOGLE_CLIENT_ID` | GoogleのOAuthクライアントID |
| `GOOGLE_CLIENT_SECRET` | GoogleのOAuthクライアントシークレット |
| `GOOGLE_REFRESH_TOKEN` | `npm run get-refresh-token` で取得した値 |
| `GOOGLE_PHOTOS_ALBUM_ID` | `npm run create-album` で作成したアルバムのID |
| `LOG_LEVEL` | (任意) `debug` / `info` / `warn` / `error`。デフォルト: `info` |

## エラーハンドリング

- Google APIの一時的なエラー（5xx / 429）は最大2回まで指数バックオフでリトライします
- 認証エラー（401）はリトライせず即座にエラーリアクションになります
- 200MBを超える添付はエラー扱いでスキップし、ログに残します（Google Photos APIのuploadMedia制約）
- イベントハンドラ内の例外はすべて捕捉し、Botのgateway接続は維持されます

## 動画アップロードに関する注意

- 数分程度のスマホ動画でもファイルサイズ次第では**Discord側の添付ファイルサイズ上限**（サーバーのブーストレベルやNitroの有無で数十MB〜数百MB）に先に引っかかり、そもそもDiscordに投稿できないことがあります。上限はサーバー設定を確認してください
- Google Photos側では動画のアップロード後にエンコード処理が走るため、`mediaItems.batchCreate` のレスポンス自体は成功していても、実際にGoogle Photosアプリで再生可能になるまで数秒〜数十秒かかる場合があります

## スコープ外（やらないこと）

- Google Photosの既存ライブラリの読み取り・検索（API制約上も非対応）
- 複数サーバー・複数チャンネル・複数アルバムへの動的振り分け
- WebダッシュボードやコマンドUI
- OAuth同意画面の本番公開申請

## 動作確認チェックリスト（Definition of Done）

- [ ] `.env` を正しく設定した状態で `npm run dev` を実行すると、ログに `Discord bot is ready` が出力される
- [ ] 対象チャンネルに画像を1枚投稿すると、数秒以内にGoogle Photosの指定アルバムに追加され、メッセージに ✅ が付く
- [ ] 画像を複数枚同時に投稿すると、全てアルバムに追加され ✅ が付く
- [ ] 動画（mp4/mov/webm）を1本投稿すると、Google Photosの指定アルバムに追加され、メッセージに ✅ が付く
- [ ] 画像・動画以外の添付（PDF等）やテキストのみのメッセージには何も起きない
- [ ] 対象外チャンネルへの画像投稿には何も起きない
- [ ] `.env` の `GOOGLE_REFRESH_TOKEN` を意図的に壊して再起動し画像を投稿すると、❌ が付き、ログにエラー内容（401）が出力される
- [ ] `GOOGLE_PHOTOS_ALBUM_ID` を不正な値にして画像を投稿すると、❌ が付き、ログにエラー内容が出力される
