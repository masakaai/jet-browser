<h1 align="center">Jet Browser</h1>

<p align="center"><strong>Un petit moteur de navigateur ouvert pour les agents web.</strong><br>WPE WebKit, saisie native, automatisation déterministe et protocole JSONL intégrable.</p>

<p align="center">
  <img width="100%" src="./docs/assets/jet-browser-banner.png" alt="Moteur de navigateur open source Jet Browser">
</p>

<p align="center"><a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · Français · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a></p>

Jet Browser réunit un vrai navigateur WPE WebKit et un pont WebDriver en Rust dans un moteur autonome pour agents. Chaque conteneur exécute une session isolée, reçoit des commandes JSON ordonnées sur l’entrée standard et renvoie des résultats lisibles par machine sur la sortie standard.

Aucun compte, aucune clé API, aucune base de données ni aucun plan de contrôle hébergé ne sont requis.

## Démarrage rapide

Docker et Node.js 24+ sont nécessaires. Le test exécute réellement la création du navigateur, une page locale, la saisie native, la validation du DOM, une capture et la fermeture dans un conteneur sans réseau.

~~~bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm run standalone
~~~

## Benchmark reproductible du runtime

![Médianes du temps de disponibilité vérifié du navigateur et de la mémoire active pour Jet Browser, Browser Use, Steel Browser et Browserless ; plus bas est meilleur.](./docs/assets/runtime-benchmark.svg)

Sur le même hôte, Jet Browser a atteint une page vérifiée en **1 445,25 ms** de médiane avec **189,6 MiB** de mémoire active. Tous les runtimes comparés ont réussi 7/7 exécutions. Le graphique est généré depuis les [données brutes](./benchmarks/results/runtime-2026-10-07.json) ; la méthode et les limites figurent dans la [documentation du benchmark](./docs/benchmarks.md).

## Cœur open source

- WPE WebKit 2.54 et compositeur Wayland headless
- pont d’automatisation JSONL ordonné écrit en Rust
- pointeur, clavier, texte, tactile, molette, glisser, navigation et onglets
- titre, URL, évaluation JavaScript, captures et DOM sémantique
- import/export des cookies et du Web Storage via des chemins de profil explicites
- composants facultatifs Visual frame, Live DOM, prise de contrôle humaine et Worker distribué

Le chemin essentiel est Agent → JSONL → jet-wpe → WebDriver → WPE WebKit. Le mode autonome n’installe ni serveur applicatif, ni client de base de données, ni tunnel, ni SDK de paiement, ni framework d’agent imposé.

Voir [Architecture](./docs/architecture.md) et [Démo autonome](./docs/demo.md).

## Développement et vérification

~~~bash
npm ci
npm test
cargo test --all-targets
docker build -f Dockerfile.standalone -t jet-browser:local .
~~~

Jet Browser est une infrastructure de navigateur, pas un LLM ni un framework d’agent. Distribué sous [Apache License 2.0](./LICENSE).
