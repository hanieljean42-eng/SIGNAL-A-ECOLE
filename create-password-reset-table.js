const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'speakfree.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Création de la table password_reset_tokens...\n');

db.serialize(() => {
    // Table pour les tokens de réinitialisation de mot de passe
    db.run(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            reset_code TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            used INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_id) REFERENCES administrators(id)
        )
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création table password_reset_tokens:', err);
        } else {
            console.log('✅ Table password_reset_tokens créée avec succès');
        }
        
        db.close((err) => {
            if (err) {
                console.error('❌ Erreur fermeture base de données:', err);
            } else {
                console.log('✅ Base de données fermée correctement\n');
            }
        });
    });
});
