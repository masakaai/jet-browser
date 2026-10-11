<p align="center">
  <img width="100%" src="./docs/assets/jet-browser-banner.svg" alt="Jet Browser オープンソース・ブラウザーランタイム">
</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · 日本語 · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser は実際の WPE WebKit ブラウザーと Rust WebDriver ブリッジを、自己完結型のエージェントランタイムとして提供します。コンテナーごとに分離されたセッションを 1 つ実行し、標準入力へ順序付き JSON コマンドを送り、標準出力から機械可読な結果を受け取ります。

アカウント、API キー、データベース、ホスト型コントロールプレーンは不要です。

## クイックスタート

ランタイムの検証に必要なのは Docker だけです。clone、Node.js、アカウント、API キー、ブラウザーの外向きネットワークは不要です。

~~~bash
curl -fsSL https://raw.githubusercontent.com/masakaai/jet-browser/main/scripts/try-jet.sh | sh
~~~

[確認可能なスクリプト](./scripts/try-jet.sh)は、リリースに固定された seccomp ポリシーをダウンロードして SHA-256 を検証し、変更不可能な digest で attest 済みの `linux/amd64` イメージを取得します。そのうえで、ブラウザー起動、ネイティブ入力、DOM 状態、PNG キャプチャを検証します。ネットワークを無効化した使い捨てのリソース制限コンテナーを使い、Docker ソケットやホストディレクトリはマウントしません。ARM ホストでは現在 Docker の amd64 エミュレーションが必要です。

## 再現可能なランタイムベンチマーク

![Jet Browser、Browser Use、Steel Browser、Browserless の検証済みブラウザー起動時間とアクティブメモリの中央値。どちらも低いほど良い。](./docs/assets/runtime-benchmark.svg)

Jet Browser は **1,445.25 ms** で検証済みページに到達し、アクティブメモリは **189.6 MiB**—次点より準備時間を **72.7%**、メモリを **33.2%** 削減しました。[手法](./docs/benchmarks.md) · [生データ](./benchmarks/results/runtime-2026-10-07.json)

## オープンソースのコア

- WPE WebKit 2.54 とヘッドレス Wayland コンポジター
- Rust 製の順序付き JSONL 自動化ブリッジ
- ポインター、キーボード、テキスト、タッチ、ホイール、ドラッグ、ナビゲーション、タブ
- タイトル、URL、JavaScript 実行、スクリーンショット、セマンティック DOM
- 明示的なプロファイルパスによる Cookie と Web Storage の入出力
- 任意で利用できる Visual frame、Live DOM、有人操作、分散 Worker コンポーネント

コア経路は Agent → JSONL → jet-wpe → WebDriver → WPE WebKit です。スタンドアロンモードにアプリケーションサーバー、データベースクライアント、トンネル、決済 SDK、特定のエージェントフレームワークは含まれません。

[アーキテクチャ](./docs/architecture.md)と[スタンドアロンデモ](./docs/demo.md)も参照してください。

## 開発と検証

~~~bash
npm ci
npm test
cargo test --all-targets
docker build -f Dockerfile.standalone -t jet-browser:local .
~~~

Jet Browser はブラウザー基盤であり、LLM やエージェントフレームワークではありません。[Apache License 2.0](./LICENSE) で提供されます。
