const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'speakfree.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Création des tables pour le système anti-abus...\n');

db.serialize(() => {
    // Table des logs d'abus
    db.run(`
        CREATE TABLE IF NOT EXISTS abuse_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id TEXT,
            ip_address TEXT,
            trust_score INTEGER,
            severity TEXT CHECK(severity IN ('normal', 'warning', 'critical')),
            issues TEXT,
            metadata TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            reviewed BOOLEAN DEFAULT 0,
            reviewed_by INTEGER,
            reviewed_at TEXT,
            FOREIGN KEY (report_id) REFERENCES reports(id)
        )
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création table abuse_logs:', err);
        } else {
            console.log('✅ Table abuse_logs créée');
        }
    });

    // Index pour optimiser les requêtes
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_abuse_logs_report_id 
        ON abuse_logs(report_id)
    `, (err) => {
        if (err) {
            console.error('❌ Erreur index report_id:', err);
        } else {
            console.log('✅ Index abuse_logs_report_id créé');
        }
    });

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_abuse_logs_severity 
        ON abuse_logs(severity)
    `, (err) => {
        if (err) {
            console.error('❌ Erreur index severity:', err);
        } else {
            console.log('✅ Index abuse_logs_severity créé');
        }
    });

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_abuse_logs_created 
        ON abuse_logs(created_at)
    `, (err) => {
        if (err) {
            console.error('❌ Erreur index created_at:', err);
        } else {
            console.log('✅ Index abuse_logs_created créé');
        }
    });

    // Ajouter colonne ip_address à la table reports si elle n'existe pas
    db.all(`PRAGMA table_info(reports)`, (err, columns) => {
        if (err) {
            console.error('❌ Erreur vérification table reports:', err);
            return;
        }

        const hasIpAddress = columns.some(col => col.name === 'ip_address');
        const hasTrustScore = columns.some(col => col.name === 'trust_score');
        const hasAbuseFlags = columns.some(col => col.name === 'abuse_flags');

        if (!hasIpAddress) {
            db.run(`ALTER TABLE reports ADD COLUMN ip_address TEXT`, (err) => {
                if (err) {
                    console.error('❌ Erreur ajout colonne ip_address:', err);
                } else {
                    console.log('✅ Colonne ip_address ajoutée à reports');
                }
            });
        } else {
            console.log('⏭️  Colonne ip_address existe déjà');
        }

        if (!hasTrustScore) {
            db.run(`ALTER TABLE reports ADD COLUMN trust_score INTEGER DEFAULT 75`, (err) => {
                if (err) {
                    console.error('❌ Erreur ajout colonne trust_score:', err);
                } else {
                    console.log('✅ Colonne trust_score ajoutée à reports');
                }
            });
        } else {
            console.log('⏭️  Colonne trust_score existe déjà');
        }

        if (!hasAbuseFlags) {
            db.run(`ALTER TABLE reports ADD COLUMN abuse_flags TEXT`, (err) => {
                if (err) {
                    console.error('❌ Erreur ajout colonne abuse_flags:', err);
                } else {
                    console.log('✅ Colonne abuse_flags ajoutée à reports');
                }
            });
        } else {
            console.log('⏭️  Colonne abuse_flags existe déjà');
        }

        setTimeout(() => {
            console.log('\n✅ Migration terminée!\n');
            db.close();
        }, 500);
    });
});
