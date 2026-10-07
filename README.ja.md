<p align="center">
  <img width="100%" src="./docs/assets/jet-browser-banner.svg" alt="Jet Browser オープンソース・ブラウザーランタイム">
</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · 日本語 · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser は実際の WPE WebKit ブラウザーと Rust WebDriver ブリッジを、自己完結型のエージェントランタイムとして提供します。コンテナーごとに分離されたセッションを 1 つ実行し、標準入力へ順序付き JSON コマンドを送り、標準出力から機械可読な結果を受け取ります。

アカウント、API キー、データベース、ホスト型コントロールプレーンは不要です。

## クイックスタート

Docker と Node.js 24+ が必要です。ネットワークを無効化したコンテナー内で、作成、ローカルページの表示、ネイティブ入力、DOM 検証、スクリーンショット、終了までを実行します。

~~~bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm run standalone
~~~

## 再現可能なランタイムベンチマーク

![Jet Browser、Browser Use、Steel Browser、Browserless の検証済みブラウザー起動時間とアクティブメモリの中央値。どちらも低いほど良い。](./docs/assets/runtime-benchmark.svg)

同じホスト上で Jet Browser は検証済みページへ中央値 **1,445.25 ms** で到達し、アクティブメモリは **189.6 MiB** でした。比較対象はすべて 7/7 回成功しました。グラフは[生データ](./benchmarks/results/runtime-2026-10-07.json)から生成され、手法と制約は[ベンチマーク文書](./docs/benchmarks.md)に記載されています。

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
