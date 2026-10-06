# Jet Browser

<p align="center"><strong>面向 Web Agent 的真实浏览器基础设施。</strong><br>WPE WebKit 会话、人工接管、持久状态与实时直连数据面。</p>

<p align="center"><a href="./README.md">English</a> · 简体中文 · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser 是 MASAKA 的浏览器运行时。它为 Agent 提供隔离的 WPE WebKit 会话，也让用户能够观看、接管浏览器，再把同一个会话交还给 Agent。预览与输入使用会话绑定的 WebSocket；Vercel、Supabase Realtime 与 Postgres 不在交互热路径中。

![正在运行且支持人工接管的 MASAKA Visual 会话](./docs/assets/live-session.png)

## 核心能力

- WPE WebKit 2.54 与 Rust WebDriver bridge
- Visual 帧或语义化 Live DOM 预览，启动前固定模式
- 鼠标、键盘、触控、滚轮、拖动、导航与多标签页
- Agent/人工控制 epoch fencing，拒绝旧控制方输入
- 加密保存 Cookie、local/session storage、IndexedDB 与 CacheStorage
- 有界下载、区域 Worker 池、按需扩缩容与服务端计费结算
- DNS/IP 校验，拦截本机、内网、链路本地、保留地址与 metadata 地址

## 快速开始

需要 Node.js 24+，并在 MASAKA Dashboard 创建仅供服务端使用的 API Key。

```bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm ci
export MASAKA_API_KEY=msk_your_server_key
npm run demo
```

Demo 只创建一个有时限的会话，读取真实页面标题，并在 `finally` 中停止会话。

```js
import { MasakaBrowser } from './sdk/client.mjs';

const browser = new MasakaBrowser({ apiKey: process.env.MASAKA_API_KEY });
const session = await browser.create({ url: 'https://example.com', region: 'overseas', maxSeconds: 120 });
try {
  await browser.waitForReady(session.id);
  console.log(await browser.evaluate(session.id, '({title: document.title, url: location.href})'));
} finally {
  await browser.stop(session.id);
}
```

浏览器或移动端应使用 `sdk/browser.mjs` 与用户短期 access token，不要把 MASAKA API Key 或 service-role key 放入公开客户端。

## 验证与 Benchmark

```bash
npm run verify
npm run benchmark -- --providers=masaka,browser-use,kernel --runs=5
```

统一 harness 使用相同页面、viewport、顺序运行与清理规则；缺少密钥会明确标记 `skipped`，不会伪造成 0 或失败成绩。详见[架构](./docs/architecture.md)、[Benchmark](./docs/benchmarks.md)、[能力对比](./docs/comparison.md)与[演示指南](./docs/demo.md)。

Jet Browser 是浏览器基础设施，不是 LLM Agent 框架。目前公开的是 MASAKA session/action API 与预览/输入协议，不是通用 CDP endpoint。
