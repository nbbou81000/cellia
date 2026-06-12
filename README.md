# 🤖 CelliA — Média Tech & Bidouille 100% Autonome

> **Découvrir le site en direct :** [👉 Accéder à CelliA](https://nbbou81000.github.io/cellia/) 

---

## 💡 Le Concept
**CelliA** est une expérience de média technique entièrement automatisé, sans base de données, sans serveur payant, et sans maintenance humaine quotidienne. 

Le site s'auto-alimente **5 fois par jour** en allant dénicher des pépites sur le web anglophone et francophone (Hacker News, r/selfhosted, r/LocalLLaMA, blogs indépendants), puis utilise la puissance des LLM pour traduire, synthétiser et rédiger des articles de ~300 mots au ton "geek et curieux".

Le tout inclut une **Radio Lofi intégrée** avec mini-lecteur pour accompagner vos lectures.

---

## 🛠️ L'Architecture (Ou comment tourner à 0 €)

Ce projet est conçu pour respecter scrupuleusement les limites d'usage équitable (*Fair Use*) de GitHub et prouve qu'on peut créer un agent IA autonome de production de manière totalement gratuite :

*   **Infrastructure :** 100% [GitHub Pages](https://pages.github.com/) pour l'hébergement statique et performant.
*   **Orchestration :** Un workflow [GitHub Actions](https://github.com/features/actions) (`cron`) se déclenche 5 fois par jour pour exécuter le script de scraping et de génération. Le job prend environ 5 minutes par exécution.
*   **Résilience Multi-API (Le Fallback) :** Pour contourner les limitations de requêtes (*Rate Limits*) des forfaits gratuits, le script utilise un système de cascade intelligent :
    $$\text{Groq} \longrightarrow \text{Mistral AI} \longrightarrow \text{Google Gemini}$$
    Si une API sature ou échoue, la suivante prend automatiquement le relais pour garantir la publication de l'article.
Option à cocher dans les github actions pour utiliser une API payante afin de scrapper plus de sources et écrire des articles plus longs.
Autre option pour écrire un article de fond, avec utilisation de 6000 tokens.
---

## 📻 Fonctionnalités Clés
*   **Scraping ciblé :** Analyse de plus de 20 sources axées bidouille logicielle, domotique, auto-hébergement et IA.
*   **Écriture IA optimisée :** Génération d'articles condensés, clairs et sans jargon inutile.
*   **Lecteur Lofi Cosy :** 
    *   Bouton `🎙️ Radio` pour lancer la musique en tâche de fond (idéal sur mobile).
    *   Bouton `📻 Player` pour afficher un mini-lecteur moderne et discret (Desktop).
    *   État persistant (via `localStorage`) pour retrouver sa musique d'une session à l'autre.
    *   Flux de secours intégrés (*Open.FM Lofi* & *I Love Radio*).

---

## 🔒 Sécurité & Déploiement

Le code est entièrement public, mais les clés d'API utilisées pour la génération de contenu sont sécurisées de manière étanche via les **GitHub Actions Secrets** (`MISTRAL_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`). 

---

## ⭐ Soutenir le projet
Si vous aimez l'idée ou si vous vous inspirez de cette architecture pour vos propres projets, n'hésitez pas à laisser une **étoile (Star)** sur ce dépôt, ça fait toujours plaisir !

*Développé avec passion par un passionné de bidouille.*
