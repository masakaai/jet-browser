<h1 align="center">Jet Browser</h1>

<p align="center"><strong>面向 Web Agent 的小型开源浏览器运行时。</strong><br>WPE WebKit、原生输入、确定性自动化与可嵌入的 JSONL 协议。</p>

<p align="center">
  <img width="100%" src="./docs/assets/jet-browser-banner.png" alt="Jet Browser 开源浏览器运行时">
</p>

<p align="center"><a href="./README.md">English</a> · 简体中文 · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser 把真实的 WPE WebKit 浏览器与 Rust WebDriver bridge 封装为自包含的 Agent 运行时。每个容器运行一个隔离会话，通过标准输入发送有序 JSON 命令，并从标准输出接收机器可读结果。

无需账号、API Key、数据库或托管控制面。

## 快速开始

需要 Docker 与 Node.js 24+。以下命令会构建镜像，并在禁用网络的容器中真实执行创建浏览器、打开本地页面、原生输入、DOM 校验、截图与关闭会话。

~~~bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm run standalone
~~~

如只使用 Docker，可直接构建并向容器发送 JSONL：

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .
printf '%s\n' \
  '{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"eager"}' \
  '{"op":"navigate","url":"data:text/html,<title>Jet Browser</title><h1>ready</h1>"}' \
  '{"op":"title"}' \
  '{"op":"close"}' |
docker run --rm -i --network=none jet-browser:local
~~~

## 开源核心

- WPE WebKit 2.54 与 headless Wayland compositor
- Rust 编写的有序 JSONL 自动化 bridge
- 鼠标、键盘、文本、触控、滚轮、拖动、导航与多标签页
- 标题、URL、JavaScript 执行、截图与语义 DOM
- 显式 profile 路径的 Cookie 与 Web Storage 导入/导出
- 可选的 Visual frame、Live DOM、人工接管与分布式 Worker 组件

核心路径是 Agent → JSONL → jet-wpe → WebDriver → WPE WebKit。独立模式不安装应用服务器、数据库客户端、隧道、支付 SDK 或特定 Agent 框架。

详见[架构](./docs/architecture.md)与[独立运行演示](./docs/demo.md)。

## 开发与验证

~~~bash
npm ci
npm test
cargo test --all-targets
docker build -f Dockerfile.standalone -t jet-browser:local .
~~~

Jet Browser 是浏览器基础设施，不是 LLM 或 Agent 框架。项目采用 [Apache License 2.0](./LICENSE) 开源。
