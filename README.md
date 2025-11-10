# 🗣️ SpeakFree - Plateforme de Signalement Anonyme pour Écoles

**Développé par:** Haniel DJEBLE  
**Type:** Plateforme de signalement anonyme pour les établissements scolaires

---

## 📋 Description

SpeakFree est une plateforme web sécurisée permettant aux élèves de signaler anonymement des incidents dans leur école. Le système inclut :

- ✅ Signalements anonymes avec codes de suivi
- ✅ Upload de photos/vidéos (10 MB max par fichier)
- ✅ Discussions sécurisées élève-administration
- ✅ Chat IA avec Haniel (assistant intelligent)
- ✅ Panel administrateur complet
- ✅ Super admin pour gérer les écoles

---

## 🚀 Installation

### Prérequis
- Node.js 14+ et npm
- Port 3000 disponible

### Étapes

```bash
# 1. Installer les dépendances
npm install

# 2. Créer les dossiers uploads
mkdir uploads
mkdir uploads/reports
mkdir uploads/discussions

# 3. Créer le fichier .env
cp .env.example .env

# 4. Éditer .env et configurer vos secrets
nano .env

# 5. Démarrer le serveur
npm start
```

---

## ⚙️ Configuration (.env)

Créer un fichier `.env` à la racine avec :

```env
# Base de données
DATABASE_PATH=./database/speakfree.db

# Serveur
PORT=3000
NODE_ENV=production

# Sécurité (CHANGEZ CES VALEURS !)
JWT_SECRET=votre_secret_unique_minimum_64_caracteres_tres_securise
SUPER_ADMIN_PASSWORD=votre_mot_de_passe_super_admin

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

⚠️ **IMPORTANT:** Changez `JWT_SECRET` et `SUPER_ADMIN_PASSWORD` !

---

## 📁 Structure du Projet

```
ECOLE/
├── server.js                   # Serveur Express principal
├── package.json                # Dépendances npm
├── .env                        # Configuration (à créer)
├── .env.example                # Template configuration
│
├── routes/                     # Routes API (9 fichiers)
│   ├── admin.js                # API administration
│   ├── ai-chat.js              # Chat IA Haniel
│   ├── auth.js                 # Authentification
│   ├── discussions.js          # Discussions élèves
│   ├── moderation.js           # Modération
│   ├── reports.js              # Signalements + upload
│   ├── schools.js              # Gestion écoles
│   ├── super-admin.js          # Super administrateur
│   └── users.js                # Gestion utilisateurs
│
├── public/                     # Interface web (23 fichiers)
│   ├── index.html              # Page d'accueil
│   ├── admin.html              # Dashboard admin
│   ├── report.html             # Formulaire signalement
│   ├── chat-ia.html            # Chat avec Haniel
│   ├── super-admin.html        # Panel super admin
│   └── ...
│
├── database/
│   └── speakfree.db            # Base SQLite
│
├── uploads/                    # Fichiers uploadés
│   ├── reports/                # Photos/vidéos signalements
│   └── discussions/            # Fichiers discussions
│
└── node_modules/               # Dépendances (npm install)
```

---

## 🔑 Accès

### Page d'accueil
```
http://localhost:3000
```

### Super Admin
```
http://localhost:3000/super-admin
Code: 200700
```

### Annuaire des écoles (protégé)
```
http://localhost:3000/schools
Mot de passe: 200700
```

---

## 📦 Dépendances Principales

| Package | Version | Utilisation |
|---------|---------|-------------|
| express | 4.21.2 | Serveur web |
| sqlite3 | 5.1.7 | Base de données |
| bcrypt | 6.0.0 | Hachage mots de passe |
| jsonwebtoken | 9.0.2 | Authentification JWT |
| multer | 2.0.2 | Upload fichiers |
| helmet | 7.1.0 | Sécurité HTTP |
| express-rate-limit | 7.5.1 | Protection DDoS |
| cors | 2.8.5 | Cross-Origin |

**Total:** 266 packages installés

---

## 🎯 Fonctionnalités

### Pour les Élèves
- 📢 Signalement anonyme avec code de suivi
- 📸 Upload de photos/vidéos (preuve visuelle)
- 💬 Discussion sécurisée avec l'école
- 🤖 Chat avec Haniel (IA d'aide)
- 🔐 100% anonyme et sécurisé

### Pour les Administrateurs
- 👀 Voir tous les signalements de leur école
- 💬 Répondre aux élèves via discussions
- 🤖 Intervenir dans conversations Haniel
- 📊 Statistiques et tableau de bord
- 👥 Gérer les utilisateurs

### Pour le Super Admin
- 🏫 Approuver/rejeter les inscriptions d'écoles
- 🗑️ Supprimer des écoles
- 📋 Vue globale de toutes les écoles
- ⚙️ Gestion complète du système

---

## 🔒 Sécurité

- ✅ Hachage bcrypt des mots de passe
- ✅ Authentification JWT
- ✅ Rate limiting (protection DDoS)
- ✅ Helmet.js (protection headers HTTP)
- ✅ Validation des entrées
- ✅ Upload sécurisé (10 MB max, types validés)
- ✅ Anonymat garanti pour les élèves

---

## 🚀 Déploiement

### Option 1: Serveur Local
```bash
npm start
```

### Option 2: PM2 (Production)
```bash
npm install -g pm2
pm2 start server.js --name speakfree
pm2 save
pm2 startup
```

### Option 3: Docker (à venir)

---

## 📝 Utilisation

### 1. Inscription d'une école
1. Aller sur `/register-school`
2. Remplir le formulaire
3. Attendre l'approbation du super admin
4. Recevoir le code école unique

### 2. Faire un signalement
1. Aller sur `/report`
2. Entrer le code école
3. Remplir le formulaire
4. (Optionnel) Ajouter photos/vidéos
5. Recevoir code de suivi + code d'accès discussion

### 3. Suivre un signalement
1. Aller sur `/track-report`
2. Entrer le code de suivi
3. Voir le statut et les réponses

### 4. Discuter avec l'école
1. Aller sur `/discussion`
2. Entrer le code d'accès discussion
3. Envoyer des messages

### 5. Parler avec Haniel (IA)
1. Aller sur `/chat-ia`
2. Entrer le code école
3. Discuter avec l'assistant IA

---

## 🛠️ Développement

### Lancer en mode développement
```bash
npm start
```

### Structure des routes API

```
/api/auth           - Authentification
/api/reports        - Signalements
/api/schools        - Écoles
/api/admin          - Administration
/api/super-admin    - Super admin
/api/users          - Utilisateurs
/api/discussions    - Discussions
/api/ai-chat        - Chat IA
/api/moderation     - Modération
```

---

## 📊 Base de Données

### Tables Principales

- `schools` - Écoles enregistrées
- `admins` - Administrateurs d'écoles
- `users` - Utilisateurs (élèves)
- `reports` - Signalements
- `discussions` - Messages discussions
- `ai_chat_sessions` - Sessions chat IA
- `ai_chat_messages` - Messages IA

---

## 🆘 Support

### En cas de problème

1. Vérifier que le serveur tourne sur le port 3000
2. Vérifier que le fichier `.env` existe et est configuré
3. Vérifier que les dossiers `uploads/` sont créés
4. Vérifier les logs du serveur
5. Consulter `FICHIERS_RESTANTS.txt` pour la liste des fichiers

---

## 👨‍💻 Auteur

**Haniel DJEBLE**
- Email: hanieljean42@gmail.com
- Téléphone: +225 01 50 25 24 67
- Spécialité: Développement Full-Stack

---

## 📄 Licence

© 2025 Haniel DJEBLE - Tous droits réservés

---

## 🎉 Prêt à l'emploi !

Votre installation de SpeakFree est complète et prête à être utilisée.

```bash
npm start
# Ouvrir http://localhost:3000
```

**Bon signalement ! 🚀**
