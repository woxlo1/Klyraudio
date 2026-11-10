# Klyraudio

**ローカルファーストの AI オーディオ制作スタジオ。** 音声の生成、編集、アレンジ、
書き出しをすべて自分のコンピューター上で行います。音声、プロンプト、プロジェクト、
モデルは端末の外へ送信されません。

Klyraudio は GNU GPL v3.0 only の自由ソフトウェアです。ループバック限定の
ローカルサービスが配信する Web アプリとしても、そのサービスを自動で管理する
Electron デスクトップアプリとしても動作します。

[English README](README.md)

> **状態:** 初期開発中（`0.1.0`）。内蔵の Sketch エンジン、編集、マルチトラック
> アレンジ、レンダリング、書き出しは一通り動作します。ニューラルモデルは実装済み
> ですが、任意の Python パッケージとモデルのダウンロードが必要です。

## できること

- **音声を生成**: 内蔵の **Klyraudio Sketch** DSP エンジンを搭載。ルールベースで
  依存パッケージが不要、AI ではないことを明示しています。Klyraudio が動く環境なら
  オフラインでも動作します。
- **ニューラルモデルで生成**: MusicGen Small/Medium、Stable Audio Open 1.0 を、
  明示的な操作・チェックサム検証つきでダウンロードして利用できます。モデルの重みは
  同梱していません。
- **ジョブのキューと監視**: モデルアダプターが報告する実際の進捗、キャンセル、
  再試行、明確なエラー表示に対応します。
- **非破壊編集**: トリム、分割、結合、無音挿入、フェードイン/アウト、ゲイン、
  ノーマライズ、リバース、ループ用クロスフェード。操作ごとに新しいアセットを作成し
  履歴を記録します。元の音声は上書きしません。
- **マルチトラックプロジェクト**: トラック（音量、パン、ミュート、ソロ）と
  クリップ（ゲイン、フェード）、任意のマスター EQ/エフェクトとノーマライズ、
  自動保存、明示的な保存、ドライミックスのレンダリングに対応します。
- **書き出し**: WAV、FLAC、AIFF はオフラインで書き出せます。FFmpeg と必要な
  エンコーダーがあれば MP3、Ogg Vorbis、Opus、AAC、M4A にも対応します。
  書き出したファイルはデコードして検証してから成功を報告します。
- **ローカルライブラリ**: タグ、検索、絞り込み、波形プレビュー、ストレージ使用量の
  確認に対応します。
- **英語と日本語**: 日本語の翻訳が欠けている場合は英語で表示されます。

## ローカルファーストの設計

- サービスは `127.0.0.1` にのみバインドし、運用者が明示的に
  `KLYRAUDIO_ALLOW_LAN=1` を設定しない限りループバック以外では待ち受けません。
- テレメトリー、解析、アカウント、クラウド同期はありません。設定 API は
  テレメトリーを有効にしようとする要求を拒否します。
- ループバック以外のオリジンからの要求はミドルウェアが拒否し、CORS もループバック
  オリジンに限定しています。
- ネットワーク通信は、利用者自身が開始する Hugging Face からの任意のモデル
  ダウンロードだけです。
- データベースは SQLite です。生成音声、インポート、レンダリング、書き出しは
  Klyraudio のデータディレクトリに保存されます。

## アーキテクチャ

```text
apps/web        React 18 + TypeScript + Vite の UI（Web とデスクトップで共通）
apps/desktop    Electron シェル: サービスのライフサイクル、セキュリティ、preload API
services/api    Python FastAPI サービス: REST API、SQLite、ジョブ、DSP、書き出し
  klyraudio_api/
    models/     モデルレジストリ、ダウンロード管理、アダプター、Sketch エンジン
```

ブラウザーとデスクトップアプリは同じ UI を使います。Web モードでは同一オリジンの
`/api` と通信します。デスクトップモードでは Electron が Python サービスを
`127.0.0.1:8765`（開発時）または空きループバックポート（パッケージ版）で起動し、
ヘルスチェックの成功後に UI を読み込みます。

境界とデータフローの詳細は [docs/architecture.md](docs/architecture.md) を参照して
ください。

## 必要なもの

- **Node.js 22.22 以上**と npm 10 以上。
- ローカルサービス用の **Python 3.10 以上**（3.11 または 3.12 を推奨）。
- **任意:** 圧縮形式のインポートと MP3/Ogg/Opus/AAC/M4A の書き出しには
  FFmpeg と FFprobe。WAV、FLAC、AIFF は FFmpeg なしで動作します。
- **任意:** ニューラルモデル用の NVIDIA GPU（CUDA）または Apple Silicon GPU
  （MPS）。Sketch エンジンに GPU は不要です。

モデルの重みは同梱していません。初回のディスク使用量は小さく、ニューラルモデルを
追加するとデータディレクトリに約 3.5 GB〜12.2 GB が加わります。

## クイックスタート（開発）

```bash
git clone https://github.com/woxlo1/Klyraudio.git
cd Klyraudio

# Python サービス
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r services/api/requirements.txt

# Web UI の依存関係
npm install
```

2 つのターミナルで API と Web UI を起動します。

```bash
npm run api:dev
npm run dev
```

<http://127.0.0.1:5173> を開きます。Vite は `/api` を
`http://127.0.0.1:8765` にプロキシします。

デスクトップアプリは 1 コマンドで起動できます（Vite と Python サービスも起動）。

```bash
npm run dev:desktop
```

デスクトップ開発ではポート `8765` が空いている必要があります。Vite のプロキシを
有効に保つため、ランチャーはポートを黙って変更せずエラーにします。

## 本番の Web モード

UI をビルドし、API から配信します。

```bash
npm run build
python -m pip install -e services/api   # 初回のみ。klyraudio-api コマンドが入ります
klyraudio-api --open-browser
```

インストールせずに起動する場合:

```bash
python -m uvicorn klyraudio_api.app:create_app --factory \
  --host 127.0.0.1 --port 8765 --app-dir services/api
```

サービスは `apps/web/dist` を `/` にマウントし、API を `/api` 以下で公開します。
主なオプション:

```text
--host 127.0.0.1      バインド先（既定はループバック）
--port 8765           ポート
--data-dir PATH       データディレクトリの上書き
--no-workers          ジョブキューを処理せず API のみ起動
--open-browser        起動後に UI を開く
```

## デスクトップビルド

```bash
npm run build          # 先に Web UI をビルド
npm run build:desktop  # electron-builder --dir（展開済みアプリ）
npm run dist --workspace @klyraudio/desktop  # インストーラー
```

パッケージ版にはビルド済み UI と Python API のソースが含まれますが、モデルの重みは
含まれません。利用者側に API の依存関係を満たす Python 環境が必要です。
`KLYRAUDIO_PYTHON` で使用するインタープリターを指定できます。プラットフォームの
署名と公証は設定していません。署名されていないビルドを署名済みリリースとして扱わないで
ください。

## モデルとライセンス

Klyraudio はモデルのライセンスを表示し、ダウンロード前に確認を求めます。モデル
ファイルはローカルのデータディレクトリに保存され、モデルマネージャーから削除できます。

| モデル | ダウンロード | ライセンス | 商用利用 |
| --- | --- | --- | --- |
| Klyraudio Sketch | 内蔵 | GPL-3.0-only | 可 |
| MusicGen Small | 約 3.5 GB | CC BY-NC 4.0（重み）、MIT（コード） | 不可 |
| MusicGen Medium | 約 12.2 GB | CC BY-NC 4.0（重み）、MIT（コード） | 不可 |
| Stable Audio Open 1.0 | 約 10.5 GB、ゲート付き | Stability AI Community License | 条件付き |

詳細は [docs/models.md](docs/models.md) と [NOTICE.md](NOTICE.md) を参照して
ください。生成された音声は自動的に GPL-3.0 になるわけではありません。出力には
モデルのライセンスと入力素材が適用されます。

## データの保存場所

| プラットフォーム | 既定のディレクトリ |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Klyraudio` |
| macOS | `~/Library/Application Support/Klyraudio` |
| Linux | `$XDG_DATA_HOME/klyraudio` または `~/.local/share/klyraudio` |

`KLYRAUDIO_DATA_DIR` または `--data-dir` で変更できます。ディレクトリには
`klyraudio.sqlite3`、`config.json`、`media/`、`imports/`、`projects/`、
`exports/`、`models/`、`logs/` が含まれます。

## 開発時のチェック

```bash
npm run typecheck
npm run lint
npm run test
npm run format:check
npm run build

# バックエンド（仮想環境を有効化してから）
python -m pytest services/api/tests -q
python -m ruff check services/api
```

## ドキュメント

- [開発者向けセットアップ](docs/development.md)
- [アーキテクチャ](docs/architecture.md)
- [モデルとライセンス](docs/models.md)
- [音声編集](docs/editing.md)
- [書き出し形式](docs/export.md)
- [インストール](docs/installation.md)
- [ハードウェア要件](docs/hardware.md)
- [トラブルシューティング](docs/troubleshooting.md)
- [コントリビューション](CONTRIBUTING.md)
- [セキュリティポリシー](SECURITY.md)

## ライセンス

Klyraudio は **GNU General Public License version 3 only** で提供されます。
[LICENSE](LICENSE) を参照してください。サードパーティ製コンポーネントとモデルの
ライセンスは [NOTICE.md](NOTICE.md) に記載しています。
