const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();
const { authenticateToken } = require('./auth');
const router = express.Router();

const db = new sqlite3.Database(process.env.DATABASE_PATH);

// Middleware pour vérifier les permissions super admin
const requireSuperAdmin = (req, res, next) => {
    if (req.admin.role !== 'super_admin') {
        return res.status(403).json({
            success: false,
            message: 'Accès réservé aux super administrateurs'
        });
    }
    next();
};

// Fonction pour logger les activités des administrateurs
function logActivity(adminId, actionType, resourceType, resourceId, description, ipAddress, userAgent) {
    db.run(`
        INSERT INTO admin_activity_logs 
        (admin_id, action_type, resource_type, resource_id, description, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [adminId, actionType, resourceType, resourceId, description, ipAddress, userAgent], (err) => {
        if (err) {
            console.error('❌ Erreur log activité admin:', err);
        }
    });
}

// Route pour obtenir les statistiques du tableau de bord
router.get('/dashboard/stats', authenticateToken, (req, res) => {
    const schoolId = req.admin.schoolId;

    // Statistiques des signalements
    db.all(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_reports,
            SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
            SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) as archived,
            SUM(CASE WHEN urgency = 'critique' THEN 1 ELSE 0 END) as critical,
            SUM(CASE WHEN urgency = 'eleve' THEN 1 ELSE 0 END) as high,
            SUM(CASE WHEN urgency = 'moyen' THEN 1 ELSE 0 END) as medium,
            SUM(CASE WHEN urgency = 'faible' THEN 1 ELSE 0 END) as low
        FROM reports 
        WHERE school_id = ?
    `, [schoolId], (err, stats) => {
        if (err) {
            console.error('Erreur lors de la récupération des statistiques:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        // Statistiques par catégorie
        db.all(`
            SELECT category, COUNT(*) as count
            FROM reports 
            WHERE school_id = ?
            GROUP BY category
            ORDER BY count DESC
        `, [schoolId], (err, categoryStats) => {
            if (err) {
                console.error('Erreur lors de la récupération des statistiques par catégorie:', err);
                categoryStats = [];
            }

            // Statistiques par mois (6 derniers mois)
            db.all(`
                SELECT 
                    strftime('%Y-%m', created_at) as month,
                    COUNT(*) as count
                FROM reports 
                WHERE school_id = ? AND created_at >= date('now', '-6 months')
                GROUP BY strftime('%Y-%m', created_at)
                ORDER BY month DESC
            `, [schoolId], (err, monthlyStats) => {
                if (err) {
                    console.error('Erreur lors de la récupération des statistiques mensuelles:', err);
                    monthlyStats = [];
                }

                res.json({
                    success: true,
                    stats: stats[0] || {
                        total: 0, new_reports: 0, in_progress: 0, 
                        resolved: 0, archived: 0, critical: 0, 
                        high: 0, medium: 0, low: 0
                    },
                    categoryStats,
                    monthlyStats
                });
            });
        });
    });
});

// Route pour obtenir les demandes d'inscription en attente (super admin seulement)
router.get('/registrations/pending', authenticateToken, requireSuperAdmin, (req, res) => {
    db.all(`
        SELECT sr.*, a.full_name as reviewed_by_name
        FROM school_registrations sr
        LEFT JOIN administrators a ON sr.reviewed_by = a.id
        WHERE sr.status = 'pending'
        ORDER BY sr.created_at DESC
    `, [], (err, registrations) => {
        if (err) {
            console.error('Erreur lors de la récupération des demandes:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            registrations
        });
    });
});

// Route pour approuver/rejeter une demande d'inscription (super admin seulement)
router.patch('/registrations/:registrationId', authenticateToken, requireSuperAdmin, [
    body('status')
        .isIn(['approved', 'rejected'])
        .withMessage('Statut invalide'),
    body('reviewNotes')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Les notes ne peuvent pas dépasser 500 caractères')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Données invalides',
            errors: errors.array()
        });
    }

    const { registrationId } = req.params;
    const { status, reviewNotes } = req.body;

    try {
        // Récupérer la demande
        db.get('SELECT * FROM school_registrations WHERE id = ? AND status = "pending"', 
            [registrationId], async (err, registration) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            if (!registration) {
                return res.status(404).json({
                    success: false,
                    message: 'Demande non trouvée ou déjà traitée'
                });
            }

            if (status === 'approved') {
                // Créer l'école
                db.run(`
                    INSERT INTO schools (name, address, phone, email)
                    VALUES (?, ?, ?, ?)
                `, [
                    registration.school_name,
                    registration.school_address,
                    registration.school_phone,
                    registration.school_email
                ], async function(err) {
                    if (err) {
                        console.error('Erreur lors de la création de l\'école:', err);
                        return res.status(500).json({
                            success: false,
                            message: 'Erreur lors de la création de l\'école'
                        });
                    }

                    const schoolId = this.lastID;

                    // Créer l'administrateur
                    try {
                        // Générer un mot de passe temporaire
                        const tempPassword = Math.random().toString(36).slice(-8);
                        const passwordHash = await bcrypt.hash(tempPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
                        
                        // Générer un nom d'utilisateur unique
                        const baseUsername = registration.admin_email.split('@')[0].toLowerCase();
                        let username = baseUsername;
                        let counter = 1;
                        
                        // Vérifier l'unicité du nom d'utilisateur
                        while (true) {
                            const existingUser = await new Promise((resolve, reject) => {
                                db.get('SELECT id FROM administrators WHERE username = ?', [username], (err, row) => {
                                    if (err) reject(err);
                                    else resolve(row);
                                });
                            });
                            
                            if (!existingUser) break;
                            username = `${baseUsername}${counter}`;
                            counter++;
                        }

                        db.run(`
                            INSERT INTO administrators 
                            (school_id, username, email, password_hash, full_name, role)
                            VALUES (?, ?, ?, ?, ?, 'admin')
                        `, [
                            schoolId,
                            username,
                            registration.admin_email,
                            passwordHash,
                            registration.admin_full_name
                        ], function(err) {
                            if (err) {
                                console.error('Erreur lors de la création de l\'admin:', err);
                                return res.status(500).json({
                                    success: false,
                                    message: 'Erreur lors de la création de l\'administrateur'
                                });
                            }

                            // Mettre à jour la demande
                            updateRegistrationStatus(registrationId, status, reviewNotes, req.admin.adminId, res, {
                                schoolId,
                                adminId: this.lastID,
                                username,
                                tempPassword
                            });
                        });
                    } catch (error) {
                        console.error('Erreur lors du hachage du mot de passe:', error);
                        return res.status(500).json({
                            success: false,
                            message: 'Erreur lors de la création de l\'administrateur'
                        });
                    }
                });
            } else {
                // Rejeter la demande
                updateRegistrationStatus(registrationId, status, reviewNotes, req.admin.adminId, res);
            }
        });
    } catch (error) {
        console.error('Erreur lors du traitement de la demande:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour obtenir les logs d'activité
router.get('/activity-logs', authenticateToken, (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [];

    // Si ce n'est pas un super admin, limiter aux activités de son école
    if (req.admin.role !== 'super_admin') {
        whereClause = 'WHERE a.school_id = ?';
        params.push(req.admin.schoolId);
    }

    db.all(`
        SELECT al.*, a.full_name as admin_name, a.username
        FROM activity_logs al
        LEFT JOIN administrators a ON al.admin_id = a.id
        ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset], (err, logs) => {
        if (err) {
            console.error('Erreur lors de la récupération des logs:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            logs
        });
    });
});

// Route pour créer un nouvel administrateur (super admin seulement)
router.post('/administrators', authenticateToken, requireSuperAdmin, [
    body('username')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Le nom d\'utilisateur doit contenir entre 3 et 50 caractères'),
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Adresse email invalide'),
    body('fullName')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Le nom complet doit contenir entre 2 et 100 caractères'),
    body('password')
        .isLength({ min: 8 })
        .withMessage('Le mot de passe doit contenir au moins 8 caractères'),
    body('role')
        .isIn(['admin', 'moderator'])
        .withMessage('Rôle invalide'),
    body('schoolId')
        .isInt({ min: 1 })
        .withMessage('ID d\'école invalide')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Données invalides',
            errors: errors.array()
        });
    }

    const { username, email, fullName, password, role, schoolId } = req.body;

    try {
        // Vérifier que l'école existe
        db.get('SELECT id FROM schools WHERE id = ?', [schoolId], async (err, school) => {
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

            // Vérifier l'unicité du nom d'utilisateur et de l'email
            db.get('SELECT id FROM administrators WHERE username = ? OR email = ?', 
                [username, email], async (err, existing) => {
                if (err) {
                    console.error('Erreur base de données:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur interne du serveur'
                    });
                }

                if (existing) {
                    return res.status(409).json({
                        success: false,
                        message: 'Nom d\'utilisateur ou email déjà utilisé'
                    });
                }

                try {
                    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

                    db.run(`
                        INSERT INTO administrators 
                        (school_id, username, email, password_hash, full_name, role)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [schoolId, username, email, passwordHash, fullName, role], function(err) {
                        if (err) {
                            console.error('Erreur lors de la création de l\'admin:', err);
                            return res.status(500).json({
                                success: false,
                                message: 'Erreur lors de la création de l\'administrateur'
                            });
                        }

                        res.status(201).json({
                            success: true,
                            message: 'Administrateur créé avec succès',
                            adminId: this.lastID
                        });
                    });
                } catch (error) {
                    console.error('Erreur lors du hachage du mot de passe:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la création de l\'administrateur'
                    });
                }
            });
        });
    } catch (error) {
        console.error('Erreur lors de la création de l\'admin:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour obtenir la liste des administrateurs
router.get('/administrators', authenticateToken, (req, res) => {
    let whereClause = '';
    let params = [];

    // Si ce n'est pas un super admin, limiter aux admins de son école
    if (req.admin.role !== 'super_admin') {
        whereClause = 'WHERE a.school_id = ?';
        params.push(req.admin.schoolId);
    }

    db.all(`
        SELECT a.id, a.username, a.email, a.full_name, a.role, a.is_active, 
               a.last_login, a.created_at, s.name as school_name
        FROM administrators a
        JOIN schools s ON a.school_id = s.id
        ${whereClause}
        ORDER BY a.created_at DESC
    `, params, (err, administrators) => {
        if (err) {
            console.error('Erreur lors de la récupération des admins:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            administrators
        });
    });
});

// Route pour obtenir les utilisateurs de l'école de l'admin
router.get('/school-users', authenticateToken, (req, res) => {
    const schoolId = req.admin.schoolId;

    db.all(`
        SELECT u.id, u.username, u.email, u.full_name, u.user_type, u.class_level, 
               u.phone, u.is_active, u.last_login, u.created_at,
               COUNT(r.id) as report_count
        FROM users u
        LEFT JOIN reports r ON u.id = r.user_id
        WHERE u.school_id = ?
        GROUP BY u.id
        ORDER BY u.created_at DESC
    `, [schoolId], (err, users) => {
        if (err) {
            console.error('Erreur lors de la récupération des utilisateurs:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            users
        });
    });
});

// Route pour demander la révélation d'identité (cas graves)
router.post('/reveal-identity', authenticateToken, [
    body('reportCode')
        .trim()
        .isLength({ min: 5 })
        .withMessage('Code de signalement invalide'),
    body('justification')
        .trim()
        .isLength({ min: 50, max: 2000 })
        .withMessage('La justification doit contenir entre 50 et 2000 caractères'),
    body('adminPassword')
        .isLength({ min: 1 })
        .withMessage('Mot de passe administrateur requis')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Données invalides',
            errors: errors.array()
        });
    }

    const { reportCode, justification, adminPassword } = req.body;
    const adminId = req.admin.adminId;
    const schoolId = req.admin.schoolId;

    try {
        // Vérifier le mot de passe de l'administrateur
        const admin = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM administrators WHERE id = ?', [adminId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Administrateur non trouvé'
            });
        }

        // Vérifier le mot de passe
        const passwordMatch = await bcrypt.compare(adminPassword, admin.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: 'Mot de passe administrateur incorrect'
            });
        }

        // Chercher le signalement
        db.get(`
            SELECT r.*, u.full_name, u.email, u.phone, u.user_type, u.username
            FROM reports r
            LEFT JOIN users u ON r.user_id = u.id
            WHERE r.id = ? AND r.school_id = ?
        `, [reportCode, schoolId], (err, report) => {
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
                    message: 'Signalement non trouvé ou non autorisé'
                });
            }

            // Générer un ID unique pour la demande
            const requestId = `REV-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

            // Enregistrer la demande de révélation dans les logs d'audit
            db.run(`
                INSERT INTO identity_reveal_requests 
                (id, report_id, admin_id, school_id, justification, admin_name, created_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [requestId, reportCode, adminId, schoolId, justification, admin.full_name], function(err) {
                if (err) {
                    console.error('Erreur lors de l\'enregistrement:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur lors de l\'enregistrement de la demande'
                    });
                }

                // Enregistrer l'activité
                logActivity(adminId, 'IDENTITY_REVEAL_REQUEST', 'report', reportCode, 
                    `Demande de révélation d'identité: ${justification.substring(0, 100)}`, req.ip, req.get('User-Agent'));

                // La demande est maintenant en attente d'approbation par le super-admin
                res.json({
                    success: true,
                    requestId: requestId,
                    status: 'pending',
                    message: 'Demande de révélation envoyée au super-administrateur. Vous recevrez une notification une fois approuvée.'
                });
            });
        });
    } catch (error) {
        console.error('Erreur lors de la révélation d\'identité:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour activer/désactiver un utilisateur
router.patch('/users/:userId/status', authenticateToken, [
    body('isActive')
        .isBoolean()
        .withMessage('Statut invalide')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Données invalides',
            errors: errors.array()
        });
    }

    const { userId } = req.params;
    const { isActive } = req.body;

    // Vérifier que l'utilisateur appartient à l'école de l'admin
    db.get('SELECT id FROM users WHERE id = ? AND school_id = ?', 
        [userId, req.admin.schoolId], (err, user) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        // Mettre à jour le statut
        db.run(`
            UPDATE users 
            SET is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [isActive ? 1 : 0, userId], function(err) {
            if (err) {
                console.error('Erreur lors de la mise à jour:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour'
                });
            }

            // Enregistrer l'activité
            const action = isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';
            logActivity(req.admin.adminId, action, 'user', userId, 
                `Utilisateur ${isActive ? 'activé' : 'désactivé'}`, req.ip, req.get('User-Agent'));

            res.json({
                success: true,
                message: `Utilisateur ${isActive ? 'activé' : 'désactivé'} avec succès`
            });
        });
    });
});

// Fonction helper pour mettre à jour le statut d'une demande
function updateRegistrationStatus(registrationId, status, reviewNotes, reviewedBy, res, createdData = null) {
    db.run(`
        UPDATE school_registrations 
        SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [status, reviewNotes, reviewedBy, registrationId], function(err) {
        if (err) {
            console.error('Erreur lors de la mise à jour de la demande:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour de la demande'
            });
        }

        const response = {
            success: true,
            message: status === 'approved' ? 'Demande approuvée avec succès' : 'Demande rejetée'
        };

        if (createdData) {
            response.createdSchool = {
                schoolId: createdData.schoolId,
                adminId: createdData.adminId,
                username: createdData.username,
                tempPassword: createdData.tempPassword
            };
        }

        res.json(response);
    });
}

// ============ ROUTES RÉVÉLATION D'IDENTITÉ (ADMIN) ============

// Route pour créer une demande de révélation d'identité
router.post('/identity-reveal-request', authenticateToken, (req, res) => {
    const { reportCode, justification } = req.body;
    
    console.log('🔵 Demande de révélation reçue');
    console.log('🔵 req.admin:', req.admin);
    console.log('🔵 reportCode:', reportCode);
    console.log('🔵 justification:', justification);
    
    if (!req.admin) {
        return res.status(401).json({
            success: false,
            message: 'Non authentifié'
        });
    }
    
    // Le token JWT utilise adminId et schoolId (pas id)
    const adminId = req.admin.adminId;
    const schoolId = req.admin.schoolId;
    
    console.log('🔵 adminId:', adminId);
    console.log('🔵 schoolId:', schoolId);

    if (!reportCode || !justification) {
        return res.status(400).json({
            success: false,
            message: 'Code de signalement et justification requis'
        });
    }

    if (justification.length < 50) {
        return res.status(400).json({
            success: false,
            message: 'La justification doit contenir au moins 50 caractères'
        });
    }

    // Vérifier que le signalement existe et appartient à l'école
    db.get(`
        SELECT id, face_photo, reporter_name, reporter_class, is_anonymous
        FROM reports
        WHERE id = ? AND school_id = ?
    `, [reportCode, schoolId], (err, report) => {
        if (err) {
            console.error('❌ Erreur BD:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        console.log('🔵 Signalement trouvé:', report);

        if (!report) {
            console.log('❌ Signalement non trouvé');
            return res.status(404).json({
                success: false,
                message: 'Signalement non trouvé ou n\'appartient pas à votre école'
            });
        }

        console.log('✅ Signalement existe, création de la demande...');

        // Vérifier s'il n'y a pas déjà une demande en attente
        db.get(`
            SELECT id FROM identity_reveal_requests
            WHERE report_code = ? AND school_id = ? AND status = 'pending'
        `, [reportCode, schoolId], (err, existing) => {
            if (err) {
                console.error('Erreur BD:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: 'Une demande est déjà en attente pour ce signalement'
                });
            }

            // Créer la demande
            console.log('🔵 Insertion dans identity_reveal_requests...');
            console.log('🔵 Données:', { 
                reportCode, 
                schoolId, 
                adminId, 
                justification: justification.substring(0, 50) + '...', 
                face_photo: report.face_photo ? 'Oui' : 'Non' 
            });
            
            // Vérifier d'abord que la table existe
            db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='identity_reveal_requests'`, (err, table) => {
                if (err) {
                    console.error('❌ Erreur vérification table:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur vérification table'
                    });
                }
                
                if (!table) {
                    console.error('❌ Table identity_reveal_requests n\'existe pas!');
                    return res.status(500).json({
                        success: false,
                        message: 'Table identity_reveal_requests n\'existe pas. Exécutez le script fix-identity-reveal-table.js'
                    });
                }
                
                console.log('✅ Table existe, insertion...');
                
                db.run(`
                    INSERT INTO identity_reveal_requests
                    (report_code, school_id, admin_id, justification, face_photo, status, created_at)
                    VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
                `, [reportCode, schoolId, adminId, justification, report.face_photo], function(err) {
                    if (err) {
                        console.error('❌ Erreur création demande:', err);
                        console.error('❌ Détails:', err.message);
                        return res.status(500).json({
                            success: false,
                            message: 'Erreur lors de la création de la demande: ' + err.message
                        });
                    }

                    console.log('✅ Demande créée avec succès! ID:', this.lastID);

                    res.json({
                        success: true,
                        message: 'Demande créée avec succès',
                        requestId: this.lastID
                    });
                });
            });
        });
    });
});

// Route pour obtenir les demandes de révélation d'identité de l'admin
router.get('/identity-reveal-requests', authenticateToken, (req, res) => {
    const schoolId = req.admin.schoolId;

    db.all(`
        SELECT 
            irr.*,
            r.title as report_title
        FROM identity_reveal_requests irr
        LEFT JOIN reports r ON irr.report_code = r.id
        WHERE irr.school_id = ?
        ORDER BY irr.created_at DESC
    `, [schoolId], (err, requests) => {
        if (err) {
            console.error('Erreur récup demandes:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        // Masquer la photo si la demande n'est pas approuvée
        const sanitizedRequests = requests.map(req => {
            if (req.status !== 'approved') {
                // Ne pas envoyer la photo si pas encore approuvé
                return { ...req, face_photo: null };
            }
            return req;
        });

        res.json({
            success: true,
            requests: sanitizedRequests || []
        });
    });
});

module.exports = router;
