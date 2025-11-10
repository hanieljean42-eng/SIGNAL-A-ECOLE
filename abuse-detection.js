const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(process.env.DATABASE_PATH);

/**
 * Système de détection d'abus et fausses accusations
 * Analyse les patterns suspects dans les signalements
 */

// Règles de détection
const DETECTION_RULES = {
    // Nombre max de signalements par IP en 24h
    MAX_REPORTS_PER_IP_24H: 5,
    
    // Nombre max de signalements par école en 1h
    MAX_REPORTS_PER_SCHOOL_1H: 10,
    
    // Durée min entre 2 signalements similaires (minutes)
    MIN_TIME_BETWEEN_SIMILAR: 30,
    
    // Seuil de similarité de texte (%)
    TEXT_SIMILARITY_THRESHOLD: 85,
    
    // Mots-clés suspects (spam, insultes gratuites)
    SUSPICIOUS_KEYWORDS: [
        'test', 'blabla', 'aaaa', 'zzzz', 'lol',
        'fake', 'faux', 'pour rire', 'c\'est bidon'
    ],
    
    // Longueur min pour un signalement valide
    MIN_DESCRIPTION_LENGTH: 20,
    
    // Patterns de texte répétitif
    REPETITIVE_PATTERN: /(.{3,})\1{3,}/i
};

// Score de confiance (0-100)
const TRUST_SCORES = {
    VERY_LOW: 0,    // Très suspect
    LOW: 25,        // Suspect
    MEDIUM: 50,     // Neutre
    HIGH: 75,       // Fiable
    VERY_HIGH: 100  // Très fiable
};

/**
 * Analyser un signalement pour détecter les abus
 */
async function analyzeReport(reportData, metadata = {}) {
    const issues = [];
    let trustScore = TRUST_SCORES.HIGH; // Par défaut : fiable
    let severity = 'normal'; // normal, warning, critical

    console.log('🔍 Analyse anti-abus du signalement...');

    // 1. Vérifier la fréquence par IP
    if (metadata.ipAddress) {
        const ipFrequency = await checkIPFrequency(metadata.ipAddress);
        if (ipFrequency.count >= DETECTION_RULES.MAX_REPORTS_PER_IP_24H) {
            issues.push({
                type: 'ip_frequency',
                message: `IP a créé ${ipFrequency.count} signalements en 24h`,
                severity: 'critical'
            });
            trustScore -= 30;
            severity = 'critical';
        }
    }

    // 2. Vérifier la fréquence par école
    if (reportData.schoolId) {
        const schoolFrequency = await checkSchoolFrequency(reportData.schoolId);
        if (schoolFrequency.count >= DETECTION_RULES.MAX_REPORTS_PER_SCHOOL_1H) {
            issues.push({
                type: 'school_frequency',
                message: `${schoolFrequency.count} signalements en 1h pour cette école`,
                severity: 'warning'
            });
            trustScore -= 15;
            if (severity === 'normal') severity = 'warning';
        }
    }

    // 3. Détecter les signalements similaires récents
    if (reportData.message) {
        const similar = await findSimilarReports(
            reportData.message, 
            reportData.schoolId
        );
        
        if (similar.length > 0) {
            issues.push({
                type: 'similar_content',
                message: `${similar.length} signalement(s) similaire(s) trouvé(s)`,
                severity: 'warning',
                details: similar
            });
            trustScore -= 20;
            if (severity === 'normal') severity = 'warning';
        }
    }

    // 4. Analyser le contenu du message
    const contentAnalysis = analyzeContent(reportData.message || '');
    if (contentAnalysis.isSuspicious) {
        issues.push(...contentAnalysis.issues);
        trustScore -= contentAnalysis.scoreReduction;
        if (contentAnalysis.severity === 'critical' && severity !== 'critical') {
            severity = 'warning';
        }
    }

    // 5. Vérifier la description
    if (reportData.message && reportData.message.length < DETECTION_RULES.MIN_DESCRIPTION_LENGTH) {
        issues.push({
            type: 'short_description',
            message: 'Description trop courte (possible spam)',
            severity: 'warning'
        });
        trustScore -= 10;
    }

    // S'assurer que le score reste dans les limites
    trustScore = Math.max(TRUST_SCORES.VERY_LOW, Math.min(trustScore, TRUST_SCORES.VERY_HIGH));

    const result = {
        trustScore,
        severity,
        issues,
        isBlocked: trustScore < TRUST_SCORES.LOW,
        needsReview: trustScore < TRUST_SCORES.MEDIUM || severity !== 'normal',
        timestamp: new Date().toISOString()
    };

    // Logger l'analyse
    if (result.needsReview || result.isBlocked) {
        await logAbuseDetection(reportData, metadata, result);
    }

    console.log(`📊 Score de confiance: ${trustScore}/100 | Sévérité: ${severity}`);
    console.log(`⚠️ Issues détectées: ${issues.length}`);

    return result;
}

/**
 * Vérifier la fréquence de signalements par IP
 */
function checkIPFrequency(ipAddress) {
    return new Promise((resolve, reject) => {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        
        db.get(`
            SELECT COUNT(*) as count
            FROM reports
            WHERE ip_address = ? AND created_at > ?
        `, [ipAddress, twentyFourHoursAgo], (err, row) => {
            if (err) {
                console.error('Erreur check IP:', err);
                resolve({ count: 0 });
            } else {
                resolve({ count: row.count });
            }
        });
    });
}

/**
 * Vérifier la fréquence de signalements par école
 */
function checkSchoolFrequency(schoolId) {
    return new Promise((resolve, reject) => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        
        db.get(`
            SELECT COUNT(*) as count
            FROM reports
            WHERE school_id = ? AND created_at > ?
        `, [schoolId, oneHourAgo], (err, row) => {
            if (err) {
                console.error('Erreur check école:', err);
                resolve({ count: 0 });
            } else {
                resolve({ count: row.count });
            }
        });
    });
}

/**
 * Trouver des signalements similaires récents
 */
function findSimilarReports(message, schoolId) {
    return new Promise((resolve, reject) => {
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        
        db.all(`
            SELECT id, message, created_at
            FROM reports
            WHERE school_id = ? 
            AND created_at > ?
            AND status != 'archived'
        `, [schoolId, thirtyMinutesAgo], (err, rows) => {
            if (err) {
                console.error('Erreur recherche similaires:', err);
                resolve([]);
            } else {
                const similar = rows.filter(row => {
                    const similarity = calculateTextSimilarity(message, row.message);
                    return similarity >= DETECTION_RULES.TEXT_SIMILARITY_THRESHOLD;
                });
                resolve(similar);
            }
        });
    });
}

/**
 * Analyser le contenu du message
 */
function analyzeContent(message) {
    const issues = [];
    let scoreReduction = 0;
    let severity = 'normal';
    let isSuspicious = false;

    const lowerMessage = message.toLowerCase();

    // Vérifier les mots-clés suspects
    const suspiciousWords = DETECTION_RULES.SUSPICIOUS_KEYWORDS.filter(
        keyword => lowerMessage.includes(keyword.toLowerCase())
    );

    if (suspiciousWords.length > 0) {
        issues.push({
            type: 'suspicious_keywords',
            message: `Mots suspects détectés: ${suspiciousWords.join(', ')}`,
            severity: 'warning'
        });
        scoreReduction += 15 * suspiciousWords.length;
        severity = 'warning';
        isSuspicious = true;
    }

    // Vérifier les patterns répétitifs
    if (DETECTION_RULES.REPETITIVE_PATTERN.test(message)) {
        issues.push({
            type: 'repetitive_pattern',
            message: 'Texte répétitif détecté (possible spam)',
            severity: 'critical'
        });
        scoreReduction += 30;
        severity = 'critical';
        isSuspicious = true;
    }

    // Vérifier si le message est en majuscules (SPAM)
    if (message.length > 20 && message === message.toUpperCase()) {
        issues.push({
            type: 'all_caps',
            message: 'Message entièrement en majuscules',
            severity: 'warning'
        });
        scoreReduction += 10;
        if (severity === 'normal') severity = 'warning';
        isSuspicious = true;
    }

    // Vérifier les caractères répétés (!!!!!!, ????)
    if (/[!?]{5,}/.test(message)) {
        issues.push({
            type: 'excessive_punctuation',
            message: 'Ponctuation excessive détectée',
            severity: 'warning'
        });
        scoreReduction += 5;
        if (severity === 'normal') severity = 'warning';
        isSuspicious = true;
    }

    return {
        isSuspicious,
        issues,
        scoreReduction,
        severity
    };
}

/**
 * Calculer la similarité entre deux textes (algorithme de Levenshtein simplifié)
 */
function calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const s1 = text1.toLowerCase().trim();
    const s2 = text2.toLowerCase().trim();
    
    if (s1 === s2) return 100;
    
    // Calculer le ratio de mots communs
    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);
    
    const commonWords = words1.filter(word => 
        word.length > 3 && words2.includes(word)
    ).length;
    
    const maxWords = Math.max(words1.length, words2.length);
    const similarity = (commonWords / maxWords) * 100;
    
    return Math.round(similarity);
}

/**
 * Logger une détection d'abus
 */
function logAbuseDetection(reportData, metadata, analysisResult) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO abuse_logs 
            (report_id, ip_address, trust_score, severity, issues, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
            reportData.id || null,
            metadata.ipAddress || null,
            analysisResult.trustScore,
            analysisResult.severity,
            JSON.stringify(analysisResult.issues),
            JSON.stringify({ ...metadata, reportData })
        ], (err) => {
            if (err) {
                console.error('❌ Erreur log abus:', err);
                resolve(false);
            } else {
                console.log('✅ Détection d\'abus loguée');
                resolve(true);
            }
        });
    });
}

/**
 * Obtenir les statistiques d'abus
 */
function getAbuseStats() {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                severity,
                COUNT(*) as count,
                AVG(trust_score) as avg_trust_score
            FROM abuse_logs
            WHERE created_at > datetime('now', '-7 days')
            GROUP BY severity
        `, [], (err, rows) => {
            if (err) {
                console.error('Erreur stats abus:', err);
                resolve([]);
            } else {
                resolve(rows);
            }
        });
    });
}

/**
 * Obtenir les signalements suspects récents
 */
function getSuspiciousReports(limit = 50) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                al.*,
                r.id as report_code,
                r.category,
                r.urgency,
                r.status,
                r.title,
                r.message,
                r.face_photo,
                r.face_verified,
                r.created_at as report_created_at,
                s.name as school_name,
                s.school_code
            FROM abuse_logs al
            LEFT JOIN reports r ON al.report_id = r.id
            LEFT JOIN schools s ON r.school_id = s.id
            WHERE al.severity IN ('warning', 'critical')
            ORDER BY al.created_at DESC
            LIMIT ?
        `, [limit], (err, rows) => {
            if (err) {
                console.error('Erreur récup signalements suspects:', err);
                resolve([]);
            } else {
                // Parser les issues JSON
                const parsedRows = rows.map(row => {
                    if (row.issues) {
                        try {
                            row.issues = JSON.parse(row.issues);
                        } catch (e) {
                            row.issues = [];
                        }
                    }
                    return row;
                });
                resolve(parsedRows);
            }
        });
    });
}

module.exports = {
    analyzeReport,
    getAbuseStats,
    getSuspiciousReports,
    TRUST_SCORES,
    DETECTION_RULES
};
