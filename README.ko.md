# Jet Browser

<p align="center"><strong>웹 에이전트를 위한 작고 개방된 브라우저 런타임.</strong><br>WPE WebKit, 네이티브 입력, 결정적 자동화, 임베드 가능한 JSONL 프로토콜.</p>

![Jet Browser 오픈 소스 브라우저 런타임](./docs/assets/jet-browser-banner.png)

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · 한국어 · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser는 실제 WPE WebKit 브라우저와 Rust WebDriver 브리지를 자체 완결형 에이전트 런타임으로 제공합니다. 컨테이너마다 격리된 세션 하나를 실행하고, 표준 입력으로 순서가 보장된 JSON 명령을 보내며, 표준 출력에서 기계 판독 가능한 결과를 받습니다.

계정, API 키, 데이터베이스 또는 호스팅 제어 영역이 필요하지 않습니다.

## 빠른 시작

Docker와 Node.js 24+가 필요합니다. 네트워크가 비활성화된 컨테이너에서 브라우저 생성, 로컬 페이지 열기, 네이티브 입력, DOM 검증, 스크린샷, 종료까지 실제로 실행합니다.

~~~bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm run standalone
~~~

Docker만 사용할 수도 있습니다.

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .
printf '%s\n' \
  '{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"eager"}' \
  '{"op":"navigate","url":"data:text/html,<title>Jet Browser</title><h1>ready</h1>"}' \
  '{"op":"title"}' \
  '{"op":"close"}' |
docker run --rm -i --network=none jet-browser:local
~~~

## 오픈 소스 코어

- WPE WebKit 2.54와 헤드리스 Wayland 컴포지터
- Rust 기반 순서 보장 JSONL 자동화 브리지
- 포인터, 키보드, 텍스트, 터치, 휠, 드래그, 탐색 및 탭
- 제목, URL, JavaScript 실행, 스크린샷 및 시맨틱 DOM
- 명시적 프로필 경로를 통한 Cookie 및 Web Storage 가져오기/내보내기
- 선택형 Visual frame, Live DOM, 사용자 제어 및 분산 Worker 구성 요소

핵심 경로는 Agent → JSONL → jet-wpe → WebDriver → WPE WebKit입니다. 독립 실행 모드는 애플리케이션 서버, 데이터베이스 클라이언트, 터널, 결제 SDK 또는 특정 에이전트 프레임워크를 설치하지 않습니다.

[아키텍처](./docs/architecture.md)와 [독립 실행 데모](./docs/demo.md)를 참고하세요.

## 개발 및 검증

~~~bash
npm ci
npm test
cargo test --all-targets
docker build -f Dockerfile.standalone -t jet-browser:local .
~~~

Jet Browser는 브라우저 인프라이며 LLM 또는 에이전트 프레임워크가 아닙니다. [Apache License 2.0](./LICENSE)으로 제공됩니다.
