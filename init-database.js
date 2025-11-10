const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'speakfree.db');

console.log('🚀 INITIALISATION DE LA BASE DE DONNÉES SPEAKFREE\n');
console.log('═══════════════════════════════════════════════════\n');

// Créer le dossier database s'il n'existe pas
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('✅ Dossier database créé\n');
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Erreur lors de l\'ouverture de la base de données:', err);
        process.exit(1);
    }
    console.log('✅ Connexion à la base de données établie\n');
});

// Activer les clés étrangères
db.run('PRAGMA foreign_keys = ON');

// Créer toutes les tables
db.serialize(async () => {
    console.log('📊 Création des tables...\n');

    // Table des écoles
    db.run(`
        CREATE TABLE IF NOT EXISTS schools (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            school_code TEXT UNIQUE NOT NULL,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            region TEXT,
            phone TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            school_type TEXT,
            level TEXT,
            website TEXT,
            description TEXT,
            is_verified BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table schools:', err);
        else console.log('✅ Table schools créée');
    });

    // Table des demandes d'inscription d'écoles
    db.run(`
        CREATE TABLE IF NOT EXISTS school_registrations (
            id TEXT PRIMARY KEY,
            school_name TEXT NOT NULL,
            school_address TEXT NOT NULL,
            school_city TEXT NOT NULL,
            school_region TEXT,
            school_phone TEXT NOT NULL,
            school_email TEXT NOT NULL,
            school_type TEXT,
            school_level TEXT,
            school_website TEXT,
            school_description TEXT,
            admin_full_name TEXT NOT NULL,
            admin_email TEXT NOT NULL,
            admin_phone TEXT NOT NULL,
            admin_position TEXT,
            admin_password_hash TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            reviewed_by INTEGER,
            reviewed_at DATETIME,
            rejection_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table school_registrations:', err);
        else console.log('✅ Table school_registrations créée');
    });

    // Table des administrateurs
    db.run(`
        CREATE TABLE IF NOT EXISTS administrators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            is_active BOOLEAN DEFAULT 1,
            last_login DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table administrators:', err);
        else console.log('✅ Table administrators créée');
    });

    // Table des demandes d'inscription admin
    db.run(`
        CREATE TABLE IF NOT EXISTS admin_requests (
            id TEXT PRIMARY KEY,
            school_id INTEGER NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            position TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            justification TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            reviewed_by INTEGER,
            reviewed_at DATETIME,
            rejection_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table admin_requests:', err);
        else console.log('✅ Table admin_requests créée');
    });

    // Table des utilisateurs
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            role TEXT DEFAULT 'student',
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table users:', err);
        else console.log('✅ Table users créée');
    });

    // Table des signalements
    db.run(`
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tracking_code TEXT UNIQUE NOT NULL,
            school_id INTEGER NOT NULL,
            user_id INTEGER,
            type TEXT NOT NULL,
            description TEXT NOT NULL,
            location TEXT,
            date_incident TEXT,
            witnesses TEXT,
            evidence_files TEXT,
            urgency_level TEXT DEFAULT 'normal',
            status TEXT DEFAULT 'pending',
            admin_notes TEXT,
            assigned_to INTEGER,
            resolved_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (assigned_to) REFERENCES administrators(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table reports:', err);
        else console.log('✅ Table reports créée');
    });

    // Table des discussions
    db.run(`
        CREATE TABLE IF NOT EXISTS discussions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT NOT NULL,
            created_by INTEGER,
            is_anonymous INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            is_locked INTEGER DEFAULT 0,
            views_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table discussions:', err);
        else console.log('✅ Table discussions créée');
    });

    // Table des messages de discussion
    db.run(`
        CREATE TABLE IF NOT EXISTS discussion_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discussion_id INTEGER NOT NULL,
            user_id INTEGER,
            message TEXT NOT NULL,
            is_anonymous INTEGER DEFAULT 0,
            attachment_path TEXT,
            is_deleted INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (discussion_id) REFERENCES discussions(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table discussion_messages:', err);
        else console.log('✅ Table discussion_messages créée');
    });

    // Table des conversations IA
    db.run(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL,
            user_id INTEGER,
            session_id TEXT UNIQUE NOT NULL,
            is_anonymous INTEGER DEFAULT 1,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table ai_conversations:', err);
        else console.log('✅ Table ai_conversations créée');
    });

    // Table des messages IA
    db.run(`
        CREATE TABLE IF NOT EXISTS ai_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table ai_messages:', err);
        else console.log('✅ Table ai_messages créée');
    });

    // Table des demandes de révélation d'identité
    db.run(`
        CREATE TABLE IF NOT EXISTS identity_reveal_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER,
            discussion_id INTEGER,
            ai_conversation_id INTEGER,
            requested_by INTEGER NOT NULL,
            justification TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (report_id) REFERENCES reports(id),
            FOREIGN KEY (discussion_id) REFERENCES discussions(id),
            FOREIGN KEY (ai_conversation_id) REFERENCES ai_conversations(id),
            FOREIGN KEY (requested_by) REFERENCES administrators(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table identity_reveal_requests:', err);
        else console.log('✅ Table identity_reveal_requests créée');
    });

    // Table des réponses aux demandes d'identité
    db.run(`
        CREATE TABLE IF NOT EXISTS identity_reveal_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            response TEXT NOT NULL,
            additional_info TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (request_id) REFERENCES identity_reveal_requests(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table identity_reveal_responses:', err);
        else console.log('✅ Table identity_reveal_responses créée');
    });

    // Table des logs de détection d'abus
    db.run(`
        CREATE TABLE IF NOT EXISTS abuse_detection_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            ip_address TEXT,
            action_type TEXT NOT NULL,
            details TEXT,
            severity TEXT DEFAULT 'low',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table abuse_detection_logs:', err);
        else console.log('✅ Table abuse_detection_logs créée');
    });

    // Table des logs d'activité
    db.run(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT,
            target_id INTEGER,
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_id) REFERENCES administrators(id)
        )
    `, (err) => {
        if (err) console.error('❌ Erreur création table activity_logs:', err);
        else console.log('✅ Table activity_logs créée');
    });

    // Attendre que toutes les tables soient créées
    setTimeout(async () => {
        console.log('\n📝 Création des données initiales...\n');

        // Créer une école de test (SpeakFree HQ)
        const schoolCode = 'SPEAKFREE-HQ-2025';
        
        db.run(`
            INSERT OR IGNORE INTO schools (
                name, school_code, address, city, region, phone, email, 
                school_type, level, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'SpeakFree Headquarters',
            schoolCode,
            '123 Avenue de la Paix',
            'Abidjan',
            'Lagunes',
            '+225 0700000000',
            'admin@speakfree.ci',
            'Administration',
            'Tous niveaux',
            'École de démonstration et administration centrale de SpeakFree'
        ], async function(err) {
            if (err) {
                console.error('❌ Erreur création école:', err);
                db.close();
                return;
            }

            const schoolId = this.lastID || 1;
            console.log(`✅ École créée avec ID: ${schoolId} et code: ${schoolCode}`);

            // Créer un super-administrateur par défaut
            const defaultPassword = 'admin2025';
            const passwordHash = await bcrypt.hash(defaultPassword, 12);

            db.run(`
                INSERT OR IGNORE INTO administrators (
                    school_id, username, password_hash, full_name, email, 
                    role, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                schoolId,
                'superadmin',
                passwordHash,
                'Super Administrateur',
                'superadmin@speakfree.ci',
                'super_admin',
                1
            ], function(err) {
                if (err) {
                    console.error('❌ Erreur création super-admin:', err);
                } else {
                    console.log('✅ Super-administrateur créé');
                    console.log('\n🎉 INITIALISATION TERMINÉE AVEC SUCCÈS !\n');
                    console.log('═══════════════════════════════════════════════════\n');
                    console.log('📋 INFORMATIONS DE CONNEXION PAR DÉFAUT:\n');
                    console.log('   🏫 École: SpeakFree Headquarters');
                    console.log(`   🔑 Code école: ${schoolCode}`);
                    console.log('   👤 Username: superadmin');
                    console.log('   🔒 Password: admin2025');
                    console.log('\n⚠️  IMPORTANT: Changez le mot de passe après la première connexion!\n');
                    console.log('🌐 Accédez à l\'application sur: http://localhost:3000/login\n');
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
    }, 1000);
});
