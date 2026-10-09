<p align="center">
  <img width="100%" src="./docs/assets/jet-browser-banner.svg" alt="Jet Browser——面向 Web Agent 的小型浏览器运行时">
</p>

<p align="center"><a href="./README.md">English</a> · 简体中文 · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser 把 WPE WebKit 与 Rust WebDriver bridge 封装成独立运行时。每个容器运行一个隔离浏览器会话；Harness 发送有序 JSONL 命令，Jet 返回机器可读结果。

可以接入任意 Harness 或确定性测试程序，无需账号、API Key、模型、数据库或托管控制面。

<p align="center">
  <a href="https://github.com/marketplace/actions/jet-browser-runtime-smoke-test">GitHub Marketplace Action</a> ·
  <a href="./docs/benchmarks.md">测试方法</a> ·
  <a href="./benchmarks/results/runtime-2026-10-07.json">原始样本</a>
</p>

## 可复现运行时 Benchmark

Jet Browser 在 **1,445.25 ms** 内到达已验证页面，活动内存快照中位数为 **189.6 MiB**——相较每一列的次优结果，就绪时间低 **72.7%**，内存低 **33.2%**。[测试方法](./docs/benchmarks.md) · [原始数据](./benchmarks/results/runtime-2026-10-07.json)

<p align="center">
  <img width="100%" src="./docs/assets/runtime-benchmark.svg" alt="Jet Browser、Browser Use、Steel Browser 与 Browserless 的页面就绪时间和活动内存中位数对比；两个指标都是越低越好。">
</p>

## 让编码 Agent 自己完成验收

将下面这一行粘贴到 Codex、Claude Code 或其他能够读取仓库的编码 Agent。GitHub 代码块自带一键复制按钮。

~~~text
为当前仓库从 https://github.com/masakaai/jet-browser 安装或升级 Jet Browser 最新 main。阅读 README.zh-CN.md；当 Codex 或 Claude Code 支持插件命令时使用其中的原生 Marketplace 安装方式，否则将 .agents/skills/jet-browser/SKILL.md 注册为仓库 Skill。确认 Docker 与 Node.js 24+ 可用，运行 npm run standalone，并报告浏览器启动、原生输入、DOM 验证和 PNG 截图是否全部通过。不要连接我的日用 Chrome Profile，也不要启动持久 Chrome daemon。若安装或验证失败，按照 docs/demo.md 排查。
~~~

## 快速开始

需要 Docker 与 Node.js 24+。

### 1. 安装编码 Agent 插件

Codex：

~~~bash
codex plugin marketplace add masakaai/jet-browser --ref main && codex plugin add jet-browser@masaka
~~~

Claude Code：

~~~bash
claude plugin marketplace add masakaai/jet-browser && claude plugin install jet-browser@masaka
~~~

两种方式都会安装 Jet Browser Skill，指导编码 Agent 检查环境、运行已验证的独立流程、接入带版本的工具 Schema，并保留运行时的安全边界。支持直接发现项目 Skill 的 Agent 也可以使用 [`.agents/skills/jet-browser/SKILL.md`](./.agents/skills/jet-browser/SKILL.md)。

### 2. 运行发布版验证流程

以下命令会拉取带构建来源证明的 `linux/amd64` 发布镜像，关闭浏览器外网、启动真实 WPE WebKit、打开内部测试页、通过原生输入写入文本、校验 DOM、截取 PNG，并关闭会话。

~~~bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
docker pull --platform=linux/amd64 ghcr.io/masakaai/jet-browser:0.6.7
DOCKER_DEFAULT_PLATFORM=linux/amd64 JET_BROWSER_IMAGE=ghcr.io/masakaai/jet-browser:0.6.7 npm run standalone:smoke
~~~

发布镜像目前只提供 `linux/amd64`；ARM 主机需要 Docker 的 amd64 模拟。生产环境应固定镜像 digest。若要按宿主机架构构建并验证当前检出的源码，运行 `npm run standalone`。

成功结果包含：

~~~json
{
  "status": "passed",
  "network": "disabled",
  "title": "Jet Browser Ready",
  "input": "open-source runtime"
}
~~~

也可以通过 [GitHub Marketplace Action](https://github.com/marketplace/actions/jet-browser-runtime-smoke-test) 运行同一套验收，无需仓库或账号密钥：

~~~yaml
permissions:
  contents: read

jobs:
  verify-browser-runtime:
    runs-on: ubuntu-latest
    steps:
      - name: Verify Jet Browser
        uses: masakaai/jet-browser@v0.6.7
~~~

### 3. 接入运行时边界

每一行输入是一条 JSON 命令，每一行输出是一条 JSON 响应。任何能管理子进程或容器的语言都可以监督 Jet，同时让模型与 Agent Harness 保持可替换。

面向模型的工具可以直接使用 [`sdk/tools.mjs`](./sdk/tools.mjs) 中带版本的声明；框架无关的绑定方法见 [Agent 工具目录](./docs/agent-tools.md)。

## 为什么选择 Jet Browser

| 设计选择 | 对 Agent 系统的价值 |
| --- | --- |
| **浏览器运行时，而不是内置 Agent** | 可以接入任意模型、Tool Loop、编排框架或确定性测试。 |
| **每个容器一个隔离会话** | 生命周期、资源限制、Profile 所有权与失败回收边界清晰。 |
| **stdin/stdout 上的有序 JSONL** | 不强制要求 Daemon、数据库、账号或 Cloud API。 |
| **原生输入 + 语义与视觉证据** | 鼠标、键盘、触摸、多标签页、DOM、JavaScript 结果与截图共用同一运行时。 |
| **带版本的工具 Schema** | Harness 可以稳定接入，而模型侧工具名称变化不会破坏执行协议。 |
| **独立核心 + 可选分布式层** | 先在本地运行，按需增加预览、接管、持久化、区域调度与 Fleet 管理。 |

## 开源实现

| 能力 | 开源实现 |
| --- | --- |
| 真实浏览器 | Headless Wayland compositor 上的 WPE WebKit 2.54 |
| 自动化 Bridge | Rust 编写的有序行分隔 JSON 协议 |
| 原生交互 | 鼠标、键盘、文本、触摸、滚轮、拖动、导航与多标签页 |
| 页面观察 | 标题、URL、JavaScript、截图与语义 DOM |
| 会话状态 | 显式 Profile 路径下的 Cookie 与 Web Storage 导入/导出 |
| 下载 | 有边界的下载生命周期与元数据 |
| 实时预览 | 可选直连数据面的 Visual Frame 与 Live DOM |
| Agent 接入 | 带版本且有冲突检查的 JSON Schema 工具声明 |

独立镜像只包含浏览器运行时和必要系统库，不安装应用服务器、JavaScript 依赖树、数据库客户端、隧道、支付 SDK 或厂商 Agent 框架。

## 架构

~~~text
Agent / 测试 / Supervisor
        │  stdin/stdout JSONL
        ▼
    jet-wpe（Rust）
        │  WebDriver
        ▼
  WPE WebKit + Weston
~~~

这个边界刻意保持精简。本地进程、容器调度器、CI 或 Agent Harness 都能监督它；分布式预览、人工接管、持久化与调度属于可选外围组件。

详见[架构](./docs/architecture.md)、[独立运行演示](./docs/demo.md)与[产品边界对比](./docs/comparison.md)。

## 开发与验证

~~~bash
npm ci
npm test
cargo test --all-targets
docker build -f Dockerfile.standalone -t jet-browser:local .
~~~

Jet Browser 是浏览器基础设施，不是 LLM 或 Agent 框架。项目采用 [Apache License 2.0](./LICENSE) 开源；部署或修改协议前请阅读 [Contributing](./CONTRIBUTING.md) 与 [Security](./SECURITY.md)。
