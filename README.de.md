# Jet Browser

<p align="center"><strong>Echte Browser-Infrastruktur für Web-Agenten.</strong><br>WPE-WebKit-Sitzungen, menschliche Übernahme, persistenter Zustand und ein direkter Echtzeit-Datenpfad.</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · Deutsch · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser ist die Browser-Laufzeit von MASAKA. Sie stellt isolierte WPE-WebKit-Sitzungen bereit und ermöglicht es Menschen, dieselbe Sitzung anzusehen, zu übernehmen und anschließend an den Agenten zurückzugeben. Vorschau und Eingaben laufen über sitzungsgebundene WebSockets; Vercel, Supabase Realtime und Postgres liegen außerhalb des interaktiven Hotpaths.

![Laufende MASAKA-Visual-Sitzung mit menschlicher Übernahme](./docs/assets/live-session.png)

## Funktionen

- WPE WebKit 2.54 mit Rust-WebDriver-Bridge
- Visual Frames oder semantisches Live DOM, vor dem Start ausgewählt
- Zeiger, Tastatur, Touch, Mausrad, Drag, Navigation und Tabs
- Epoch-Fencing zwischen Agent und Mensch gegen veraltete Eingaben
- Verschlüsselte Cookies, local/session storage, IndexedDB und CacheStorage
- Regionale Worker-Pools, bedarfsgerechte Skalierung und serverseitige Abrechnung

## Schnellstart

Erforderlich sind Node.js 24+ und ein serverseitiger API-Schlüssel aus dem Dashboard.

```bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm ci
export MASAKA_API_KEY=msk_your_server_key
npm run demo
```

Die Demo erstellt genau eine zeitlich begrenzte Sitzung, liest den echten Seitentitel und beendet die Sitzung in `finally`.

```bash
npm run verify
npm run benchmark -- --providers=masaka,browser-use,kernel --runs=5
```

Der Vergleich nutzt dieselbe URL, denselben Viewport sowie sequenzielle Läufe und identische Bereinigung. Fehlende Schlüssel werden als `skipped` ausgewiesen. Mehr unter [Architektur](./docs/architecture.md), [Benchmarks](./docs/benchmarks.md), [Vergleich](./docs/comparison.md) und [Demo](./docs/demo.md).

Jet Browser ist Browser-Infrastruktur, kein LLM-Agenten-Framework. Öffentlich sind derzeit die MASAKA Session/Action API und das Vorschau-/Eingabeprotokoll, nicht ein allgemeiner CDP-Endpunkt.
