const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { authenticateToken } = require('./auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const db = new sqlite3.Database(process.env.DATABASE_PATH);

// Route pour vérifier l'accès à une discussion (utilisateur avec code d'accès)
router.post('/verify-access', (req, res) => {
    const { reportCode, accessCode } = req.body;

    if (!reportCode || !accessCode) {
        return res.status(400).json({
            success: false,
            message: 'Code de signalement et code d\'accès requis'
        });
    }

    // Vérifier le code d'accès
    db.get(`
        SELECT * FROM reports 
        WHERE id = ? AND access_code = ?
    `, [reportCode, accessCode], (err, report) => {
        if (err) {
            console.error('Erreur:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        if (!report) {
            return res.status(401).json({
                success: false,
                message: 'Code de signalement ou code d\'accès incorrect'
            });
        }

        // Accès autorisé
        res.json({
            success: true,
            message: 'Accès autorisé',
            report: {
                id: report.id,
                urgency: report.urgency,
                category: report.category
            },
            token: Buffer.from(`${reportCode}:${accessCode}`).toString('base64')
        });
    });
});

// Configuration multer pour l'upload de fichiers
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../uploads/discussions');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Type de fichier non autorisé'));
        }
    }
});

// Route pour obtenir les messages d'une discussion
router.get('/:reportCode', (req, res) => {
    const { reportCode } = req.params;

    db.all(`
        SELECT * FROM discussion_messages 
        WHERE report_code = ? 
        ORDER BY created_at ASC
    `, [reportCode], (err, messages) => {
        if (err) {
            console.error('Erreur:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        res.json({
            success: true,
            messages: messages
        });
    });
});

// Route pour envoyer un message admin (JSON simple)
router.post('/send-admin', authenticateToken, (req, res) => {
    const { reportCode, message } = req.body;
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (!reportCode || !message) {
        return res.status(400).json({
            success: false,
            message: 'Report code et message requis'
        });
    }

    db.run(`
        INSERT INTO discussion_messages 
        (id, report_code, sender_type, message, is_ai_checked, created_at)
        VALUES (?, ?, 'admin', ?, 1, datetime('now'))
    `, [messageId, reportCode, message], function(err) {
        if (err) {
            console.error('Erreur envoi message admin:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'envoi du message'
            });
        }

        // Mettre à jour la discussion et METTRE EN PAUSE L'IA
        db.run(`
            UPDATE discussions 
            SET last_activity = datetime('now'),
                status = 'active',
                ai_enabled = 0,
                ai_paused_by = 'school',
                ai_paused_at = datetime('now')
            WHERE report_code = ?
        `, [reportCode], (err) => {
            if (err) {
                console.log('Erreur update discussion:', err);
            }
        });

        // Créer la discussion si elle n'existe pas (IA désactivée par défaut quand l'école répond)
        db.run(`
            INSERT OR IGNORE INTO discussions 
            (report_code, last_activity, status, unread_count, ai_enabled, ai_paused_by, ai_paused_at)
            VALUES (?, datetime('now'), 'active', 0, 0, 'school', datetime('now'))
        `, [reportCode]);

        res.json({
            success: true,
            messageId: messageId
        });
    });
});

// Route pour envoyer un message
router.post('/send', upload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'proof_0', maxCount: 1 },
    { name: 'proof_1', maxCount: 1 },
    { name: 'proof_2', maxCount: 1 }
]), (req, res) => {
    const { reportCode, message, senderType } = req.body;
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Gérer les pièces jointes
    let attachmentData = null;
    if (req.files) {
        if (req.files.attachment && req.files.attachment[0]) {
            const file = req.files.attachment[0];
            attachmentData = {
                name: file.originalname,
                url: `/uploads/discussions/${file.filename}`,
                type: file.mimetype.startsWith('image/') ? 'image' : 'document',
                size: file.size
            };
        }

        // Gérer les preuves
        const proofs = [];
        for (let i = 0; i < 3; i++) {
            const key = `proof_${i}`;
            if (req.files[key] && req.files[key][0]) {
                const file = req.files[key][0];
                proofs.push({
                    name: file.originalname,
                    url: `/uploads/discussions/${file.filename}`,
                    type: file.mimetype.startsWith('image/') ? 'image' : 'document',
                    size: file.size
                });
            }
        }

        if (proofs.length > 0) {
            attachmentData = {
                proofs: proofs,
                type: 'proofs'
            };
        }
    }

    db.run(`
        INSERT INTO discussion_messages 
        (id, report_code, sender_type, message, attachment, is_ai_checked, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
        messageId,
        reportCode,
        senderType,
        message,
        attachmentData ? JSON.stringify(attachmentData) : null,
        true
    ], function(err) {
        if (err) {
            console.error('Erreur:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'envoi du message'
            });
        }

        // Marquer la discussion comme active
        db.run(`
            INSERT OR REPLACE INTO discussions 
            (report_code, last_activity, status)
            VALUES (?, datetime('now'), 'active')
        `, [reportCode]);

        res.json({
            success: true,
            messageId: messageId
        });
    });
});

// Route pour obtenir toutes les discussions (admin) - Alias
router.get('/admin/discussions', authenticateToken, (req, res) => {
    const schoolId = req.admin.schoolId;
    const filter = req.query.filter || 'all';

    let whereClause = 'WHERE r.school_id = ?';
    if (filter === 'unread') {
        whereClause += ' AND d.unread_count > 0';
    } else if (filter === 'active') {
        whereClause += ' AND d.status = "active"';
    } else if (filter === 'closed') {
        whereClause += ' AND d.status = "closed"';
    }

    db.all(`
        SELECT 
            r.id as report_code,
            r.title as report_title,
            r.urgency,
            d.last_activity,
            d.status,
            d.unread_count,
            (SELECT COUNT(*) FROM discussion_messages WHERE report_code = r.id) as message_count
        FROM reports r
        LEFT JOIN discussions d ON d.report_code = r.id
        ${whereClause}
        ORDER BY d.last_activity DESC
    `, [schoolId], (err, discussions) => {
        if (err) {
            console.error('Erreur:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        res.json({
            success: true,
            discussions: discussions || []
        });
    });
});

// Route pour obtenir toutes les discussions (admin)
router.get('/admin/list', authenticateToken, (req, res) => {
    const schoolId = req.admin.schoolId;
    const filter = req.query.filter || 'all';

    let whereClause = 'WHERE r.school_id = ?';
    if (filter === 'unread') {
        whereClause += ' AND d.unread_count > 0';
    } else if (filter === 'active') {
        whereClause += ' AND d.status = "active"';
    } else if (filter === 'closed') {
        whereClause += ' AND d.status = "closed"';
    }

    db.all(`
        SELECT 
            r.id as report_code,
            r.title as report_title,
            r.urgency,
            d.last_activity,
            d.status,
            d.unread_count,
            (SELECT COUNT(*) FROM discussion_messages WHERE report_code = r.id) as message_count
        FROM reports r
        LEFT JOIN discussions d ON d.report_code = r.id
        ${whereClause}
        ORDER BY d.last_activity DESC
    `, [schoolId], (err, discussions) => {
        if (err) {
            console.error('Erreur:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        res.json({
            success: true,
            discussions: discussions || []
        });
    });
});

// Route pour marquer comme lu (admin)
router.post('/:reportCode/mark-read', authenticateToken, (req, res) => {
    const { reportCode } = req.params;

    db.run(`
        UPDATE discussions 
        SET unread_count = 0 
        WHERE report_code = ?
    `, [reportCode], (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        res.json({ success: true });
    });
});

// Route pour supprimer une discussion (admin)
router.delete('/:reportCode', authenticateToken, (req, res) => {
    const { reportCode } = req.params;
    const schoolId = req.admin.schoolId;

    // Vérifier que la discussion appartient à l'école
    db.get(`
        SELECT r.id FROM reports r
        WHERE r.id = ? AND r.school_id = ?
    `, [reportCode, schoolId], (err, report) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'Discussion non trouvée'
            });
        }

        // Supprimer les messages
        db.run(`DELETE FROM discussion_messages WHERE report_code = ?`, [reportCode], (err) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la suppression des messages'
                });
            }

            // Supprimer la discussion
            db.run(`DELETE FROM discussions WHERE report_code = ?`, [reportCode], (err) => {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur lors de la suppression de la discussion'
                    });
                }

                res.json({
                    success: true,
                    message: 'Discussion supprimée avec succès'
                });
            });
        });
    });
});

// Route pour activer/désactiver l'IA dans une discussion (admin)
router.post('/:reportCode/toggle-ai', authenticateToken, (req, res) => {
    const { reportCode } = req.params;
    const { enabled } = req.body;
    const schoolId = req.admin.schoolId;

    // Vérifier que la discussion appartient à l'école
    db.get(`
        SELECT r.id FROM reports r
        WHERE r.id = ? AND r.school_id = ?
    `, [reportCode, schoolId], (err, report) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        if (!report) {
            return res.status(404).json({
                success: false,
                message: 'Discussion non trouvée'
            });
        }

        // Mettre à jour le statut de l'IA
        db.run(`
            UPDATE discussions 
            SET ai_enabled = ?,
                ai_paused_by = ?,
                ai_paused_at = datetime('now')
            WHERE report_code = ?
        `, [enabled ? 1 : 0, enabled ? null : 'admin', reportCode], (err) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur serveur'
                });
            }

            res.json({
                success: true,
                message: enabled ? 'IA activée' : 'IA désactivée',
                ai_enabled: enabled
            });
        });
    });
});

// Route pour obtenir le statut de l'IA dans une discussion (admin)
router.get('/:reportCode/ai-status', authenticateToken, (req, res) => {
    const { reportCode } = req.params;

    db.get(`
        SELECT ai_enabled, ai_paused_by, ai_paused_at 
        FROM discussions 
        WHERE report_code = ?
    `, [reportCode], (err, discussion) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        if (!discussion) {
            // Créer la discussion si elle n'existe pas
            db.run(`
                INSERT OR IGNORE INTO discussions 
                (report_code, last_activity, status, unread_count, ai_enabled)
                VALUES (?, datetime('now'), 'active', 0, 1)
            `, [reportCode], (err) => {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: 'Erreur serveur'
                    });
                }
                
                return res.json({
                    success: true,
                    ai_enabled: true,
                    ai_paused_by: null,
                    ai_paused_at: null
                });
            });
        } else {
            res.json({
                success: true,
                ai_enabled: discussion.ai_enabled === 1,
                ai_paused_by: discussion.ai_paused_by,
                ai_paused_at: discussion.ai_paused_at
            });
        }
    });
});

module.exports = router;
