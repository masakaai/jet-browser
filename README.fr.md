# Jet Browser

<p align="center"><strong>Un petit moteur de navigateur ouvert pour les agents web.</strong><br>WPE WebKit, saisie native, automatisation déterministe et protocole JSONL intégrable.</p>

![Moteur de navigateur open source Jet Browser](./docs/assets/jet-browser-banner.png)

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

Avec Docker uniquement :

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .
printf '%s\n' \
  '{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"eager"}' \
  '{"op":"navigate","url":"data:text/html,<title>Jet Browser</title><h1>ready</h1>"}' \
  '{"op":"title"}' \
  '{"op":"close"}' |
docker run --rm -i --network=none jet-browser:local
~~~

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
