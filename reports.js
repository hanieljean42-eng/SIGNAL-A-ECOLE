const express = require('express');
const { body, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('./auth');
const { authenticateUserToken } = require('./users');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { analyzeReport } = require('../utils/abuse-detection');
const router = express.Router();

const db = new sqlite3.Database(process.env.DATABASE_PATH);

// Fonction pour mapper les catégories vers les catégories valides de la base de données
function mapCategoryToValid(category) {
    const categoryMap = {
        'cyberharcelement': 'harcelement',
        'vol': 'fraude',
        'arme': 'violence',
        'adulte': 'abus',
        'agression_sexuelle': 'abus'
    };
    
    // Si la catégorie est dans le mapping, retourner la catégorie mappée
    if (categoryMap[category]) {
        return categoryMap[category];
    }
    
    // Sinon, vérifier si c'est déjà une catégorie valide
    const validCategories = ['harcelement', 'violence', 'fraude', 'discrimination', 'abus', 'drogue', 'administration', 'infrastructure', 'autre'];
    if (validCategories.includes(category)) {
        return category;
    }
    
    // Par défaut, retourner 'autre'
    return 'autre';
}

// Configuration multer pour l'upload de fichiers (preuves)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Dossier selon le type de fichier
        let uploadDir;
        if (file.fieldname === 'facePhoto') {
            uploadDir = path.join(__dirname, '..', 'uploads', 'faces');
        } else {
            uploadDir = path.join(__dirname, '..', 'uploads', 'reports');
        }
        
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        if (file.fieldname === 'facePhoto') {
            cb(null, 'face-' + uniqueSuffix + path.extname(file.originalname));
        } else {
            cb(null, 'report-' + uniqueSuffix + path.extname(file.originalname));
        }
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Type de fichier non autorisé. Utilisez des images (JPG, PNG, GIF) ou des vidéos (MP4, MOV).'));
        }
    }
});

// Validation pour créer un signalement
const validateReport = [
    body('userType')
        .isIn(['eleve', 'professeur', 'parent', 'personnel', 'autre'])
        .withMessage('Type d\'utilisateur invalide'),
    body('category')
        .isIn(['harcelement', 'violence', 'fraude', 'discrimination', 'abus', 'drogue', 'administration', 'infrastructure', 'autre'])
        .withMessage('Catégorie invalide'),
    body('urgency')
        .isIn(['faible', 'moyen', 'eleve', 'critique'])
        .withMessage('Niveau d\'urgence invalide'),
    body('title')
        .trim()
        .isLength({ min: 10, max: 200 })
        .withMessage('Le titre doit contenir entre 10 et 200 caractères'),
    body('message')
        .trim()
        .isLength({ min: 50, max: 5000 })
        .withMessage('Le message doit contenir entre 50 et 5000 caractères'),
    body('location')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('Le lieu ne peut pas dépasser 200 caractères'),
    body('incidentDate')
        .optional()
        .isISO8601()
        .withMessage('Date d\'incident invalide'),
    body('witnesses')
        .optional()
        .isIn(['oui', 'non', 'incertain'])
        .withMessage('Valeur de témoins invalide'),
    body('firstTime')
        .optional()
        .isBoolean()
        .withMessage('Valeur première fois invalide'),
    body('schoolId')
        .optional()
        .isInt({ min: 1 })
        .withMessage('ID d\'école invalide'),
    body('schoolName')
        .optional()
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage('Le nom d\'école doit contenir entre 3 et 100 caractères'),
    body('isAnonymous')
        .optional()
        .isBoolean()
        .withMessage('Valeur d\'anonymat invalide')
];

// Middleware pour vérifier l'authentification optionnelle
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (!err && decoded.type === 'user') {
                req.user = decoded;
            }
        });
    }
    next();
}

// Route pour créer un signalement avec fichiers (photos/vidéos + photo visage)
router.post('/with-files', upload.fields([
    { name: 'facePhoto', maxCount: 1 },
    { name: 'attachments', maxCount: 5 }
]), (req, res) => {
    try {
        const {
            schoolCode,
            reportType,
            severity,
            description,
            location,
            isAnonymous,
            reporterName,
            reporterClass
        } = req.body;

        // Validation basique
        if (!schoolCode || !reportType || !severity || !description) {
            return res.status(400).json({
                success: false,
                message: 'Champs obligatoires manquants'
            });
        }

        if (description.length < 20) {
            return res.status(400).json({
                success: false,
                message: 'La description doit contenir au moins 20 caractères'
            });
        }

        const codeUpper = schoolCode.trim().toUpperCase();

        // Vérifier que l'école existe
        db.get('SELECT id, name, school_code FROM schools WHERE school_code = ?', [codeUpper], (err, school) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            if (!school) {
                return res.status(404).json({
                    success: false,
                    message: `Code d'école invalide. Vérifie le code avec ton école.`
                });
            }

            // Générer les codes
            const reportCode = `SF-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
            const accessCode = Math.floor(100000 + Math.random() * 900000).toString();

            // Préparer la photo de visage (OBLIGATOIRE)
            let facePhotoPath = null;
            if (req.files && req.files.facePhoto && req.files.facePhoto.length > 0) {
                const faceFile = req.files.facePhoto[0];
                facePhotoPath = `/uploads/faces/${faceFile.filename}`;
                console.log('📸 Photo de visage enregistrée:', facePhotoPath);
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Photo de visage obligatoire'
                });
            }

            // Préparer les informations des fichiers (preuves)
            let attachments = [];
            if (req.files && req.files.attachments && req.files.attachments.length > 0) {
                attachments = req.files.attachments.map(file => ({
                    filename: file.filename,
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                    path: `/uploads/reports/${file.filename}`
                }));
            }

            // Récupérer l'adresse IP pour l'analyse anti-abus
            const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';

            // Mapper la catégorie vers une catégorie valide
            const validCategory = mapCategoryToValid(reportType);
            console.log('🔵 Catégorie mappée:', reportType, '->', validCategory);

            // Insérer le signalement
            db.run(`
                INSERT INTO reports 
                (id, school_id, user_type, category, urgency, title, message, 
                 location, witnesses, first_time, is_anonymous, status, attachments, access_code, ip_address,
                 face_photo, face_verified, reporter_name, reporter_class)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)
            `, [
                reportCode,
                school.id,
                'eleve',
                validCategory,
                severity,
                `Signalement ${reportType}`,
                description,
                location || 'Non précisé',
                'non',
                true,
                isAnonymous === 'true' ? 1 : 0,
                attachments.length > 0 ? JSON.stringify(attachments) : null,
                accessCode,
                ipAddress,
                facePhotoPath,
                1, // face_verified = true
                reporterName || null,
                reporterClass || null
            ], function(err) {
                if (err) {
                    console.error('Erreur lors de la création du signalement:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la création du signalement'
                    });
                }

                console.log(`✅ Signalement créé: ${reportCode} avec ${attachments.length} fichier(s)`);
                console.log('╔════════════════════════════════════════════════════════════╗');
                console.log('║           📋 CODES DE SIGNALEMENT GÉNÉRÉS                 ║');
                console.log('╠════════════════════════════════════════════════════════════╣');
                console.log(`║  🔑 Code de suivi: ${reportCode.padEnd(30)} ║`);
                console.log(`║  🔐 Code d'accès:  ${accessCode.padEnd(30)} ║`);
                console.log(`║  🏫 École:         ${school.name.padEnd(30).substring(0, 30)} ║`);
                console.log('╠════════════════════════════════════════════════════════════╣');
                console.log('║  ⚠️  CONSERVEZ CES CODES PRÉCIEUSEMENT !                  ║');
                console.log('║  Ils permettent de suivre et discuter du signalement      ║');
                console.log('╚════════════════════════════════════════════════════════════╝');

                // Analyse anti-abus en arrière-plan (ne bloque pas la réponse)
                analyzeReport({
                    id: reportCode,
                    schoolId: school.id,
                    category: reportType,
                    urgency: severity,
                    message: description
                }, {
                    ipAddress: ipAddress,
                    hasAttachments: attachments.length > 0,
                    isAnonymous: isAnonymous === 'true'
                }).then(analysis => {
                    // Mettre à jour le trust_score et les flags d'abus
                    db.run(`
                        UPDATE reports 
                        SET trust_score = ?, abuse_flags = ?
                        WHERE id = ?
                    `, [
                        analysis.trustScore,
                        analysis.issues.length > 0 ? JSON.stringify(analysis.issues) : null,
                        reportCode
                    ], (updateErr) => {
                        if (updateErr) {
                            console.error('❌ Erreur MAJ trust_score:', updateErr);
                        } else {
                            console.log(`📊 Trust score: ${analysis.trustScore}/100 - Sévérité: ${analysis.severity}`);
                            if (analysis.needsReview) {
                                console.log('⚠️ Signalement marqué pour révision manuelle');
                            }
                        }
                    });
                }).catch(analysisErr => {
                    console.error('❌ Erreur analyse anti-abus:', analysisErr);
                });

                res.status(201).json({
                    success: true,
                    message: 'Signalement créé avec succès',
                    reportCode: reportCode,
                    accessCode: accessCode,
                    filesUploaded: attachments.length
                });
            });
        });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour créer un nouveau signalement
router.post('/', optionalAuth, (req, res) => {
    try {
        const {
            schoolId,
            schoolName,
            schoolCode,
            reportType,
            category,
            severity,
            urgency,
            title,
            message,
            description,
            location,
            incidentDate,
            userType,
            witnesses,
            firstTime,
            isAnonymous = true,
            contactInfo,
            isUrgent,
            priority,
            timing,
            personsInvolved
        } = req.body;

        // Normaliser les données selon le format reçu
        const normalizedData = {
            schoolId: schoolId,
            schoolName: schoolName,
            schoolCode: schoolCode,
            category: category || reportType, // Accepter "category" ou "reportType"
            urgency: urgency || severity, // Accepter "urgency" ou "severity"
            title: title || `Signalement ${reportType || category}`,
            message: message || description,
            location: location || 'Non précisé',
            incidentDate: incidentDate,
            userType: userType || 'eleve',
            witnesses: witnesses,
            firstTime: firstTime,
            isAnonymous: isAnonymous,
            contactInfo: contactInfo ? JSON.stringify(contactInfo) : null,
            isUrgent: isUrgent || urgency === 'critique',
            priority: priority,
            timing: timing,
            personsInvolved: personsInvolved
        };

        // Vérifier qu'on a soit schoolId, soit schoolName, soit schoolCode
        if (!normalizedData.schoolId && !normalizedData.schoolName && !normalizedData.schoolCode) {
            return res.status(400).json({
                success: false,
                message: 'Vous devez fournir le code de votre école'
            });
        }

        // Si pas anonyme, vérifier que l'utilisateur est connecté
        if (!normalizedData.isAnonymous && !req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentification requise pour un signalement non anonyme'
            });
        }

        // Générer un ID unique pour le signalement
        const reportCode = `SF-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        
        // Générer un code d'accès à 6 chiffres pour la discussion
        const accessCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Fonction pour créer le signalement avec un schoolId
        const createReportWithSchoolId = (finalSchoolId) => {
            // Insérer le signalement
            const userId = req.user ? req.user.userId : null;
            
            db.run(`
                INSERT INTO reports 
                (id, school_id, user_id, user_type, category, urgency, title, message, 
                 location, incident_date, witnesses, first_time, is_anonymous, status, contact_info, is_urgent, priority, timing, persons_involved, access_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)
            `, [
                reportCode, 
                finalSchoolId, 
                userId, 
                normalizedData.userType, 
                normalizedData.category, 
                normalizedData.urgency, 
                normalizedData.title, 
                normalizedData.message,
                normalizedData.location, 
                normalizedData.incidentDate || null, 
                normalizedData.witnesses || null, 
                normalizedData.firstTime || false, 
                normalizedData.isAnonymous,
                normalizedData.contactInfo,
                normalizedData.isUrgent || false,
                normalizedData.priority || null,
                normalizedData.timing || null,
                normalizedData.personsInvolved || null,
                accessCode
            ], function(err) {
                if (err) {
                    console.error('Erreur lors de l\'insertion du signalement:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la création du signalement'
                    });
                }

                res.status(201).json({
                    success: true,
                    message: 'Signalement créé avec succès',
                    reportCode: reportCode,
                    accessCode: accessCode
                });
            });
        };

        // PRIORITÉ 1 : Si on a un schoolCode, chercher l'école par code
        if (normalizedData.schoolCode) {
            const codeUpper = normalizedData.schoolCode.trim().toUpperCase();
            
            db.get('SELECT id, name, school_code FROM schools WHERE school_code = ?', [codeUpper], (err, school) => {
                if (err) {
                    console.error('Erreur base de données:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur interne du serveur'
                    });
                }

                if (!school) {
                    return res.status(404).json({
                        success: false,
                        message: `Code d'école invalide. Vérifie le code avec ton école. (Code fourni: ${codeUpper})`
                    });
                }

                console.log(`✅ École trouvée: ${school.name} (${school.school_code})`);
                createReportWithSchoolId(school.id);
            });
        }
        // PRIORITÉ 2 : Si on a un schoolId, vérifier que l'école existe
        else if (normalizedData.schoolId) {
            db.get('SELECT id FROM schools WHERE id = ?', [normalizedData.schoolId], (err, school) => {
                if (err) {
                    console.error('Erreur base de données:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur interne du serveur'
                    });
                }

                if (!school) {
                    return res.status(404).json({
                        success: false,
                        message: 'École non trouvée'
                    });
                }

                createReportWithSchoolId(normalizedData.schoolId);
            });
        } 
        // PRIORITÉ 3 : Si on a un schoolName, créer l'école d'abord ou la trouver
        else if (normalizedData.schoolName) {
            // Vérifier si l'école existe déjà
            db.get('SELECT id FROM schools WHERE name = ?', [normalizedData.schoolName], (err, existingSchool) => {
                if (err) {
                    console.error('Erreur base de données:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur interne du serveur'
                    });
                }

                if (existingSchool) {
                    // L'école existe déjà, utiliser son ID
                    createReportWithSchoolId(existingSchool.id);
                } else {
                    // Générer un code unique pour la nouvelle école
                    function generateSchoolCode(schoolName) {
                        const prefix = schoolName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
                        const suffix = Math.floor(1000 + Math.random() * 9000);
                        return `${prefix}${suffix}`;
                    }
                    
                    const generatedSchoolCode = generateSchoolCode(normalizedData.schoolName);
                    
                    // Créer la nouvelle école
                    db.run('INSERT INTO schools (school_code, name) VALUES (?, ?)', [generatedSchoolCode, normalizedData.schoolName], function(err) {
                        if (err) {
                            console.error('Erreur lors de la création de l\'école:', err);
                            return res.status(500).json({
                                success: false,
                                message: 'Erreur lors de la création de l\'école'
                            });
                        }

                        const newSchoolId = this.lastID;
                        createReportWithSchoolId(newSchoolId);
                    });
                }
            });
        }
    } catch (error) {
        console.error('Erreur lors de la création du signalement:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour obtenir tous les signalements (admin seulement)
router.get('/', authenticateToken, (req, res) => {
    const { status, category, urgency, search, page = 1, limit = 50 } = req.query;
    
    let query = `
        SELECT r.*, s.name as school_name, s.school_code
        FROM reports r
        LEFT JOIN schools s ON r.school_id = s.id
        WHERE 1=1
    `;
    
    const params = [];
    
    if (status) {
        query += ` AND r.status = ?`;
        params.push(status);
    }
    
    if (category) {
        query += ` AND r.category = ?`;
        params.push(category);
    }
    
    if (urgency) {
        query += ` AND r.urgency = ?`;
        params.push(urgency);
    }
    
    if (search) {
        query += ` AND (r.title LIKE ? OR r.message LIKE ? OR r.id LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    query += ` ORDER BY r.created_at DESC`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    
    db.all(query, params, (err, reports) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }
        
        // Compter le total
        let countQuery = `
            SELECT COUNT(*) as total
            FROM reports r
            WHERE 1=1
        `;
        const countParams = [];
        
        if (status) {
            countQuery += ` AND r.status = ?`;
            countParams.push(status);
        }
        
        if (category) {
            countQuery += ` AND r.category = ?`;
            countParams.push(category);
        }
        
        if (urgency) {
            countQuery += ` AND r.urgency = ?`;
            countParams.push(urgency);
        }
        
        if (search) {
            countQuery += ` AND (r.title LIKE ? OR r.message LIKE ? OR r.id LIKE ?)`;
            countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        db.get(countQuery, countParams, (err, count) => {
            res.json({
                success: true,
                reports: reports || [],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: count ? count.total : 0,
                    totalPages: count ? Math.ceil(count.total / parseInt(limit)) : 0
                }
            });
        });
    });
});

// Route pour suivre un signalement (anonyme)
router.get('/track/:trackingCode', (req, res) => {
    const { trackingCode } = req.params;

    if (!trackingCode || !trackingCode.startsWith('SF-')) {
        return res.status(400).json({
            success: false,
            message: 'Code de suivi invalide'
        });
    }

    db.get(`
        SELECT r.*, s.name as school_name
        FROM reports r
        JOIN schools s ON r.school_id = s.id
        WHERE r.id = ?
    `, [trackingCode], (err, report) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'Signalement non trouvé'
            });
        }

        // Récupérer les réponses visibles au signaleur
        db.all(`
            SELECT rr.message, rr.created_at, a.full_name as admin_name
            FROM report_responses rr
            JOIN administrators a ON rr.admin_id = a.id
            WHERE rr.report_id = ? AND rr.is_visible_to_reporter = 1
            ORDER BY rr.created_at ASC
        `, [trackingCode], (err, responses) => {
            if (err) {
                console.error('Erreur lors de la récupération des réponses:', err);
                responses = [];
            }

            res.json({
                success: true,
                report: {
                    id: report.id,
                    title: report.title,
                    category: report.category,
                    urgency: report.urgency,
                    status: report.status,
                    location: report.location,
                    incidentDate: report.incident_date,
                    createdAt: report.created_at,
                    updatedAt: report.updated_at,
                    schoolName: report.school_name,
                    responses: responses.map(r => ({
                        message: r.message,
                        createdAt: r.created_at,
                        adminName: 'Administration' // Anonymiser le nom de l'admin
                    }))
                }
            });
        });
    });
});

// Route pour obtenir tous les signalements d'une école (admin seulement)
router.get('/school/:schoolId', authenticateToken, (req, res) => {
    const { schoolId } = req.params;
    const { status, category, urgency, search, page = 1, limit = 20 } = req.query;

    // Vérifier que l'admin appartient à cette école
    if (req.admin.schoolId !== parseInt(schoolId)) {
        return res.status(403).json({
            success: false,
            message: 'Accès non autorisé à cette école'
        });
    }

    let whereClause = 'WHERE r.school_id = ?';
    let params = [schoolId];

    // Ajouter les filtres
    if (status) {
        whereClause += ' AND r.status = ?';
        params.push(status);
    }
    if (category) {
        whereClause += ' AND r.category = ?';
        params.push(category);
    }
    if (urgency) {
        whereClause += ' AND r.urgency = ?';
        params.push(urgency);
    }
    if (search) {
        whereClause += ' AND (r.title LIKE ? OR r.message LIKE ? OR r.id LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }

    const offset = (page - 1) * limit;

    // Compter le total
    db.get(`
        SELECT COUNT(*) as total
        FROM reports r
        ${whereClause}
    `, params, (err, countResult) => {
        if (err) {
            console.error('Erreur lors du comptage:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        // Récupérer les signalements
        db.all(`
            SELECT r.*, a.full_name as assigned_to_name,
                   (SELECT COUNT(*) FROM report_responses WHERE report_id = r.id) as response_count
            FROM reports r
            LEFT JOIN administrators a ON r.assigned_to = a.id
            ${whereClause}
            ORDER BY 
                CASE r.urgency 
                    WHEN 'critique' THEN 4 
                    WHEN 'eleve' THEN 3 
                    WHEN 'moyen' THEN 2 
                    ELSE 1 
                END DESC,
                r.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset], (err, reports) => {
            if (err) {
                console.error('Erreur lors de la récupération des signalements:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            res.json({
                success: true,
                reports,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.total,
                    totalPages: Math.ceil(countResult.total / limit)
                }
            });
        });
    });
});

// Route pour obtenir un signalement spécifique (admin seulement)
router.get('/:reportId', authenticateToken, (req, res) => {
    const { reportId } = req.params;

    db.get(`
        SELECT r.*, s.name as school_name, a.full_name as assigned_to_name
        FROM reports r
        JOIN schools s ON r.school_id = s.id
        LEFT JOIN administrators a ON r.assigned_to = a.id
        WHERE r.id = ? AND r.school_id = ?
    `, [reportId, req.admin.schoolId], (err, report) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'Signalement non trouvé'
            });
        }

        // Récupérer toutes les réponses (y compris celles non visibles au signaleur)
        db.all(`
            SELECT rr.*, a.full_name as admin_name
            FROM report_responses rr
            JOIN administrators a ON rr.admin_id = a.id
            WHERE rr.report_id = ?
            ORDER BY rr.created_at ASC
        `, [reportId], (err, responses) => {
            if (err) {
                console.error('Erreur lors de la récupération des réponses:', err);
                responses = [];
            }

            res.json({
                success: true,
                report: {
                    ...report,
                    responses
                }
            });
        });
    });
});

// Route pour mettre à jour le statut d'un signalement
router.patch('/:reportId/status', authenticateToken, (req, res) => {
    const { reportId } = req.params;
    const { status } = req.body;

    if (!['new', 'in-progress', 'resolved', 'archived'].includes(status)) {
        return res.status(400).json({
            success: false,
            message: 'Statut invalide'
        });
    }

    // Vérifier que le signalement appartient à l'école de l'admin
    db.get('SELECT id FROM reports WHERE id = ? AND school_id = ?', 
        [reportId, req.admin.schoolId], (err, report) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'Signalement non trouvé'
            });
        }

        // Mettre à jour le statut
        db.run(`
            UPDATE reports 
            SET status = ?, updated_at = CURRENT_TIMESTAMP, assigned_to = ?
            WHERE id = ?
        `, [status, req.admin.adminId, reportId], function(err) {
            if (err) {
                console.error('Erreur lors de la mise à jour:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour'
                });
            }

            res.json({
                success: true,
                message: 'Statut mis à jour avec succès'
            });
        });
    });
});

// Route pour ajouter une réponse à un signalement
router.post('/:reportId/responses', authenticateToken, [
    body('message')
        .trim()
        .isLength({ min: 10, max: 2000 })
        .withMessage('La réponse doit contenir entre 10 et 2000 caractères'),
    body('isVisibleToReporter')
        .optional()
        .isBoolean()
        .withMessage('Valeur de visibilité invalide')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Données invalides',
            errors: errors.array()
        });
    }

    const { reportId } = req.params;
    const { message, isVisibleToReporter = true } = req.body;

    // Vérifier que le signalement appartient à l'école de l'admin
    db.get('SELECT id, status FROM reports WHERE id = ? AND school_id = ?', 
        [reportId, req.admin.schoolId], (err, report) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'Signalement non trouvé'
            });
        }

        // Ajouter la réponse
        db.run(`
            INSERT INTO report_responses (report_id, admin_id, message, is_visible_to_reporter)
            VALUES (?, ?, ?, ?)
        `, [reportId, req.admin.adminId, message, isVisibleToReporter], function(err) {
            if (err) {
                console.error('Erreur lors de l\'ajout de la réponse:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de l\'ajout de la réponse'
                });
            }

            // Mettre à jour le statut à "in-progress" si c'est nouveau
            if (report.status === 'new') {
                db.run(`
                    UPDATE reports 
                    SET status = 'in-progress', updated_at = CURRENT_TIMESTAMP, assigned_to = ?
                    WHERE id = ?
                `, [req.admin.adminId, reportId]);
            }

            res.status(201).json({
                success: true,
                message: 'Réponse ajoutée avec succès',
                responseId: this.lastID
            });
        });
    });
});

// Route pour supprimer un signalement (admin)
router.delete('/:reportId', authenticateToken, (req, res) => {
    const { reportId } = req.params;

    // Vérifier que le signalement appartient à l'école de l'admin
    db.get('SELECT id FROM reports WHERE id = ? AND school_id = ?', 
        [reportId, req.admin.schoolId], (err, report) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'Signalement non trouvé'
            });
        }

        // Supprimer d'abord les réponses
        db.run('DELETE FROM report_responses WHERE report_id = ?', [reportId], (err) => {
            if (err) {
                console.error('Erreur lors de la suppression des réponses:', err);
            }
        });

        // Supprimer les messages de discussion
        db.run('DELETE FROM discussion_messages WHERE report_code = ?', [reportId], (err) => {
            if (err) {
                console.error('Erreur lors de la suppression des messages:', err);
            }
        });

        // Supprimer la discussion
        db.run('DELETE FROM discussions WHERE report_code = ?', [reportId], (err) => {
            if (err) {
                console.error('Erreur lors de la suppression de la discussion:', err);
            }
        });

        // Supprimer le signalement
        db.run('DELETE FROM reports WHERE id = ?', [reportId], function(err) {
            if (err) {
                console.error('Erreur lors de la suppression du signalement:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la suppression'
                });
            }

            res.json({
                success: true,
                message: 'Signalement supprimé avec succès'
            });
        });
    });
});

module.exports = router;
