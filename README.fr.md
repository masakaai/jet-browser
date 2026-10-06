# Jet Browser

<p align="center"><strong>Une infrastructure de navigateur réel pour les agents web.</strong><br>Sessions WPE WebKit, prise de contrôle humaine, état persistant et chemin de données temps réel direct.</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · Français · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser est le moteur de navigateur de MASAKA. Il fournit aux agents des sessions WPE WebKit isolées et permet à une personne d'observer, de prendre le contrôle puis de rendre la même session à l'agent. L'aperçu et les entrées passent par des WebSockets liés à la session ; Vercel, Supabase Realtime et Postgres restent hors du chemin interactif critique.

![Session MASAKA Visual avec prise de contrôle humaine](./docs/assets/live-session.png)

## Capacités

- WPE WebKit 2.54 et pont WebDriver en Rust
- Images Visual ou Live DOM sémantique, choisis avant le lancement
- Pointeur, clavier, tactile, molette, glisser, navigation et onglets
- Epoch fencing agent/humain contre les entrées obsolètes
- Cookies, local/session storage, IndexedDB et CacheStorage chiffrés
- Pools régionaux, mise à l'échelle selon la demande et facturation côté serveur

## Démarrage rapide

Node.js 24+ et une clé API serveur créée dans le Dashboard sont requis.

```bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm ci
export MASAKA_API_KEY=msk_your_server_key
npm run demo
```

La démo crée une seule session limitée, lit le titre réel de la page et arrête toujours la session dans `finally`.

```bash
npm run verify
npm run benchmark -- --providers=masaka,browser-use,kernel --runs=5
```

Le banc comparatif utilise la même URL, le même viewport, des exécutions séquentielles et la même règle de nettoyage. Un fournisseur sans clé est marqué `skipped`. Voir [Architecture](./docs/architecture.md), [Benchmarks](./docs/benchmarks.md), [Comparaison](./docs/comparison.md) et [Démo](./docs/demo.md).

Jet Browser est une infrastructure de navigateur, pas un framework d'agent LLM. L'interface publique actuelle est l'API session/action MASAKA et le protocole aperçu/entrée, pas un endpoint CDP générique.
