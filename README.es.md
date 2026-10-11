<p align="center">
  <img width="100%" src="./docs/assets/jet-browser-banner.svg" alt="Runtime de navegador open source Jet Browser">
</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · Español · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser empaqueta un navegador WPE WebKit real y un puente WebDriver en Rust como runtime autónomo para agentes. Cada contenedor ejecuta una sesión aislada, recibe comandos JSON ordenados por la entrada estándar y devuelve resultados legibles por máquina por la salida estándar.

No requiere cuenta, clave API, base de datos ni plano de control alojado.

## Inicio rápido

Para comprobar el runtime solo hace falta Docker: sin clonar, Node.js, cuenta, clave API ni red saliente del navegador:

~~~bash
curl -fsSL https://raw.githubusercontent.com/masakaai/jet-browser/main/scripts/try-jet.sh | sh
~~~

El [script revisable](./scripts/try-jet.sh) descarga la política seccomp fijada a la versión, verifica su SHA-256, obtiene la imagen `linux/amd64` atestada por digest inmutable y prueba el arranque, la entrada nativa, el estado del DOM y la captura PNG. Usa un contenedor desechable, limitado en recursos y sin red, sin montar el socket de Docker ni directorios del host. Por ahora, los hosts ARM necesitan la emulación amd64 de Docker.

## Benchmark reproducible del runtime

![Medianas del tiempo verificado hasta navegador listo y de la memoria activa para Jet Browser, Browser Use, Steel Browser y Browserless; menor es mejor.](./docs/assets/runtime-benchmark.svg)

Jet Browser alcanzó una página verificada en **1.445,25 ms** con **189,6 MiB** de memoria activa: **72,7 % menos tiempo de preparación** y **33,2 % menos memoria** que el siguiente resultado. [Método](./docs/benchmarks.md) · [Datos](./benchmarks/results/runtime-2026-10-07.json)

## Núcleo open source

- WPE WebKit 2.54 y compositor Wayland headless
- puente de automatización JSONL ordenado escrito en Rust
- puntero, teclado, texto, táctil, rueda, arrastre, navegación y pestañas
- título, URL, evaluación JavaScript, capturas y DOM semántico
- importación/exportación de cookies y Web Storage mediante rutas de perfil explícitas
- componentes opcionales de Visual frame, Live DOM, control humano y Worker distribuido

La ruta principal es Agent → JSONL → jet-wpe → WebDriver → WPE WebKit. El modo autónomo no instala servidor de aplicación, cliente de base de datos, túnel, SDK de pagos ni un framework de agente concreto.

Consulta [Arquitectura](./docs/architecture.md) y [Demo autónoma](./docs/demo.md).

## Desarrollo y verificación

~~~bash
npm ci
npm test
cargo test --all-targets
docker build -f Dockerfile.standalone -t jet-browser:local .
~~~

Jet Browser es infraestructura de navegador, no un LLM ni un framework de agentes. Se distribuye con [Apache License 2.0](./LICENSE).
