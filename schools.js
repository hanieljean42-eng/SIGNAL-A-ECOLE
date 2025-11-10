const express = require('express');
const { body, validationResult } = require('express-validator');
const sqlite3 = require('sqlite3').verbose();
const { authenticateToken } = require('./auth');
const router = express.Router();

const db = new sqlite3.Database(process.env.DATABASE_PATH);

// Route pour obtenir la liste des écoles (publique)
router.get('/', (req, res) => {
    db.all(`
        SELECT id, name, address, phone, email
        FROM schools
        ORDER BY name ASC
    `, [], (err, schools) => {
        if (err) {
            console.error('Erreur lors de la récupération des écoles:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        res.json({
            success: true,
            schools
        });
    });
});

// Route pour obtenir les détails d'une école spécifique
router.get('/:schoolId', (req, res) => {
    const { schoolId } = req.params;

    db.get(`
        SELECT s.*, 
               COUNT(r.id) as total_reports,
               COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) as resolved_reports
        FROM schools s
        LEFT JOIN reports r ON s.id = r.school_id
        WHERE s.id = ?
        GROUP BY s.id
    `, [schoolId], (err, school) => {
        if (err) {
            console.error('Erreur lors de la récupération de l\'école:', err);
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

        res.json({
            success: true,
            school
        });
    });
});

// Route pour mettre à jour les informations d'une école (admin seulement)
router.put('/:schoolId', authenticateToken, [
    body('name')
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage('Le nom de l\'école doit contenir entre 3 et 100 caractères'),
    body('address')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('L\'adresse ne peut pas dépasser 200 caractères'),
    body('phone')
        .optional()
        .trim()
        .isLength({ max: 20 })
        .withMessage('Le téléphone ne peut pas dépasser 20 caractères'),
    body('email')
        .optional()
        .isEmail()
        .normalizeEmail()
        .withMessage('Adresse email invalide')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Données invalides',
            errors: errors.array()
        });
    }

    const { schoolId } = req.params;
    const { name, address, phone, email } = req.body;

    // Vérifier que l'admin appartient à cette école ou est super admin
    if (req.admin.schoolId !== parseInt(schoolId) && req.admin.role !== 'super_admin') {
        return res.status(403).json({
            success: false,
            message: 'Accès non autorisé à cette école'
        });
    }

    db.run(`
        UPDATE schools 
        SET name = ?, address = ?, phone = ?, email = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [name, address, phone, email, schoolId], function(err) {
        if (err) {
            console.error('Erreur lors de la mise à jour de l\'école:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour'
            });
        }

        if (this.changes === 0) {
            return res.status(404).json({
                success: false,
                message: 'École non trouvée'
            });
        }

        res.json({
            success: true,
            message: 'École mise à jour avec succès'
        });
    });
});

// Route pour rechercher une école par code
router.get('/search', (req, res) => {
    const { code } = req.query;

    if (!code || code.length < 3) {
        return res.status(400).json({
            success: false,
            message: 'Code de recherche trop court'
        });
    }

    db.get(`
        SELECT id, school_code, name, city, region, school_type, level, description
        FROM schools 
        WHERE school_code = ? COLLATE NOCASE
    `, [code.toUpperCase()], (err, school) => {
        if (err) {
            console.error('Erreur lors de la recherche d\'école:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur interne du serveur'
            });
        }

        if (school) {
            res.json({
                success: true,
                school: school
            });
        } else {
            res.json({
                success: false,
                message: 'École non trouvée'
            });
        }
    });
});

// Route pour obtenir les statistiques publiques d'une école
router.get('/:schoolId/stats', (req, res) => {
    const { schoolId } = req.params;

    db.get(`
        SELECT 
            COUNT(*) as total_reports,
            COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_reports,
            COUNT(CASE WHEN created_at >= date('now', '-30 days') THEN 1 END) as reports_last_30_days,
            AVG(CASE 
                WHEN status = 'resolved' AND created_at >= date('now', '-90 days') 
                THEN julianday(updated_at) - julianday(created_at) 
            END) as avg_resolution_time_days
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

        // Statistiques par catégorie (publiques)
        db.all(`
            SELECT category, COUNT(*) as count
            FROM reports 
            WHERE school_id = ? AND created_at >= date('now', '-1 year')
            GROUP BY category
            ORDER BY count DESC
        `, [schoolId], (err, categoryStats) => {
            if (err) {
                console.error('Erreur lors de la récupération des stats par catégorie:', err);
                categoryStats = [];
            }

            res.json({
                success: true,
                stats: {
                    ...stats,
                    avg_resolution_time_days: Math.round((stats.avg_resolution_time_days || 0) * 10) / 10
                },
                categoryStats
            });
        });
    });
});

module.exports = router;
