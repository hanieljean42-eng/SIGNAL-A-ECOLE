const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'speakfree.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Création de la table identity_reveal_requests...\n');

db.serialize(() => {
    // Créer la table pour les demandes de révélation d'identité
    db.run(`
        CREATE TABLE IF NOT EXISTS identity_reveal_requests (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL,
            admin_id INTEGER NOT NULL,
            school_id INTEGER NOT NULL,
            justification TEXT NOT NULL,
            admin_name TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now')),
            reviewed_at TEXT,
            reviewed_by INTEGER,
            FOREIGN KEY (report_id) REFERENCES reports(id),
            FOREIGN KEY (admin_id) REFERENCES administrators(id),
            FOREIGN KEY (school_id) REFERENCES schools(id)
        )
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création table identity_reveal_requests:', err);
        } else {
            console.log('✅ Table identity_reveal_requests créée avec succès');
        }
    });

    // Créer des index pour optimiser les requêtes
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_identity_reveal_report 
        ON identity_reveal_requests(report_id)
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création index report_id:', err);
        } else {
            console.log('✅ Index idx_identity_reveal_report créé');
        }
    });

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_identity_reveal_admin 
        ON identity_reveal_requests(admin_id)
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création index admin_id:', err);
        } else {
            console.log('✅ Index idx_identity_reveal_admin créé');
        }
    });

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_identity_reveal_school 
        ON identity_reveal_requests(school_id)
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création index school_id:', err);
        } else {
            console.log('✅ Index idx_identity_reveal_school créé');
        }
    });

    // Créer la table des activités d'admin si elle n'existe pas
    db.run(`
        CREATE TABLE IF NOT EXISTS admin_activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            resource_type TEXT,
            resource_id TEXT,
            description TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (admin_id) REFERENCES administrators(id)
        )
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création table admin_activity_logs:', err);
        } else {
            console.log('✅ Table admin_activity_logs créée avec succès');
        }
    });

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_admin_activity_admin 
        ON admin_activity_logs(admin_id)
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création index admin_id:', err);
        } else {
            console.log('✅ Index idx_admin_activity_admin créé');
        }
    });

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_admin_activity_type 
        ON admin_activity_logs(action_type)
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création index action_type:', err);
        } else {
            console.log('✅ Index idx_admin_activity_type créé');
        }
    });

    setTimeout(() => {
        console.log('\n✅ Migration terminée!\n');
        db.close();
    }, 500);
});
