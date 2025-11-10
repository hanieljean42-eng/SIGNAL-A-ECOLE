const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { displayWhatsAppLink, generateWhatsAppLink } = require('../utils/whatsapp');
const { getAbuseStats, getSuspiciousReports } = require('../utils/abuse-detection');

// Connexion à la base de données
const db = new sqlite3.Database(path.join(__dirname, '..', 'database', 'speakfree.db'));
const bcrypt = require('bcrypt');

// Route pour obtenir toutes les demandes d'inscription
router.get('/requests', (req, res) => {
    db.all(`
        SELECT 
            ar.*,
            s.name as school_name,
            s.school_code
        FROM admin_requests ar
        JOIN schools s ON ar.school_id = s.id
        ORDER BY ar.created_at DESC
    `, [], (err, requests) => {
        if (err) {
            console.error('Erreur lors de la récupération des demandes:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            requests: requests
        });
    });
});

// Route pour approuver une demande d'inscription
router.post('/requests/:requestId/approve', async (req, res) => {
    const { requestId } = req.params;

    try {
        // Récupérer la demande
        db.get('SELECT * FROM admin_requests WHERE id = ?', [requestId], async (err, request) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            if (!request) {
                return res.status(404).json({
                    success: false,
                    message: 'Demande non trouvée'
                });
            }

            if (request.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    message: 'Cette demande a déjà été traitée'
                });
            }

            // Créer l'administrateur
            db.run(`
                INSERT INTO administrators 
                (school_id, username, password_hash, full_name, email, phone, position, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
            `, [
                request.school_id,
                request.username,
                request.password_hash,
                `${request.first_name} ${request.last_name}`,
                request.email,
                request.phone,
                request.position
            ], function(err) {
                if (err) {
                    console.error('Erreur lors de la création de l\'administrateur:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la création du compte administrateur'
                    });
                }

                const adminId = this.lastID;

                // Mettre à jour le statut de la demande
                db.run(`
                    UPDATE admin_requests 
                    SET status = 'approved', approved_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `, [requestId], (err) => {
                    if (err) {
                        console.error('Erreur lors de la mise à jour:', err);
                        return res.status(500).json({
                            success: false,
                            message: 'Erreur lors de la mise à jour'
                        });
                    }

                    res.json({
                        success: true,
                        message: 'Demande approuvée et compte administrateur créé',
                        adminId: adminId
                    });
                });
            });
        });
    } catch (error) {
        console.error('Erreur lors de l\'approbation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour rejeter une demande d'inscription
router.post('/requests/:requestId/reject', (req, res) => {
    const { requestId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Raison du rejet requise'
        });
    }

    // Vérifier que la demande existe et est en attente
    db.get('SELECT * FROM admin_requests WHERE id = ?', [requestId], (err, request) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Demande non trouvée'
            });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'Cette demande a déjà été traitée'
            });
        }

        // Mettre à jour le statut de la demande
        db.run(`
            UPDATE admin_requests 
            SET status = 'rejected', rejected_reason = ?, approved_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [reason.trim(), requestId], (err) => {
            if (err) {
                console.error('Erreur lors de la mise à jour:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour'
                });
            }

            res.json({
                success: true,
                message: 'Demande rejetée'
            });
        });
    });
});

// Route pour obtenir les statistiques des demandes
router.get('/stats', (req, res) => {
    db.all(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
            COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
            COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
            COUNT(CASE WHEN created_at >= date('now', '-7 days') THEN 1 END) as recent
        FROM admin_requests
    `, [], (err, stats) => {
        if (err) {
            console.error('Erreur lors de la récupération des statistiques:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            stats: stats[0]
        });
    });
});

// Route pour obtenir une demande spécifique
router.get('/requests/:requestId', (req, res) => {
    const { requestId } = req.params;

    db.get(`
        SELECT 
            ar.*,
            s.name as school_name,
            s.school_code,
            s.city as school_city
        FROM admin_requests ar
        JOIN schools s ON ar.school_id = s.id
        WHERE ar.id = ?
    `, [requestId], (err, request) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Demande non trouvée'
            });
        }

        res.json({
            success: true,
            request: request
        });
    });
});

// ====== ROUTES POUR LA GESTION DES DEMANDES D'INSCRIPTION D'ÉCOLE ======

// Route pour obtenir toutes les demandes d'inscription d'école
router.get('/school-requests', (req, res) => {
    db.all(`
        SELECT *
        FROM school_registrations
        ORDER BY created_at DESC
    `, [], (err, requests) => {
        if (err) {
            console.error('Erreur lors de la récupération des demandes:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            requests: requests
        });
    });
});

// Route pour obtenir les statistiques des demandes d'école
router.get('/school-stats', (req, res) => {
    db.all(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
            COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
            COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
            COUNT(CASE WHEN created_at >= date('now', '-7 days') THEN 1 END) as recent
        FROM school_registrations
    `, [], (err, stats) => {
        if (err) {
            console.error('Erreur lors de la récupération des statistiques:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            stats: stats[0]
        });
    });
});

// Route pour obtenir une demande d'école spécifique
router.get('/school-requests/:requestId', (req, res) => {
    const { requestId } = req.params;

    db.get(`
        SELECT *
        FROM school_registrations
        WHERE id = ?
    `, [requestId], (err, request) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Demande non trouvée'
            });
        }

        res.json({
            success: true,
            request: request
        });
    });
});

// Route pour approuver une demande d'inscription d'école
router.post('/school-requests/:requestId/approve', async (req, res) => {
    const { requestId } = req.params;

    try {
        // Récupérer la demande
        db.get('SELECT * FROM school_registrations WHERE id = ?', [requestId], async (err, request) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            if (!request) {
                return res.status(404).json({
                    success: false,
                    message: 'Demande non trouvée'
                });
            }

            if (request.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    message: 'Cette demande a déjà été traitée'
                });
            }

            // Générer un code d'école unique
            function generateSchoolCode(schoolName) {
                const prefix = schoolName.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
                const suffix = Math.floor(1000 + Math.random() * 9000);
                return `${prefix}${suffix}`;
            }

            // Fonction pour vérifier l'unicité du code
            function createUniqueSchoolCode(callback) {
                const code = generateSchoolCode(request.school_name);
                db.get('SELECT id FROM schools WHERE school_code = ?', [code], (err, existing) => {
                    if (err) {
                        console.error('Erreur vérification code:', err);
                        return res.status(500).json({ success: false, message: 'Erreur serveur' });
                    }
                    
                    if (existing) {
                        // Si le code existe déjà, générer un nouveau
                        createUniqueSchoolCode(callback);
                    } else {
                        callback(code);
                    }
                });
            }

            // Utiliser la fonction pour créer un code unique
            createUniqueSchoolCode((schoolCode) => {

            // Créer l'école
            db.run(`
                INSERT INTO schools (
                    name, address, phone, email, school_code, city, is_verified, 
                    region, website, level, school_type, description, 
                    created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [
                request.school_name,
                request.school_address || '',
                request.school_phone,
                request.school_email,
                schoolCode,
                request.school_city,
                request.school_region || null,
                request.school_website || null,
                request.school_level || null,
                request.school_type || null,
                request.school_description || null
            ], function(err) {
                if (err) {
                    console.error('Erreur lors de la création de l\'école:', err);
                    console.error('Détails de l\'erreur:', {
                        message: err.message,
                        code: err.code,
                        errno: err.errno
                    });
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la création de l\'école: ' + err.message
                    });
                }

                const schoolId = this.lastID;
                console.log(`✅ École créée avec succès - ID: ${schoolId}, Code: ${schoolCode}`);

                // Générer un nom d'utilisateur unique pour l'admin
                const baseUsername = request.admin_email.split('@')[0].toLowerCase();
                let username = baseUsername;
                let counter = 1;

                // Vérifier l'unicité et créer l'admin
                function createAdmin() {
                    db.get('SELECT id FROM administrators WHERE username = ?', [username], (err, existing) => {
                        if (err) {
                            console.error('Erreur:', err);
                            return res.status(500).json({ success: false, message: 'Erreur serveur' });
                        }

                        if (existing) {
                            username = `${baseUsername}${counter}`;
                            counter++;
                            createAdmin();
                        } else {
                            // Créer l'administrateur
                            db.run(`
                                INSERT INTO administrators 
                                (school_id, username, email, password_hash, full_name, role, is_active, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, 'admin', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                            `, [
                                schoolId,
                                username,
                                request.admin_email,
                                request.admin_password_hash,
                                request.admin_full_name
                            ], function(err) {
                                if (err) {
                                    console.error('Erreur lors de la création de l\'admin:', err);
                                    console.error('Détails de l\'erreur:', {
                                        message: err.message,
                                        code: err.code,
                                        errno: err.errno,
                                        schoolId,
                                        username,
                                        email: request.admin_email
                                    });
                                    return res.status(500).json({
                                        success: false,
                                        message: 'Erreur lors de la création du compte administrateur: ' + err.message
                                    });
                                }

                                const adminId = this.lastID;
                                console.log(`✅ Admin créé avec succès - ID: ${adminId}, Username: ${username}`);

                                // Mettre à jour le statut de la demande
                                db.run(`
                                    UPDATE school_registrations 
                                    SET status = 'approved', 
                                        reviewed_at = CURRENT_TIMESTAMP,
                                        generated_school_code = ?,
                                        generated_school_id = ?,
                                        generated_admin_id = ?
                                    WHERE id = ?
                                `, [schoolCode, schoolId, adminId, requestId], (err) => {
                                    if (err) {
                                        console.error('Erreur lors de la mise à jour:', err);
                                        return res.status(500).json({
                                            success: false,
                                            message: 'Erreur lors de la mise à jour'
                                        });
                                    }

                                    // Préparer les données pour l'envoi
                                    const schoolData = {
                                        name: request.school_name,
                                        city: request.school_city,
                                        email: request.school_email,
                                        phone: request.school_phone
                                    };

                                    const adminData = {
                                        fullName: request.admin_full_name,
                                        email: request.admin_email,
                                        phone: request.admin_phone,
                                        username: username
                                    };

                                    // Générer le lien WhatsApp (seule méthode de communication)
                                    const whatsappData = displayWhatsAppLink(schoolData, adminData, schoolCode);
                                    
                                    console.log('📲 Informations d\'approbation disponibles via WhatsApp');
                                    console.log(`   Lien généré pour: ${request.admin_phone}`);

                                    // Répondre avec le lien WhatsApp
                                    res.json({
                                        success: true,
                                        message: 'École approuvée et créée avec succès',
                                        whatsappLink: whatsappData.link,
                                        whatsappPhone: whatsappData.phone,
                                        school: {
                                            id: schoolId,
                                            name: request.school_name,
                                            code: schoolCode
                                        },
                                        admin: {
                                            id: adminId,
                                            username: username,
                                            email: request.admin_email,
                                            phone: request.admin_phone
                                        }
                                    });
                                });
                            });
                        }
                    });
                }

                createAdmin();
            });
            }); // Fermer createUniqueSchoolCode
        });
    } catch (error) {
        console.error('Erreur lors de l\'approbation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour rejeter une demande d'inscription d'école
router.post('/school-requests/:requestId/reject', (req, res) => {
    const { requestId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Raison du rejet requise'
        });
    }

    // Vérifier que la demande existe et est en attente
    db.get('SELECT * FROM school_registrations WHERE id = ?', [requestId], (err, request) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Demande non trouvée'
            });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'Cette demande a déjà été traitée'
            });
        }

        // Mettre à jour le statut de la demande
        db.run(`
            UPDATE school_registrations 
            SET status = 'rejected', 
                rejected_reason = ?, 
                reviewed_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [reason.trim(), requestId], (err) => {
            if (err) {
                console.error('Erreur lors de la mise à jour:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour'
                });
            }

            res.json({
                success: true,
                message: 'Demande d\'école rejetée'
            });
        });
    });
});

// Route pour supprimer une école approuvée (retirer l'accès)
router.delete('/schools/:schoolId', (req, res) => {
    const { schoolId } = req.params;

    try {
        // Vérifier que l'école existe
        db.get('SELECT id, name, school_code, email FROM schools WHERE id = ?', [schoolId], (err, school) => {
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

            // D'abord, supprimer la demande d'inscription correspondante
            db.run('DELETE FROM school_registrations WHERE generated_school_id = ?', [schoolId], function(err) {
                if (err) {
                    console.error('Erreur suppression demande:', err);
                    // On continue quand même, ce n'est pas bloquant
                }

                // Ensuite, supprimer l'école et tout ce qui lui est lié (CASCADE)
                db.run('DELETE FROM schools WHERE id = ?', [schoolId], function(err) {
                    if (err) {
                        console.error('Erreur lors de la suppression:', err);
                        return res.status(500).json({
                            success: false,
                            message: 'Erreur lors de la suppression'
                        });
                    }

                    console.log(`🗑️ École supprimée: ${school.name} (${school.school_code})`);
                    console.log(`📧 Demande d'inscription supprimée pour permettre une nouvelle inscription`);

                    res.json({
                        success: true,
                        message: 'École et demande d\'inscription supprimées. L\'école peut maintenant se réinscrire.',
                        school: {
                            id: schoolId,
                            name: school.name,
                            code: school.school_code,
                            email: school.email
                        }
                    });
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

// Route pour supprimer une demande rejetée
router.delete('/school-requests/:requestId', (req, res) => {
    const { requestId } = req.params;

    try {
        // Vérifier que la demande existe
        db.get('SELECT id, school_name, status FROM school_registrations WHERE id = ?', [requestId], (err, request) => {
            if (err) {
                console.error('Erreur base de données:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            if (!request) {
                return res.status(404).json({
                    success: false,
                    message: 'Demande non trouvée'
                });
            }

            // Supprimer la demande
            db.run('DELETE FROM school_registrations WHERE id = ?', [requestId], function(err) {
                if (err) {
                    console.error('Erreur lors de la suppression:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la suppression'
                    });
                }

                console.log(`🗑️ Demande supprimée: ${request.school_name} (${request.status})`);

                res.json({
                    success: true,
                    message: 'Demande supprimée avec succès',
                    request: {
                        id: requestId,
                        name: request.school_name,
                        status: request.status
                    }
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

// ============ ROUTES RÉVÉLATION D'IDENTITÉ ============

// Route pour obtenir toutes les demandes de révélation d'identité
router.get('/identity-reveal-requests', (req, res) => {
    console.log('🔵 Récupération des demandes de révélation d\'identité...');
    
    db.all(`
        SELECT 
            irr.*,
            s.name as school_name,
            s.school_code,
            r.category as report_category,
            r.urgency as report_urgency,
            r.face_photo,
            r.reporter_name,
            r.reporter_class,
            r.created_at as report_created_at,
            a.full_name as admin_name
        FROM identity_reveal_requests irr
        JOIN schools s ON irr.school_id = s.id
        LEFT JOIN reports r ON irr.report_code = r.id
        LEFT JOIN administrators a ON irr.admin_id = a.id
        ORDER BY irr.created_at DESC
    `, [], (err, requests) => {
        if (err) {
            console.error('❌ Erreur récup demandes:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur: ' + err.message
            });
        }

        console.log('✅ Demandes trouvées:', requests ? requests.length : 0);
        if (requests && requests.length > 0) {
            console.log('🔵 Première demande:', requests[0]);
        }

        res.json({
            success: true,
            requests: requests || []
        });
    });
});

// Route pour approuver une demande de révélation
router.post('/identity-reveal-requests/:requestId/approve', (req, res) => {
    const { requestId } = req.params;
    const superAdminId = req.user?.id || 1; // ID du super-admin

    // Récupérer les détails de la demande et du signalement
    db.get(`
        SELECT 
            irr.*,
            r.user_id,
            r.is_anonymous,
            r.face_photo,
            r.reporter_name,
            r.reporter_class,
            u.full_name,
            u.email,
            u.phone,
            u.user_type,
            u.username
        FROM identity_reveal_requests irr
        JOIN reports r ON irr.report_code = r.id
        LEFT JOIN users u ON r.user_id = u.id
        WHERE irr.id = ?
    `, [requestId], (err, request) => {
        if (err) {
            console.error('Erreur:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Demande non trouvée'
            });
        }

        // Construire l'identité révélée
        let revealedIdentity = '';
        
        if (request.reporter_name) {
            revealedIdentity += `Nom: ${request.reporter_name}\n`;
        }
        
        if (request.reporter_class) {
            revealedIdentity += `Classe: ${request.reporter_class}\n`;
        }
        
        if (request.user_id && !request.is_anonymous) {
            if (request.full_name) revealedIdentity += `Nom complet: ${request.full_name}\n`;
            if (request.email) revealedIdentity += `Email: ${request.email}\n`;
            if (request.phone) revealedIdentity += `Téléphone: ${request.phone}\n`;
            if (request.username) revealedIdentity += `Username: ${request.username}\n`;
        }
        
        if (!revealedIdentity) {
            revealedIdentity = 'Signalement anonyme - Aucune information d\'identité disponible';
        }

        // Mettre à jour le statut de la demande avec l'identité révélée
        db.run(`
            UPDATE identity_reveal_requests
            SET status = 'approved',
                revealed_identity = ?,
                reviewed_at = datetime('now')
            WHERE id = ?
        `, [revealedIdentity, requestId], (err) => {
            if (err) {
                console.error('Erreur MAJ:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de l\'approbation'
                });
            }

            res.json({
                success: true,
                message: 'Demande approuvée et identité révélée à l\'école'
            });
        });
    });
});

// Route pour rejeter une demande de révélation
router.post('/identity-reveal-requests/:requestId/reject', (req, res) => {
    const { requestId } = req.params;
    const { reason } = req.body;
    const superAdminId = req.user?.id || 1;

    if (!reason || reason.length < 20) {
        return res.status(400).json({
            success: false,
            message: 'Raison de rejet requise (min 20 caractères)'
        });
    }

    db.run(`
        UPDATE identity_reveal_requests
        SET status = 'rejected',
            rejection_reason = ?,
            reviewed_by = ?,
            reviewed_at = datetime('now')
        WHERE id = ?
    `, [reason, superAdminId, requestId], (err) => {
        if (err) {
            console.error('Erreur rejet:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors du rejet'
            });
        }

        res.json({
            success: true,
            message: 'Demande rejetée'
        });
    });
});

// Route pour obtenir les statistiques des demandes de révélation
router.get('/identity-reveal-stats', (req, res) => {
    db.get(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
        FROM identity_reveal_requests
        WHERE created_at > datetime('now', '-30 days')
    `, [], (err, stats) => {
        if (err) {
            console.error('Erreur stats:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        // Stats par école
        db.all(`
            SELECT 
                s.name as school_name,
                s.school_code,
                COUNT(*) as request_count
            FROM identity_reveal_requests irr
            JOIN schools s ON irr.school_id = s.id
            WHERE irr.created_at > datetime('now', '-30 days')
            GROUP BY s.id
            ORDER BY request_count DESC
        `, [], (err, schoolStats) => {
            if (err) {
                console.error('Erreur stats écoles:', err);
                schoolStats = [];
            }

            res.json({
                success: true,
                stats: stats,
                schoolStats: schoolStats
            });
        });
    });
});

// ============ ROUTES ANTI-ABUS ============

// Route pour obtenir les statistiques d'abus
router.get('/abuse-stats', async (req, res) => {
    try {
        const stats = await getAbuseStats();
        
        // Statistiques supplémentaires
        db.get(`
            SELECT 
                COUNT(CASE WHEN trust_score < 25 THEN 1 END) as very_low_trust,
                COUNT(CASE WHEN trust_score BETWEEN 25 AND 49 THEN 1 END) as low_trust,
                COUNT(CASE WHEN trust_score BETWEEN 50 AND 74 THEN 1 END) as medium_trust,
                COUNT(CASE WHEN trust_score >= 75 THEN 1 END) as high_trust,
                COUNT(*) as total_reports
            FROM reports
            WHERE created_at > datetime('now', '-7 days')
        `, [], (err, reportStats) => {
            if (err) {
                console.error('Erreur stats reports:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur interne du serveur'
                });
            }

            res.json({
                success: true,
                abuseStats: stats,
                reportStats: reportStats
            });
        });
    } catch (error) {
        console.error('Erreur récup stats:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour révéler l'identité directement à une école (sans demande préalable)
router.post('/reveal-identity-direct', (req, res) => {
    const { reportCode, schoolId } = req.body;

    if (!reportCode || !schoolId) {
        return res.status(400).json({
            success: false,
            message: 'Code de signalement et ID école requis'
        });
    }

    // Récupérer les informations du signalement
    db.get(`
        SELECT 
            r.*,
            u.full_name,
            u.email,
            u.phone,
            u.username
        FROM reports r
        LEFT JOIN users u ON r.user_id = u.id
        WHERE r.id = ? AND r.school_id = ?
    `, [reportCode, schoolId], (err, report) => {
        if (err) {
            console.error('Erreur:', err);
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

        // Construire l'identité révélée
        let revealedIdentity = '';
        
        if (report.reporter_name) {
            revealedIdentity += `Nom: ${report.reporter_name}\n`;
        }
        
        if (report.reporter_class) {
            revealedIdentity += `Classe: ${report.reporter_class}\n`;
        }
        
        if (report.user_id && !report.is_anonymous) {
            if (report.full_name) revealedIdentity += `Nom complet: ${report.full_name}\n`;
            if (report.email) revealedIdentity += `Email: ${report.email}\n`;
            if (report.phone) revealedIdentity += `Téléphone: ${report.phone}\n`;
            if (report.username) revealedIdentity += `Username: ${report.username}\n`;
        }
        
        if (!revealedIdentity) {
            revealedIdentity = 'Signalement anonyme - Aucune information d\'identité disponible';
        }

        // Créer une notification pour l'école
        db.run(`
            INSERT INTO identity_reveal_requests
            (report_code, school_id, admin_id, justification, face_photo, status, revealed_identity, reviewed_at, created_at)
            VALUES (?, ?, 0, 'Révélation directe par le super administrateur', ?, 'approved', ?, datetime('now'), datetime('now'))
        `, [reportCode, schoolId, report.face_photo, revealedIdentity], function(err) {
            if (err) {
                console.error('Erreur création notification:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la révélation'
                });
            }

            res.json({
                success: true,
                message: 'Identité révélée à l\'école avec succès'
            });
        });
    });
});

// Route pour supprimer un signalement
router.delete('/reports/:reportId', (req, res) => {
    const { reportId } = req.params;

    // Supprimer d'abord les conversations associées
    db.run('DELETE FROM ai_conversations WHERE report_id = ?', [reportId], (err) => {
        if (err) console.error('Erreur suppression conversations:', err);
    });

    // Supprimer les logs d'abus
    db.run('DELETE FROM abuse_logs WHERE report_id = ?', [reportId], (err) => {
        if (err) console.error('Erreur suppression abuse_logs:', err);
    });

    // Supprimer les demandes de révélation d'identité
    db.run('DELETE FROM identity_reveal_requests WHERE report_code = ?', [reportId], (err) => {
        if (err) console.error('Erreur suppression identity_reveal_requests:', err);
    });

    // Supprimer le signalement
    db.run('DELETE FROM reports WHERE id = ?', [reportId], function(err) {
        if (err) {
            console.error('Erreur suppression signalement:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression'
            });
        }

        if (this.changes === 0) {
            return res.status(404).json({
                success: false,
                message: 'Signalement non trouvé'
            });
        }

        res.json({
            success: true,
            message: 'Signalement supprimé avec succès'
        });
    });
});

// Route pour obtenir TOUS les signalements
router.get('/all-reports', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    
    db.all(`
        SELECT 
            r.id,
            r.school_id,
            r.user_type,
            r.category,
            r.urgency,
            r.title,
            r.message,
            r.location,
            r.status,
            r.face_photo,
            r.face_verified,
            r.trust_score,
            r.created_at,
            r.reporter_name,
            r.reporter_class,
            s.name as school_name,
            s.school_code
        FROM reports r
        LEFT JOIN schools s ON r.school_id = s.id
        ORDER BY r.created_at DESC
        LIMIT ?
    `, [limit], (err, reports) => {
        if (err) {
            console.error('Erreur récup tous les signalements:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            reports: reports || []
        });
    });
});

// Route pour obtenir les signalements suspects
router.get('/suspicious-reports', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const reports = await getSuspiciousReports(limit);

        // Parser les issues JSON
        const parsedReports = reports.map(report => ({
            ...report,
            issues: report.issues ? JSON.parse(report.issues) : [],
            metadata: report.metadata ? JSON.parse(report.metadata) : {}
        }));

        res.json({
            success: true,
            reports: parsedReports
        });
    } catch (error) {
        console.error('Erreur récup signalements suspects:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route pour obtenir les détails d'un signalement suspect
router.get('/suspicious-reports/:reportId', (req, res) => {
    const { reportId } = req.params;

    db.get(`
        SELECT 
            r.*,
            s.name as school_name,
            s.school_code,
            al.trust_score as abuse_trust_score,
            al.severity as abuse_severity,
            al.issues as abuse_issues,
            al.created_at as abuse_detected_at
        FROM reports r
        JOIN schools s ON r.school_id = s.id
        LEFT JOIN abuse_logs al ON r.id = al.report_id
        WHERE r.id = ?
    `, [reportId], (err, report) => {
        if (err) {
            console.error('Erreur récup signalement:', err);
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

        // Parser les données JSON
        if (report.abuse_issues) {
            report.abuse_issues = JSON.parse(report.abuse_issues);
        }
        if (report.abuse_flags) {
            report.abuse_flags = JSON.parse(report.abuse_flags);
        }
        if (report.attachments) {
            report.attachments = JSON.parse(report.attachments);
        }

        res.json({
            success: true,
            report: report
        });
    });
});

// Route pour marquer un abus comme révisé
router.post('/abuse-logs/:logId/review', (req, res) => {
    const { logId } = req.params;
    const { action, notes } = req.body; // action: 'approved' ou 'flagged'

    db.run(`
        UPDATE abuse_logs
        SET reviewed = 1,
            reviewed_at = datetime('now'),
            reviewed_by = ?
        WHERE id = ?
    `, [req.user?.id || 1, logId], (err) => {
        if (err) {
            console.error('Erreur révision abus:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            message: 'Révision enregistrée'
        });
    });
});

// Route pour obtenir les IPs suspectes
router.get('/suspicious-ips', (req, res) => {
    db.all(`
        SELECT 
            ip_address,
            COUNT(*) as report_count,
            AVG(trust_score) as avg_trust_score,
            MAX(created_at) as last_report
        FROM reports
        WHERE ip_address IS NOT NULL
        AND created_at > datetime('now', '-30 days')
        GROUP BY ip_address
        HAVING report_count > 3 OR avg_trust_score < 50
        ORDER BY report_count DESC, avg_trust_score ASC
        LIMIT 100
    `, [], (err, ips) => {
        if (err) {
            console.error('Erreur IPs suspectes:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            ips: ips
        });
    });
});

module.exports = router;
