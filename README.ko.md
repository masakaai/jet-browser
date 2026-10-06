# Jet Browser

<p align="center"><strong>웹 에이전트를 위한 실제 브라우저 인프라.</strong><br>WPE WebKit 세션, 사용자 제어 전환, 영구 상태, 실시간 직접 데이터 경로.</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · 한국어 · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser는 MASAKA의 브라우저 런타임입니다. 에이전트에 격리된 WPE WebKit 세션을 제공하고, 사용자가 같은 세션을 보고 직접 제어한 뒤 다시 에이전트에 넘길 수 있습니다. 미리보기와 입력은 세션 전용 WebSocket을 사용하며 Vercel, Supabase Realtime, Postgres는 상호작용 핫 패스에 포함되지 않습니다.

![사용자 제어 전환을 지원하는 MASAKA Visual 세션](./docs/assets/live-session.png)

## 주요 기능

- WPE WebKit 2.54와 Rust WebDriver 브리지
- 시작 전에 선택하는 Visual 프레임 또는 시맨틱 Live DOM
- 포인터, 키보드, 터치, 휠, 드래그, 탐색, 탭
- 오래된 제어 입력을 차단하는 agent/human epoch fencing
- 쿠키, local/session storage, IndexedDB, CacheStorage 암호화 보존
- 지역별 워커 풀, 수요 기반 확장, 서버 측 사용량 정산

## 빠른 시작

Node.js 24+와 Dashboard에서 만든 서버 전용 API 키가 필요합니다.

```bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm ci
export MASAKA_API_KEY=msk_your_server_key
npm run demo
```

데모는 제한 시간이 있는 세션 하나를 만들고 실제 페이지 제목을 확인한 뒤 `finally`에서 세션을 종료합니다.

```bash
npm run verify
npm run benchmark -- --providers=masaka,browser-use,kernel --runs=5
```

비교 하네스는 같은 URL, viewport, 순차 실행 및 정리 규칙을 사용합니다. 자격 증명이 없는 공급자는 `skipped`로 기록됩니다. [아키텍처](./docs/architecture.md), [벤치마크](./docs/benchmarks.md), [비교](./docs/comparison.md), [데모](./docs/demo.md)를 확인하세요.

Jet Browser는 LLM 에이전트 프레임워크가 아니라 브라우저 인프라입니다. 현재 공개 인터페이스는 MASAKA session/action API와 미리보기/입력 프로토콜이며 범용 CDP endpoint가 아닙니다.
