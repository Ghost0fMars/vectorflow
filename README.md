## Lancement en Local (avec Ollama)

Cette application est optimisée pour s'exécuter localement à l'aide d'**Ollama** pour l'intelligence artificielle (vectorisation et synthèse) et de **Qdrant** pour la base de données vectorielle.

### Prérequis

1. **Ollama** : Téléchargez et installez Ollama depuis [ollama.com](https://ollama.com).
2. **Modèles Ollama** :
   Dans votre terminal, téléchargez les modèles requis :
   ```bash
   # Pour la vectorisation (embeddings)
   ollama pull nomic-embed-text
   
   # Pour le résumé de document et la synthèse RAG (LLM)
   ollama pull gemma3:12b
   ```
3. **Qdrant** : Assurez-vous d'avoir une instance Qdrant lancée sur le port `6333` (via Docker ou binaire natif).

### Démarrage

1. Installer les dépendances :
   ```bash
   npm install
   ```
2. Le fichier de configuration `.env` a déjà été créé à la racine de votre projet avec vos paramètres locaux. Si vous devez le modifier ou le recréer, inspirez-vous de [.env.example](.env.example).
3. Lancer l'application :
   ```bash
   npm run dev
   ```

L'interface sera alors accessible sur [http://localhost:5000](http://localhost:5000). Au démarrage du serveur, un diagnostic automatique s'exécutera dans votre terminal pour vérifier la connexion avec Ollama et l'état de vos modèles locaux.
