# Jet Browser

<p align="center"><strong>Infraestructura de navegador real para agentes web.</strong><br>Sesiones WPE WebKit, control humano, estado persistente y un plano de datos directo en tiempo real.</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · Español · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser es el runtime de navegador de MASAKA. Ejecuta sesiones WPE WebKit aisladas para agentes y permite que una persona observe, tome el control y devuelva la misma sesión al agente. La vista previa y las entradas usan WebSockets vinculados a la sesión; Vercel, Supabase Realtime y Postgres quedan fuera de la ruta interactiva crítica.

![Sesión MASAKA Visual con control humano](./docs/assets/live-session.png)

## Capacidades

- WPE WebKit 2.54 con puente WebDriver en Rust
- Frames Visual o Live DOM semántico, elegidos antes de iniciar
- Puntero, teclado, táctil, rueda, arrastre, navegación y pestañas
- Epoch fencing entre agente y persona contra entradas antiguas
- Cookies, local/session storage, IndexedDB y CacheStorage cifrados
- Pools regionales, escalado por demanda y liquidación del lado del servidor

## Inicio rápido

Se requiere Node.js 24+ y una API key de servidor creada en el Dashboard.

```bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm ci
export MASAKA_API_KEY=msk_your_server_key
npm run demo
```

La demo crea una sola sesión limitada, lee el título real de la página y siempre la detiene en `finally`.

```bash
npm run verify
npm run benchmark -- --providers=masaka,browser-use,kernel --runs=5
```

El benchmark usa la misma URL, viewport, ejecución secuencial y regla de limpieza. Un proveedor sin credenciales queda como `skipped`. Consulta [Arquitectura](./docs/architecture.md), [Benchmarks](./docs/benchmarks.md), [Comparación](./docs/comparison.md) y [Demo](./docs/demo.md).

Jet Browser es infraestructura de navegador, no un framework de agentes LLM. Hoy se exponen la API session/action de MASAKA y el protocolo de vista previa/entrada, no un endpoint CDP general.
