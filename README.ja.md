# Jet Browser

<p align="center"><strong>Web エージェント向けの実ブラウザー基盤。</strong><br>WPE WebKit セッション、人による操作引き継ぎ、永続状態、リアルタイムの直接データ経路。</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · 日本語 · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser は MASAKA のブラウザーランタイムです。分離された WPE WebKit セッションをエージェントに提供し、同じセッションを人が監視・操作した後にエージェントへ戻せます。プレビューと入力はセッション専用 WebSocket を通り、Vercel、Supabase Realtime、Postgres は対話のホットパスに入りません。

![人が操作を引き継げる MASAKA Visual セッション](./docs/assets/live-session.png)

## 主な機能

- WPE WebKit 2.54 と Rust WebDriver ブリッジ
- 起動前に選ぶ Visual フレームまたはセマンティック Live DOM
- ポインター、キーボード、タッチ、ホイール、ドラッグ、ナビゲーション、タブ
- 古い制御入力を拒否する agent/human epoch fencing
- Cookie、local/session storage、IndexedDB、CacheStorage の暗号化保存
- リージョン別ワーカープール、需要連動スケーリング、サーバー側精算

## クイックスタート

Node.js 24+ と Dashboard で発行したサーバー用 API キーが必要です。

```bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm ci
export MASAKA_API_KEY=msk_your_server_key
npm run demo
```

デモは時間制限付きセッションを 1 つ作成し、実ページのタイトルを読み、`finally` で必ず停止します。

```bash
npm run verify
npm run benchmark -- --providers=masaka,browser-use,kernel --runs=5
```

比較ハーネスは同じ URL、viewport、逐次実行、クリーンアップ規則を使います。資格情報がないプロバイダーは `skipped` と記録されます。[アーキテクチャ](./docs/architecture.md)、[ベンチマーク](./docs/benchmarks.md)、[比較](./docs/comparison.md)、[デモ](./docs/demo.md)を参照してください。

Jet Browser は LLM エージェントフレームワークではなくブラウザー基盤です。現在の公開インターフェースは MASAKA の session/action API とプレビュー/入力プロトコルで、汎用 CDP endpoint ではありません。
