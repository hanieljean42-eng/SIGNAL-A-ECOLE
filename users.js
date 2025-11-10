const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();
const router = express.Router();

const db = new sqlite3.Database(process.env.DATABASE_PATH);

// Middleware pour valider l'inscription utilisateur
const validateUserRegistration = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 30 })
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Le nom d\'utilisateur doit contenir entre 3 et 30 caractères (lettres, chiffres, underscore uniquement)'),
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Adresse email invalide'),
    body('password')
        .isLength({ min: 6, max: 100 })
        .withMessage('Le mot de passe doit contenir entre 6 et 100 caractères'),
    body('confirmPassword')
        .custom((value, { req }) => {
            if (value !== req.body.password) {
                throw new Error('Les mots de passe ne correspondent pas');
            }
            return true;
        }),
    body('fullName')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Le nom complet doit contenir entre 2 et 100 caractères'),
    body('userType')
        .isIn(['eleve', 'professeur', 'parent', 'personnel', 'autre'])
        .withMessage('Type d\'utilisateur invalide'),
    body('schoolId')
        .optional()
        .isInt({ min: 1 })
        .withMessage('ID d\'école invalide'),
    body('schoolName')
        .optional()
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage('Le nom d\'école doit contenir entre 3 et 100 caractères'),
    body('classLevel')
        .optional()
        .trim()
        .isLength({ max: 50 })
        .withMessage('Le niveau de classe ne peut pas dépasser 50 caractères'),
    body('phone')
        .optional()
        .isMobilePhone('any')
        .withMessage('Numéro de téléphone invalide')
];

// Middleware pour valider la connexion utilisateur
const validateUserLogin = [
    body('username')
        .trim()
        .notEmpty()
        .withMessage('Nom d\'utilisateur requis'),
    body('password')
        .notEmpty()
        .withMessage('Mot de passe requis')
];

// Route d'inscription utilisateur
router.post('/register', validateUserRegistration, async (req, res) => {
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
            username,
            email,
            password,
            fullName,
            userType,
            schoolId,
            schoolName,
            classLevel,
            phone
        } = req.body;

        // Vérifier qu'on a soit schoolId soit schoolName
        if (!schoolId && !schoolName) {
            return res.status(400).json({
                success: false,
                message: 'Vous devez spécifier soit un ID d\'école soit un nom d\'école'
            });
        }

        // Fonction pour créer l'utilisateur avec un schoolId
        const createUserWithSchoolId = async (finalSchoolId) => {
            // Vérifier l'unicité du nom d'utilisateur et de l'email
            db.get('SELECT id FROM users WHERE username = ? OR email = ?', 
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
                        message: 'Ce nom d\'utilisateur ou cet email est déjà utilisé'
                    });
                }

                try {
                    // Hacher le mot de passe
                    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

                    // Créer l'utilisateur
                    db.run(`
                        INSERT INTO users 
                        (school_id, username, email, password_hash, full_name, user_type, class_level, phone)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [finalSchoolId, username, email, passwordHash, fullName, userType, classLevel || null, phone || null], 
                    function(err) {
                        if (err) {
                            console.error('Erreur lors de la création de l\'utilisateur:', err);
                            return res.status(500).json({
                                success: false,
                                message: 'Erreur lors de la création du compte'
                            });
                        }

                        res.status(201).json({
                            success: true,
                            message: 'Compte créé avec succès ! Vous pouvez maintenant vous connecter.',
                            userId: this.lastID
                        });
                    });
                } catch (error) {
                    console.error('Erreur lors du hachage du mot de passe:', error);
                    res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la création du compte'
                    });
                }
            });
        };

        // Si on a un schoolId, vérifier que l'école existe
        if (schoolId) {
            db.get('SELECT id FROM schools WHERE id = ?', [schoolId], (err, school) => {
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

                createUserWithSchoolId(schoolId);
            });
        } 
        // Si on a un schoolName, créer l'école d'abord ou la trouver
        else if (schoolName) {
            // Vérifier si l'école existe déjà
            db.get('SELECT id FROM schools WHERE name = ?', [schoolName], (err, existingSchool) => {
                if (err) {
                    console.error('Erreur base de données:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur interne du serveur'
                    });
                }

                if (existingSchool) {
                    // L'école existe déjà, utiliser son ID
                    createUserWithSchoolId(existingSchool.id);
                } else {
                    // Générer un code unique pour la nouvelle école
                    function generateSchoolCode(schoolName) {
                        const prefix = schoolName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
                        const suffix = Math.floor(1000 + Math.random() * 9000);
                        return `${prefix}${suffix}`;
                    }
                    
                    const schoolCode = generateSchoolCode(schoolName);
                    
                    // Créer la nouvelle école
                    db.run('INSERT INTO schools (school_code, name) VALUES (?, ?)', [schoolCode, schoolName], function(err) {
                        if (err) {
                            console.error('Erreur lors de la création de l\'école:', err);
                            return res.status(500).json({
                                success: false,
                                message: 'Erreur lors de la création de l\'école'
                            });
                        }

                        const newSchoolId = this.lastID;
                        createUserWithSchoolId(newSchoolId);
                    });
                }
            });
        }
    } catch (error) {
        console.error('Erreur lors de l\'inscription:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route de connexion utilisateur
router.post('/login', validateUserLogin, async (req, res) => {
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

        // Rechercher l'utilisateur dans la base de données
        db.get(`
            SELECT u.*, s.name as school_name 
            FROM users u 
            JOIN schools s ON u.school_id = s.id 
            WHERE u.username = ? AND u.is_active = 1
        `, [username], async (err, user) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Nom d\'utilisateur ou mot de passe incorrect'
                });
            }

            // Vérifier le mot de passe
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    message: 'Nom d\'utilisateur ou mot de passe incorrect'
                });
            }

            // Mettre à jour la dernière connexion
            db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

            // Créer le token JWT
            const token = jwt.sign(
                { 
                    userId: user.id,
                    schoolId: user.school_id,
                    username: user.username,
                    userType: user.user_type,
                    type: 'user' // Distinguer des tokens admin
                },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
            );

            res.json({
                success: true,
                message: 'Connexion réussie',
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    fullName: user.full_name,
                    email: user.email,
                    userType: user.user_type,
                    classLevel: user.class_level,
                    schoolName: user.school_name,
                    schoolId: user.school_id
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

// Route pour vérifier le token utilisateur
router.get('/verify', authenticateUserToken, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

// Route pour obtenir le profil utilisateur
router.get('/profile', authenticateUserToken, (req, res) => {
    db.get(`
        SELECT u.id, u.username, u.email, u.full_name, u.user_type, u.class_level, 
               u.phone, u.created_at, s.name as school_name
        FROM users u
        JOIN schools s ON u.school_id = s.id
        WHERE u.id = ?
    `, [req.user.userId], (err, user) => {
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

        res.json({
            success: true,
            user
        });
    });
});

// Route pour obtenir les signalements de l'utilisateur
router.get('/my-reports', authenticateUserToken, (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Compter le total
    db.get('SELECT COUNT(*) as total FROM reports WHERE user_id = ?', 
        [req.user.userId], (err, countResult) => {
        if (err) {
            console.error('Erreur lors du comptage:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        // Récupérer les signalements
        db.all(`
            SELECT r.id, r.title, r.category, r.urgency, r.status, r.location, 
                   r.incident_date, r.is_anonymous, r.created_at, r.updated_at,
                   (SELECT COUNT(*) FROM report_responses WHERE report_id = r.id AND is_visible_to_reporter = 1) as response_count
            FROM reports r
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [req.user.userId, limit, offset], (err, reports) => {
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

// Route pour mettre à jour le profil
router.put('/profile', authenticateUserToken, [
    body('fullName')
        .optional()
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Le nom complet doit contenir entre 2 et 100 caractères'),
    body('email')
        .optional()
        .isEmail()
        .normalizeEmail()
        .withMessage('Adresse email invalide'),
    body('classLevel')
        .optional()
        .trim()
        .isLength({ max: 50 })
        .withMessage('Le niveau de classe ne peut pas dépasser 50 caractères'),
    body('phone')
        .optional()
        .isMobilePhone('any')
        .withMessage('Numéro de téléphone invalide')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Données invalides',
            errors: errors.array()
        });
    }

    const { fullName, email, classLevel, phone } = req.body;
    const updates = {};
    const params = [];

    if (fullName !== undefined) {
        updates.full_name = fullName;
        params.push(fullName);
    }
    if (email !== undefined) {
        updates.email = email;
        params.push(email);
    }
    if (classLevel !== undefined) {
        updates.class_level = classLevel;
        params.push(classLevel);
    }
    if (phone !== undefined) {
        updates.phone = phone;
        params.push(phone);
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Aucune donnée à mettre à jour'
        });
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    params.push(req.user.userId);

    db.run(`
        UPDATE users 
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, params, function(err) {
        if (err) {
            console.error('Erreur lors de la mise à jour:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du profil'
            });
        }

        res.json({
            success: true,
            message: 'Profil mis à jour avec succès'
        });
    });
});

// Middleware d'authentification pour les utilisateurs
function authenticateUserToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Token d\'accès requis'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({
                success: false,
                message: 'Token invalide ou expiré'
            });
        }

        // Vérifier que c'est bien un token utilisateur
        if (decoded.type !== 'user') {
            return res.status(403).json({
                success: false,
                message: 'Token invalide pour cette ressource'
            });
        }

        req.user = decoded;
        next();
    });
}

module.exports = router;
module.exports.authenticateUserToken = authenticateUserToken;
