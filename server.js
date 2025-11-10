const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const schoolRoutes = require('./routes/schools');
const superAdminRoutes = require('./routes/super-admin');
const userRoutes = require('./routes/users');
const discussionRoutes = require('./routes/discussions');
const moderationRoutes = require('./routes/moderation');
const aiChatRoutes = require('./routes/ai-chat');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration trust proxy pour le rate limiting
app.set('trust proxy', 1);

// Middleware de sécurité
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Configuration CORS
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://votre-domaine.com'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: {
        error: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// Middleware pour parser JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Servir les fichiers uploadés (discussions)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes API
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/discussions', discussionRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/ai-chat', aiChatRoutes);

// Route pour servir l'interface principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour l'inscription des écoles
app.get('/register-school', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register-school.html'));
});

// Route pour l'administration
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Route pour la gestion des utilisateurs (admin)
app.get('/admin/users', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-users.html'));
});

app.get('/admin-users', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-users.html'));
});

// Route pour faire un signalement
app.get('/report', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

// Route pour signalement urgent
app.get('/report-urgent', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'report-urgent.html'));
});

// Route pour l'inscription utilisateur
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Route pour la connexion utilisateur
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Route pour la demande de réinitialisation de mot de passe
app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});

// Route pour réinitialiser le mot de passe
app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// Route pour le profil utilisateur
app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// Route pour l'annuaire des écoles
app.get('/schools', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'schools.html'));
});

// Route pour les conditions d'utilisation
app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// Route pour le guide d'utilisation
app.get('/guide', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'guide.html'));
});

// Route pour l'inscription administrateur
app.get('/register-admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register-admin.html'));
});

// Route pour le super-admin
app.get('/super-admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'super-admin.html'));
});

// Route pour suivre un signalement
app.get('/track-report', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'track-report.html'));
});

// Route pour la gestion des signalements (admin)
app.get('/admin-reports', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-reports.html'));
});

// Route pour les discussions
app.get('/discussion', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'discussion.html'));
});

// Route pour la gestion des discussions (admin)
app.get('/admin-discussions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-discussions.html'));
});

// Route pour le chat IA
app.get('/chat-ia', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat-ia.html'));
});

// Route pour reprendre une conversation Haniel
app.get('/reprendre-haniel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reprendre-haniel.html'));
});

// Route pour voir les conversations IA (admin)
app.get('/admin-ai-conversations', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-ai-conversations.html'));
});

// Route pour la page À Propos
app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

// Route pour la demande de révélation d'identité (admin)
app.get('/admin-identity-reveal', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-identity-reveal.html'));
});

// Route pour voir les réponses aux demandes d'identité (admin)
app.get('/admin-identity-responses', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-identity-responses.html'));
});

// Middleware de gestion d'erreurs
app.use((err, req, res, next) => {
    console.error('Erreur serveur:', err.stack);
    
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({
            success: false,
            message: 'Format JSON invalide'
        });
    }
    
    res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' 
            ? 'Erreur interne du serveur' 
            : err.message
    });
});

// Route 404
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route non trouvée'
    });
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur SpeakFree démarré sur le port ${PORT}`);
    console.log(`🌐 Interface accessible sur: http://localhost:${PORT}`);
    console.log(`📊 Administration accessible sur: http://localhost:${PORT}/admin`);
    console.log(`📝 Inscription école accessible sur: http://localhost:${PORT}/register-school`);
    
    if (process.env.NODE_ENV === 'development') {
        console.log('\n🔧 Mode développement activé');
        console.log('📋 Variables d\'environnement chargées depuis .env');
    }
});

// Gestion propre de l'arrêt du serveur
process.on('SIGTERM', () => {
    console.log('🛑 Arrêt du serveur en cours...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Arrêt du serveur en cours...');
    process.exit(0);
});
