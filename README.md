<div align="center">

<img src="icons/icon-96.png" width="96" height="96" alt="Twitter Media Downloader">

# Twitter Media Downloader

**Twitter/X のメディアをワンクリックでダウンロード**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Firefox](https://img.shields.io/badge/Firefox-Manifest%20V2-FF7139?logo=firefox-browser&logoColor=white)](https://www.mozilla.org/firefox/)
[![Version](https://img.shields.io/badge/version-1.0-1DA1F2)](manifest.json)

</div>

---

## Features

| Feature | Description |
|---------|-------------|
| **画像ダウンロード** | ツイートの画像をオリジナル画質でダウンロード |
| **動画ダウンロード** | 最高ビットレートのMP4を自動選択 |
| **複数画像 → ZIP** | 2枚以上の画像は自動でZIPにまとめて保存 |
| **GIF対応** | アニメーションGIF(MP4形式)もダウンロード可能 |
| **スマートなファイル名** | `ユーザー名-ツイートID-日時.拡張子` 形式 |

## How It Works

```
Twitter GraphQL API ──→ Background Script ──→ メディアURL抽出
                              │
                              ▼
                        Content Script ──→ DLボタン表示
                              │
                              ▼
                         クリック時 ──→ 個別DL or ZIP生成
```

1. **APIインターセプト** — Twitter/XのGraphQL APIレスポンスをバックグラウンドで傍受し、メディア情報を抽出
2. **ボタン注入** — 画像・動画を含むツイートのアクションバーにダウンロードボタンを自動追加
3. **ダウンロード実行** — ワンクリックで全メディアをダウンロード。複数画像はZIPで一括保存

## Install

### 開発版（一時的なアドオン）

1. このリポジトリをクローンまたはダウンロード
   ```bash
   git clone https://github.com/dekotan24/twitter-media-downloader.git
   ```
2. Firefox で `about:debugging#/runtime/this-firefox` を開く
3. 「一時的なアドオンを読み込む」→ `manifest.json` を選択

## File Structure

```
twitter-media-downloader/
├── manifest.json      # 拡張機能マニフェスト (Manifest V2)
├── background.js      # GraphQL API傍受 + ダウンロード処理
├── content.js         # DLボタン注入 + UI制御
├── content.css        # ボタンスタイル
├── jszip.min.js       # ZIP生成ライブラリ
├── icons/
│   ├── icon-48.png
│   └── icon-96.png
└── LICENSE
```

## Download Format

| コンテンツ | ファイル形式 | ファイル名例 |
|-----------|------------|------------|
| 画像 (1枚) | JPG / PNG | `user-123456-20260218_143000.jpg` |
| 画像 (複数) | ZIP | `user-123456-20260218_143000.zip` |
| 動画 | MP4 | `user-123456-20260218_143000.mp4` |
| GIF | MP4 | `user-123456-20260218_143000.mp4` |

## Requirements

- Firefox Developer Edition / Firefox ESR
- Manifest V2 対応（`webRequest.filterResponseData` を使用）

## License

[MIT](LICENSE)
