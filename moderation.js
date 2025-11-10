const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'speakfree.db');
const db = new sqlite3.Database(dbPath);

// Liste de mots/expressions interdits (français)
const FORBIDDEN_WORDS = [
    // Insultes graves
    'connard', 'salope', 'pute', 'enculé', 'fils de pute', 'fdp',
    'ta mère', 'ta race', 'nique', 'fils de', 'batard', 'bâtard',
    
    // Violence
    'je vais te tuer', 'je te tue', 'crève', 'mort', 'suicid',
    'je vais te frapper', 'je vais te massacrer', 'je vais te défoncer',
    
    // Menaces
    'attends moi', 'je te retrouve', 'tu vas voir', 'tu vas payer',
    'on se voit après', 'fais gaffe',
    
    // Discriminations
    'sale noir', 'sale blanc', 'sale arabe', 'sale juif', 'pédé', 'tarlouze',
    
    // Cyberharcelement
    'balance', 'cafard', 'balancer', 'snitch', 'on sait où tu habites',
    
    // Contenu sexuel inapproprié
    'nude', 'nudes', 'envoie moi', 'montre moi', 'sexe', 'dick pic'
];

// Patterns suspects (regex)
const SUSPICIOUS_PATTERNS = [
    /\b(tu|vous)\s+(va|vas|allez)\s+(mourir|crever|souffrir)\b/i,
    /\b(je|on)\s+(vais|va|allons)\s+(te|vous)\s+(tuer|frapper|massacrer)\b/i,
    /\b(sale|putain\s+de)\s+[a-z]+\b/i,
    /\b(ta|ton)\s+(mère|mere|race|gueule)\b/i,
    /\bfils\s+de\s+\w+\b/i,
    /\b(merde|putain|bordel)\s+de\s+\w+\b/i,
    /\b\d{10}\b/, // Numéros de téléphone
    /\b\d{1,3}\s+rue\b/i, // Adresses
];

// Score de toxicité
function calculateToxicityScore(text) {
    let score = 0;
    const lowerText = text.toLowerCase();
    
    // Vérifier les mots interdits
    FORBIDDEN_WORDS.forEach(word => {
        if (lowerText.includes(word.toLowerCase())) {
            score += 10;
        }
    });
    
    // Vérifier les patterns
    SUSPICIOUS_PATTERNS.forEach(pattern => {
        if (pattern.test(text)) {
            score += 8;
        }
    });
    
    // Majuscules excessives (cris)
    const upperCaseRatio = (text.match(/[A-Z]/g) || []).length / text.length;
    if (upperCaseRatio > 0.5 && text.length > 10) {
        score += 3;
    }
    
    // Points d'exclamation multiples
    const exclamationCount = (text.match(/!/g) || []).length;
    if (exclamationCount > 3) {
        score += 2;
    }
    
    // Répétitions de caractères (ex: "morrrrrt")
    if (/(.)\1{4,}/.test(text)) {
        score += 2;
    }
    
    return score;
}

// Détection spécifique de contenu
function detectContentType(text) {
    const lowerText = text.toLowerCase();
    
    if (lowerText.match(/\b(tuer|mort|suicide|crever)\b/i)) {
        return { type: 'violence', severity: 'high' };
    }
    
    if (lowerText.match(/\b(sale|putain)\s+(noir|blanc|arabe|juif|pédé)\b/i)) {
        return { type: 'discrimination', severity: 'high' };
    }
    
    if (lowerText.match(/\b(ta mère|ta race|fils de)\b/i)) {
        return { type: 'insult', severity: 'medium' };
    }
    
    if (lowerText.match(/\b(nudes?|dick|sexe)\b/i)) {
        return { type: 'sexual', severity: 'high' };
    }
    
    if (/\d{10}/.test(text) || /\d{1,3}\s+rue/i.test(text)) {
        return { type: 'personal_info', severity: 'medium' };
    }
    
    return { type: 'unknown', severity: 'low' };
}

// Route de modération
router.post('/check', (req, res) => {
    const { message } = req.body;
    
    if (!message || message.trim().length === 0) {
        return res.json({
            allowed: false,
            reason: 'Le message ne peut pas être vide'
        });
    }
    
    // Calculer le score de toxicité
    const toxicityScore = calculateToxicityScore(message);
    const contentAnalysis = detectContentType(message);
    
    console.log('🤖 Modération IA:', {
        message: message.substring(0, 50),
        score: toxicityScore,
        content: contentAnalysis
    });
    
    // Seuil de blocage
    const BLOCK_THRESHOLD = 10;
    
    if (toxicityScore >= BLOCK_THRESHOLD) {
        let reason = 'Message bloqué : ';
        
        switch (contentAnalysis.type) {
            case 'violence':
                reason += 'contient des menaces de violence. Les menaces sont interdites.';
                break;
            case 'discrimination':
                reason += 'contient des propos discriminatoires. Le respect de tous est obligatoire.';
                break;
            case 'insult':
                reason += 'contient des insultes graves. Reste respectueux dans tes échanges.';
                break;
            case 'sexual':
                reason += 'contient du contenu sexuel inapproprié. Ce type de contenu est interdit.';
                break;
            case 'personal_info':
                reason += 'contient des informations personnelles (téléphone, adresse). Ne partage pas ces informations publiquement.';
                break;
            default:
                reason += 'contenu inapproprié détecté. Reformule ton message de manière respectueuse.';
        }
        
        // Log pour les admins
        logModerationAction(message, toxicityScore, contentAnalysis, 'blocked');
        
        return res.json({
            allowed: false,
            reason: reason,
            score: toxicityScore,
            contentType: contentAnalysis.type
        });
    }
    
    // Message autorisé
    logModerationAction(message, toxicityScore, contentAnalysis, 'allowed');
    
    res.json({
        allowed: true,
        score: toxicityScore,
        warning: toxicityScore > 5 ? 'Attention au ton de ton message' : null
    });
});

// Analyser un texte (pour statistiques)
router.post('/analyze', (req, res) => {
    const { text } = req.body;
    
    const score = calculateToxicityScore(text);
    const content = detectContentType(text);
    
    res.json({
        score: score,
        contentType: content.type,
        severity: content.severity,
        allowed: score < 10
    });
});

// Logger les actions de modération
function logModerationAction(message, score, analysis, action) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        message: message.substring(0, 100),
        score: score,
        type: analysis.type,
        severity: analysis.severity,
        action: action
    };
    
    console.log('📊 Log Modération:', logEntry);
    
    // Stocker dans la base de données pour statistiques
    db.run(`
        INSERT INTO moderation_logs (message, score, content_type, severity, action, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
    `, [message.substring(0, 100), score, analysis.type, analysis.severity, action], (err) => {
        if (err) {
            console.error('❌ Erreur sauvegarde log modération:', err.message);
        }
    });
}

// Route pour obtenir les statistiques de modération (admin)
router.get('/stats', (req, res) => {
    // Récupérer les statistiques depuis la DB
    db.all(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN action = 'blocked' THEN 1 ELSE 0 END) as blocked,
            SUM(CASE WHEN action = 'allowed' THEN 1 ELSE 0 END) as allowed,
            content_type,
            COUNT(*) as count
        FROM moderation_logs
        GROUP BY content_type
    `, [], (err, rows) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur récupération statistiques'
            });
        }
        
        const stats = {
            totalChecks: 0,
            blocked: 0,
            allowed: 0,
            types: {}
        };
        
        if (rows && rows.length > 0) {
            stats.totalChecks = rows[0].total || 0;
            stats.blocked = rows[0].blocked || 0;
            stats.allowed = rows[0].allowed || 0;
            
            rows.forEach(row => {
                if (row.content_type) {
                    stats.types[row.content_type] = row.count;
                }
            });
        }
        
        res.json({
            success: true,
            stats: stats
        });
    });
});

module.exports = router;
