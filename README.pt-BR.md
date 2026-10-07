<p align="center">
  <img width="100%" src="./docs/assets/jet-browser-banner.svg" alt="Runtime de navegador open source Jet Browser">
</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · Português</p>

O Jet Browser reúne um navegador WPE WebKit real e uma ponte WebDriver em Rust como runtime autônomo para agentes. Cada contêiner executa uma sessão isolada, recebe comandos JSON ordenados pela entrada padrão e devolve resultados legíveis por máquina pela saída padrão.

Não requer conta, chave de API, banco de dados nem plano de controle hospedado.

## Início rápido

Requer Docker e Node.js 24+. O teste executa de verdade a criação do navegador, uma página local, entrada nativa, validação do DOM, captura de tela e encerramento em um contêiner sem rede.

~~~bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm run standalone
~~~

## Benchmark reproduzível do runtime

![Medianas do tempo verificado até o navegador estar pronto e da memória ativa para Jet Browser, Browser Use, Steel Browser e Browserless; menor é melhor.](./docs/assets/runtime-benchmark.svg)

O Jet Browser chegou a uma página verificada em **1.445,25 ms** com **189,6 MiB** de memória ativa—**72,7% menos tempo de prontidão** e **33,2% menos memória** que o resultado seguinte. [Método](./docs/benchmarks.md) · [Dados](./benchmarks/results/runtime-2026-10-07.json)

## Núcleo open source

- WPE WebKit 2.54 e compositor Wayland headless
- ponte de automação JSONL ordenada escrita em Rust
- ponteiro, teclado, texto, toque, rolagem, arrasto, navegação e abas
- título, URL, avaliação JavaScript, capturas e DOM semântico
- importação/exportação de cookies e Web Storage por caminhos explícitos de perfil
- componentes opcionais de Visual frame, Live DOM, controle humano e Worker distribuído

O caminho principal é Agent → JSONL → jet-wpe → WebDriver → WPE WebKit. O modo autônomo não instala servidor de aplicação, cliente de banco de dados, túnel, SDK de pagamentos nem um framework de agente específico.

Veja [Arquitetura](./docs/architecture.md) e [Demo autônoma](./docs/demo.md).

## Desenvolvimento e verificação

~~~bash
npm ci
npm test
cargo test --all-targets
docker build -f Dockerfile.standalone -t jet-browser:local .
~~~

Jet Browser é infraestrutura de navegador, não um LLM nem um framework de agentes. Licenciado sob a [Apache License 2.0](./LICENSE).
