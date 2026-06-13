# Vectorflow

Vectorflow est une application web moderne d'intelligence artificielle et de recherche sémantique basée sur des embeddings vectoriels. Elle combine la puissance de l'IA locale avec une base de données vectorielle pour offrir une expérience de recherche et d'analyse documentaire intelligent.

## 📋 Table des matières

- [À propos](#-à-propos)
- [Fonctionnalités](#-fonctionnalités)
- [Architecture Technique](#-architecture-technique)
- [Installation](#-installation)
- [Lancement](#-lancement)
- [Développement](#-développement)
- [Configuration](#-configuration)

---

## 🎯 À propos

Vectorflow est une plateforme conçue pour :

- **Vectoriser des documents** en utilisant des modèles d'embeddings IA
- **Stocker et indexer** les données dans une base de données vectorielle performante
- **Rechercher sémantiquement** à travers vos documents en langage naturel
- **Synthétiser et résumer** les résultats de recherche grâce à un LLM (Large Language Model)
- **S'exécuter entièrement en local** pour garantir la confidentialité et l'autonomie

---

## ✨ Fonctionnalités

### 🧠 Vectorisation Intelligente
- Conversion automatique de documents en vecteurs d'embeddings
- Modèle `nomic-embed-text` pour une vectorisation haute qualité
- Support des documents textes et contenus structurés

### 🔍 Recherche Sémantique
- Interrogation en langage naturel
- Recherche basée sur le sens, pas sur les mots-clés
- Résultats pertinents et contextuels

### 📝 Synthèse Documentaire
- Résumé automatique de documents
- Synthèse RAG (Retrieval-Augmented Generation)
- Génération de réponses basées sur le contexte

### 💾 Base de Données Vectorielle
- Qdrant pour le stockage performant des vecteurs
- Indexation efficace et recherche rapide
- Support de millions de vecteurs

### 🏠 Exécution Locale
- Pas de dépendance cloud
- Données restent privées
- Contrôle total de l'infrastructure

---

## 🏗️ Architecture Technique

Vectorflow est construit avec les technologies suivantes :

### Stack Frontend
- **Node.js / npm** : Gestion des dépendances et scripts
- **Interface web** : Accessible sur `http://localhost:5000`

### Stack Backend
- **Ollama** : Moteur IA pour embeddings et LLM locaux
  - `nomic-embed-text` : Vectorisation de documents
  - `gemma3:12b` : Synthèse et génération de texte

### Stack Données
- **Qdrant** : Base de données vectorielle distribuée
  - Port par défaut : `6333`
  - Stockage et indexation des embeddings

### Architecture Globale
```
┌─────────────────────────────────────┐
│      Interface Web (Frontend)        │
│      localhost:5000                   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│    Application Backend (Node.js)    │
│   Gestion des requêtes & logique     │
└──────┬───────────────┬──────────────┘
       │               │
       │               │
   ┌───▼───┐       ┌───▼────┐
   │ Ollama│       │ Qdrant │
   │(IA)   │       │ (Vect.)│
   └───────┘       └────────┘
```

---

## 💾 Installation

### Prérequis

1. **Ollama** : Téléchargez et installez Ollama depuis [ollama.com](https://ollama.com)

2. **Modèles Ollama** :
   Téléchargez les modèles requis via votre terminal :
   ```bash
   # Pour la vectorisation (embeddings)
   ollama pull nomic-embed-text
   
   # Pour la synthèse et génération de texte (LLM)
   ollama pull gemma3:12b
   ```

3. **Qdrant** : Lancez une instance Qdrant sur le port `6333`
   
   **Option A : Avec Docker** (recommandé)
   ```bash
   docker run -p 6333:6333 qdrant/qdrant
   ```
   
   **Option B : Binaire natif**
   ```bash
   # Téléchargez depuis https://qdrant.tech/documentation/guides/installation/
   ./qdrant
   ```

4. **Node.js** : Version 16+ avec npm

### Étapes d'Installation

1. **Clonez le repository**
   ```bash
   git clone https://github.com/Ghost0fMars/vectorflow.git
   cd vectorflow
   ```

2. **Installez les dépendances**
   ```bash
   npm install
   ```

3. **Configurez les variables d'environnement**
   ```bash
   # Utilisez le fichier .env.example comme template
   cp .env.example .env
   ```
   
   Modifiez `.env` avec vos paramètres locaux :
   ```env
   # Ollama
   OLLAMA_API_URL=http://localhost:11434
   OLLAMA_EMBED_MODEL=nomic-embed-text
   OLLAMA_LLM_MODEL=gemma3:12b
   
   # Qdrant
   QDRANT_URL=http://localhost:6333
   QDRANT_COLLECTION=documents
   
   # Application
   PORT=5000
   NODE_ENV=development
   ```

---

## 🚀 Lancement

### Démarrage de l'Application

1. **Assurez-vous que Ollama et Qdrant sont en cours d'exécution**

2. **Lancez l'application**
   ```bash
   npm run dev
   ```

3. **Accédez à l'interface**
   ```
   http://localhost:5000
   ```

### Diagnostic Automatique

Au démarrage du serveur, un diagnostic automatique s'exécute dans votre terminal pour vérifier :
- ✅ La connexion à Ollama
- ✅ La disponibilité des modèles
- ✅ La connexion à Qdrant
- ✅ L'état de la base de données

---

## 🔧 Développement

### Structure du Projet

```
vectorflow/
├── src/
│   ├── server/        # Backend (Node.js)
│   ├── client/        # Frontend
│   └── utils/         # Utilitaires partagés
├── .env.example       # Template de configuration
├── package.json       # Dépendances et scripts
└── README.md          # Ce fichier
```

### Scripts Disponibles

```bash
# Développement avec rechargement automatique
npm run dev

# Build de production
npm run build

# Lancement en production
npm start

# Tests
npm test

# Linting
npm run lint
```

### Technologies Principales

- **Node.js** : Runtime JavaScript côté serveur
- **npm** : Gestionnaire de paquets
- **Ollama API** : Intégration IA
- **Qdrant Client** : Client base de données vectorielle

### Contribuer

Pour contribuer au projet :

1. Forkez le repository
2. Créez une branche pour votre feature (`git checkout -b feature/AmazingFeature`)
3. Commitez vos changements (`git commit -m 'Add some AmazingFeature'`)
4. Poussez vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrez une Pull Request

---

## ⚙️ Configuration Avancée

### Variables d'Environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `OLLAMA_API_URL` | URL de l'API Ollama | `http://localhost:11434` |
| `OLLAMA_EMBED_MODEL` | Modèle d'embedding | `nomic-embed-text` |
| `OLLAMA_LLM_MODEL` | Modèle LLM | `gemma3:12b` |
| `QDRANT_URL` | URL de Qdrant | `http://localhost:6333` |
| `QDRANT_COLLECTION` | Nom de la collection | `documents` |
| `PORT` | Port de l'application | `5000` |
| `NODE_ENV` | Environnement | `development` |

### Optimisation Locale

- **CPU** : Utilisez `gemma3:7b` pour les machines moins puissantes
- **Mémoire** : Réduisez la taille du modèle d'embedding si nécessaire
- **Qdrant** : Utilisez `docker run` avec des volumes persistants pour la durabilité

---

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

---

## 📧 Contact & Support

Pour toute question ou problème :
- Ouvrez une issue sur GitHub
- Consultez la documentation Ollama : https://ollama.com/docs
- Consultez la documentation Qdrant : https://qdrant.tech/documentation/

---

**Vectorflow** - Vectoriser, rechercher, synthétiser. En local. 🚀
