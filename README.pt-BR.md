<h1 align="center">Jet Browser</h1>

<p align="center"><strong>Um runtime de navegador pequeno e aberto para agentes web.</strong><br>WPE WebKit, entrada nativa, automação determinística e um protocolo JSONL incorporável.</p>

<p align="center">
  <img width="100%" src="./docs/assets/jet-browser-banner.png" alt="Runtime de navegador open source Jet Browser">
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

Somente com Docker:

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .
printf '%s\n' \
  '{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"eager"}' \
  '{"op":"navigate","url":"data:text/html,<title>Jet Browser</title><h1>ready</h1>"}' \
  '{"op":"title"}' \
  '{"op":"close"}' |
docker run --rm -i --network=none jet-browser:local
~~~

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
