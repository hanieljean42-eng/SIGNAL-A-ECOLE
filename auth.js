const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();
const router = express.Router();

const db = new sqlite3.Database(process.env.DATABASE_PATH);

// Middleware pour valider les données d'entrée
const validateLogin = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Le nom d\'utilisateur doit contenir entre 3 et 50 caractères'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Le mot de passe doit contenir au moins 6 caractères')
];

const validateRegistration = [
    body('schoolName')
        .trim()
        .isLength({ min: 2, max: 150 })
        .withMessage('Le nom de l\'école doit contenir entre 2 et 150 caractères'),
    body('schoolAddress')
        .trim()
        .isLength({ min: 2, max: 250 })
        .withMessage('L\'adresse doit contenir entre 2 et 250 caractères'),
    body('schoolCity')
        .trim()
        .isLength({ min: 2, max: 80 })
        .withMessage('La ville doit contenir entre 2 et 80 caractères'),
    body('schoolRegion')
        .optional()
        .trim()
        .isLength({ max: 80 })
        .withMessage('La région ne peut pas dépasser 80 caractères'),
    body('schoolPhone')
        .trim()
        .isLength({ min: 8, max: 20 })
        .withMessage('Le téléphone doit contenir entre 8 et 20 caractères'),
    body('schoolEmail')
        .isEmail()
        .normalizeEmail()
        .withMessage('Format d\'email invalide'),
    body('schoolType')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Type d\'école invalide'),
    body('schoolLevel')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Niveau d\'école invalide'),
    body('schoolWebsite')
        .optional()
        .custom((value) => {
            if (!value) return true;
            const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
            return urlPattern.test(value);
        })
        .withMessage('Format d\'URL invalide (exemple: https://monecole.ci)'),
    body('schoolDescription')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('La description ne peut pas dépasser 1000 caractères'),
    body('adminFullName')
        .trim()
        .isLength({ min: 2, max: 120 })
        .withMessage('Le nom complet doit contenir entre 2 et 120 caractères'),
    body('adminEmail')
        .isEmail()
        .normalizeEmail()
        .withMessage('Format d\'email administrateur invalide'),
    body('adminPhone')
        .trim()
        .isLength({ min: 8, max: 20 })
        .withMessage('Le téléphone administrateur doit contenir entre 8 et 20 caractères'),
    body('adminPosition')
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Position administrative invalide'),
    body('adminPassword')
        .optional()
        .isLength({ min: 4 })
        .withMessage('Le mot de passe doit contenir au moins 4 caractères')
];

// Route de connexion
router.post('/login', validateLogin, async (req, res) => {
    try {
        // Vérifier les erreurs de validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides',
                errors: errors.array()
            });
        }

        const { username, password } = req.body;

        // Rechercher l'administrateur dans la base de données
        db.get(`
            SELECT a.*, s.name as school_name 
            FROM administrators a 
            JOIN schools s ON a.school_id = s.id 
            WHERE a.username = ? AND a.is_active = 1
        `, [username], async (err, admin) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            if (!admin) {
                return res.status(401).json({
                    success: false,
                    message: 'Identifiants incorrects'
                });
            }

            // Vérifier le mot de passe
            const isValidPassword = await bcrypt.compare(password, admin.password_hash);
            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    message: 'Identifiants incorrects'
                });
            }

            // Mettre à jour la dernière connexion
            db.run('UPDATE administrators SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);

            // Créer le token JWT
            const token = jwt.sign(
                { 
                    adminId: admin.id,
                    schoolId: admin.school_id,
                    username: admin.username,
                    role: admin.role
                },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
            );

            // Enregistrer l'activité
            logActivity(admin.id, 'LOGIN', null, null, 'Connexion réussie', req.ip, req.get('User-Agent'));

            res.json({
                success: true,
                message: 'Connexion réussie',
                token,
                admin: {
                    id: admin.id,
                    username: admin.username,
                    fullName: admin.full_name,
                    email: admin.email,
                    role: admin.role,
                    schoolName: admin.school_name,
                    schoolId: admin.school_id
                }
            });
        });
    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route de déconnexion
router.post('/logout', authenticateToken, (req, res) => {
    // Enregistrer l'activité
    logActivity(req.admin.adminId, 'LOGOUT', null, null, 'Déconnexion', req.ip, req.get('User-Agent'));
    
    res.json({
        success: true,
        message: 'Déconnexion réussie'
    });
});

// Route pour soumettre une demande d'inscription d'école (nécessite validation super-admin)
router.post('/register-school', validateRegistration, async (req, res) => {
    try {
        // Vérifier les erreurs de validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides',
                errors: errors.array()
            });
        }

        const {
            schoolName,
            schoolAddress,
            schoolCity,
            schoolRegion,
            schoolPhone,
            schoolEmail,
            schoolType,
            schoolLevel,
            schoolWebsite,
            schoolDescription,
            adminFullName,
            adminEmail,
            adminPhone,
            adminPosition,
            adminPassword = 'admin2025' // Mot de passe par défaut
        } = req.body;

        // Vérifier si une demande PENDING existe déjà ou si l'école est déjà enregistrée
        db.get(
            `SELECT id, 'registration' as type FROM school_registrations 
             WHERE (school_email = ? OR admin_email = ?) AND status = 'pending'
             UNION 
             SELECT id, 'school' as type FROM schools WHERE email = ? OR name = ?`,
            [schoolEmail, adminEmail, schoolEmail, schoolName],
            async (err, existing) => {
                if (err) {
                    console.error('Erreur base de données:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur interne du serveur'
                    });
                }

                if (existing) {
                    const message = existing.type === 'school' 
                        ? 'Cette école est déjà enregistrée et active dans le système'
                        : 'Une demande d\'inscription est déjà en cours de traitement pour cette école ou cet email';
                    
                    return res.status(409).json({
                        success: false,
                        message: message
                    });
                }

                try {
                    // Hacher le mot de passe
                    const passwordHash = await bcrypt.hash(adminPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
                    
                    // Générer un ID unique pour la demande
                    const requestId = `SCH-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

                    // Créer la demande d'inscription (en attente de validation)
                    db.run(`
                        INSERT INTO school_registrations (
                            id, school_name, school_address, school_city, school_region,
                            school_phone, school_email, school_type, school_level,
                            school_website, school_description,
                            admin_full_name, admin_email, admin_phone, admin_position,
                            admin_password_hash, status, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
                    `, [
                        requestId,
                        schoolName,
                        schoolAddress,
                        schoolCity,
                        schoolRegion || null,
                        schoolPhone,
                        schoolEmail,
                        schoolType,
                        schoolLevel,
                        schoolWebsite || null,
                        schoolDescription || null,
                        adminFullName,
                        adminEmail,
                        adminPhone,
                        adminPosition,
                        passwordHash
                    ], function(err) {
                        if (err) {
                            console.error('Erreur lors de la création de la demande:', err);
                            return res.status(500).json({
                                success: false,
                                message: 'Erreur lors de l\'enregistrement de la demande'
                            });
                        }

                        res.status(201).json({
                            success: true,
                            message: 'Demande d\'inscription soumise avec succès ! Votre demande sera examinée par notre équipe. Vous recevrez le code d\'école par email après validation.',
                            requestId: requestId,
                            estimatedReviewTime: '2-5 jours ouvrables',
                            status: 'pending'
                        });
                    });
                } catch (error) {
                    console.error('Erreur lors de la création de la demande:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Erreur lors du traitement de la demande'
                    });
                }
            }
        );
    } catch (error) {
        console.error('Erreur lors de l\'inscription:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour l'inscription d'un administrateur (demande d'accès)
router.post('/register-admin', [
    body('schoolId')
        .isInt({ min: 1 })
        .withMessage('ID d\'école invalide'),
    body('firstName')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Le prénom doit contenir entre 2 et 50 caractères'),
    body('lastName')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Le nom doit contenir entre 2 et 50 caractères'),
    body('position')
        .isIn(['directeur', 'proviseur', 'principal', 'adjoint', 'surveillant_general', 'conseiller_education', 'responsable_discipline', 'coordinateur', 'autre'])
        .withMessage('Fonction invalide'),
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Email invalide'),
    body('phone')
        .isMobilePhone('any')
        .withMessage('Numéro de téléphone invalide'),
    body('username')
        .trim()
        .isLength({ min: 3, max: 30 })
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Le nom d\'utilisateur doit contenir entre 3 et 30 caractères (lettres, chiffres, underscore uniquement)'),
    body('password')
        .isLength({ min: 8 })
        .withMessage('Le mot de passe doit contenir au moins 8 caractères'),
    body('justification')
        .trim()
        .isLength({ min: 20, max: 1000 })
        .withMessage('La justification doit contenir entre 20 et 1000 caractères')
], async (req, res) => {
    try {
        // Vérifier les erreurs de validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides',
                errors: errors.array()
            });
        }

        const {
            schoolId,
            firstName,
            lastName,
            position,
            email,
            phone,
            username,
            password,
            justification
        } = req.body;

        // Vérifier si l'école existe
        db.get('SELECT id, name, school_code FROM schools WHERE id = ?', [schoolId], async (err, school) => {
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

            // Vérifier si l'email ou le nom d'utilisateur existe déjà
            db.get(
                'SELECT id FROM administrators WHERE email = ? OR username = ? UNION SELECT id FROM admin_requests WHERE email = ? OR username = ?',
                [email, username, email, username],
                async (err, existing) => {
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
                            message: 'Cet email ou ce nom d\'utilisateur est déjà utilisé'
                        });
                    }

                    try {
                        // Hacher le mot de passe
                        const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
                        
                        // Générer un ID unique pour la demande
                        const requestId = `ADM-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

                        // Enregistrer la demande d'inscription
                        db.run(`
                            INSERT INTO admin_requests 
                            (id, school_id, first_name, last_name, position, email, phone, username, password_hash, justification, status, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
                        `, [
                            requestId,
                            schoolId,
                            firstName,
                            lastName,
                            position,
                            email,
                            phone,
                            username,
                            passwordHash,
                            justification
                        ], function(err) {
                            if (err) {
                                console.error('Erreur lors de l\'enregistrement de la demande:', err);
                                return res.status(500).json({
                                    success: false,
                                    message: 'Erreur lors de l\'enregistrement de la demande'
                                });
                            }

                            res.status(201).json({
                                success: true,
                                message: 'Demande d\'inscription soumise avec succès',
                                requestId: requestId,
                                school: {
                                    name: school.name,
                                    code: school.school_code
                                }
                            });
                        });
                    } catch (error) {
                        console.error('Erreur lors du hachage du mot de passe:', error);
                        res.status(500).json({
                            success: false,
                            message: 'Erreur lors du traitement de la demande'
                        });
                    }
                }
            );
        });
    } catch (error) {
        console.error('Erreur lors de l\'inscription admin:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour vérifier la disponibilité d'un nom d'utilisateur
router.get('/check-username', (req, res) => {
    const { username } = req.query;
    
    if (!username || username.length < 3) {
        return res.status(400).json({
            success: false,
            message: 'Nom d\'utilisateur invalide'
        });
    }

    db.get(
        'SELECT id FROM administrators WHERE username = ? UNION SELECT id FROM admin_requests WHERE username = ?',
        [username, username],
        (err, existing) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            res.json({
                success: true,
                available: !existing
            });
        }
    );
});

// Route pour vérifier le token
router.get('/verify', authenticateToken, (req, res) => {
    res.json({
        success: true,
        admin: req.admin
    });
});

// Route pour demander la réinitialisation du mot de passe
router.post('/request-password-reset', [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Email invalide')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Email invalide',
                errors: errors.array()
            });
        }

        const { email } = req.body;

        // Rechercher l'administrateur par email
        db.get('SELECT id, username, email, full_name FROM administrators WHERE email = ? AND is_active = 1', [email], async (err, admin) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            // Toujours renvoyer un succès même si l'email n'existe pas (sécurité)
            if (!admin) {
                return res.json({
                    success: true,
                    message: 'Si cet email existe dans notre système, un code de réinitialisation a été envoyé.'
                });
            }

            // Générer un code de réinitialisation à 6 chiffres
            const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
            
            // Générer un token unique
            const token = require('crypto').randomBytes(32).toString('hex');
            
            // Le token expire dans 30 minutes
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

            // Supprimer les anciens tokens non utilisés de cet admin
            db.run('DELETE FROM password_reset_tokens WHERE admin_id = ? AND used = 0', [admin.id], (err) => {
                if (err) {
                    console.error('Erreur suppression anciens tokens:', err);
                }

                // Insérer le nouveau token
                db.run(`
                    INSERT INTO password_reset_tokens (admin_id, token, reset_code, expires_at)
                    VALUES (?, ?, ?, ?)
                `, [admin.id, token, resetCode, expiresAt], function(err) {
                    if (err) {
                        console.error('Erreur création token:', err);
                        return res.status(500).json({
                            success: false,
                            message: 'Erreur lors de la génération du code'
                        });
                    }

                    // Dans un environnement de production, envoyer un email/SMS avec le code
                    // Pour le développement, afficher le code dans la console
                    console.log('\n🔐 CODE DE RÉINITIALISATION GÉNÉRÉ 🔐');
                    console.log('═══════════════════════════════════════');
                    console.log(`Email: ${admin.email}`);
                    console.log(`Nom: ${admin.full_name}`);
                    console.log(`Code: ${resetCode}`);
                    console.log(`Token: ${token}`);
                    console.log(`Expire: ${new Date(expiresAt).toLocaleString('fr-FR')}`);
                    console.log('═══════════════════════════════════════\n');

                    // Enregistrer l'activité
                    logActivity(admin.id, 'PASSWORD_RESET_REQUEST', null, null, 'Demande de réinitialisation de mot de passe', req.ip, req.get('User-Agent'));

                    res.json({
                        success: true,
                        message: 'Un code de réinitialisation a été généré. Vérifiez votre email.',
                        token: token, // Retourner le token pour la prochaine étape
                        // En développement seulement - NE PAS FAIRE EN PRODUCTION
                        devMode: process.env.NODE_ENV !== 'production' ? { resetCode } : undefined
                    });
                });
            });
        });
    } catch (error) {
        console.error('Erreur demande réinitialisation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour réinitialiser le mot de passe avec le code
router.post('/reset-password', [
    body('token')
        .notEmpty()
        .withMessage('Token requis'),
    body('resetCode')
        .isLength({ min: 6, max: 6 })
        .isNumeric()
        .withMessage('Code de réinitialisation invalide (6 chiffres requis)'),
    body('newPassword')
        .isLength({ min: 6 })
        .withMessage('Le nouveau mot de passe doit contenir au moins 6 caractères')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Données invalides',
                errors: errors.array()
            });
        }

        const { token, resetCode, newPassword } = req.body;

        // Vérifier le token et le code
        db.get(`
            SELECT prt.*, a.id as admin_id, a.username, a.email, a.full_name
            FROM password_reset_tokens prt
            JOIN administrators a ON prt.admin_id = a.id
            WHERE prt.token = ? AND prt.reset_code = ? AND prt.used = 0
        `, [token, resetCode], async (err, resetToken) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            if (!resetToken) {
                return res.status(400).json({
                    success: false,
                    message: 'Code de réinitialisation invalide ou expiré'
                });
            }

            // Vérifier si le token a expiré
            if (new Date(resetToken.expires_at) < new Date()) {
                return res.status(400).json({
                    success: false,
                    message: 'Le code de réinitialisation a expiré. Veuillez demander un nouveau code.'
                });
            }

            try {
                // Hacher le nouveau mot de passe
                const newPasswordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);

                // Mettre à jour le mot de passe
                db.run('UPDATE administrators SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                    [newPasswordHash, resetToken.admin_id], (err) => {
                    if (err) {
                        console.error('Erreur mise à jour mot de passe:', err);
                        return res.status(500).json({
                            success: false,
                            message: 'Erreur lors de la réinitialisation du mot de passe'
                        });
                    }

                    // Marquer le token comme utilisé
                    db.run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetToken.id], (err) => {
                        if (err) {
                            console.error('Erreur mise à jour token:', err);
                        }
                    });

                    // Enregistrer l'activité
                    logActivity(resetToken.admin_id, 'PASSWORD_RESET', null, null, 'Mot de passe réinitialisé avec succès', req.ip, req.get('User-Agent'));

                    res.json({
                        success: true,
                        message: 'Mot de passe réinitialisé avec succès ! Vous pouvez maintenant vous connecter.',
                        username: resetToken.username
                    });
                });
            } catch (error) {
                console.error('Erreur hachage mot de passe:', error);
                res.status(500).json({
                    success: false,
                    message: 'Erreur lors du traitement du mot de passe'
                });
            }
        });
    } catch (error) {
        console.error('Erreur réinitialisation mot de passe:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Middleware d'authentification
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Token d\'accès requis'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, admin) => {
        if (err) {
            return res.status(403).json({
                success: false,
                message: 'Token invalide ou expiré'
            });
        }

        req.admin = admin;
        next();
    });
}

// Fonction pour enregistrer les activités
function logActivity(adminId, action, targetType, targetId, details, ipAddress, userAgent) {
    db.run(`
        INSERT INTO activity_logs 
        (admin_id, action, target_type, target_id, details, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [adminId, action, targetType, targetId, details, ipAddress, userAgent], (err) => {
        if (err) {
            console.error('Erreur lors de l\'enregistrement de l\'activité:', err);
        }
    });
}

module.exports = router;
module.exports.authenticateToken = authenticateToken;
