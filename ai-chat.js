const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const db = new sqlite3.Database(process.env.DATABASE_PATH);

// Configuration multer pour les photos de visage
const faceStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '..', 'uploads', 'faces');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'face-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadFace = multer({
    storage: faceStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = file.mimetype.startsWith('image/');
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Seulement des images JPG, PNG sont acceptées'));
        }
    }
});

// Stocker les sessions de conversation en mémoire
const conversationSessions = new Map();

// Route GET pour démarrer une session (compatible avec les tests)
router.get('/start', (req, res) => {
    res.json({
        success: true,
        message: 'API Haniel active. Utilisez POST /init pour démarrer une conversation.',
        endpoints: {
            init: 'POST /api/ai-chat/init',
            message: 'POST /api/ai-chat/message',
            admin: 'GET /api/ai-chat/admin/conversations'
        }
    });
});

// Initialiser une nouvelle conversation
router.post('/init', (req, res) => {
    const sessionId = `CHAT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const accessCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    const welcomeMessage = `Bonjour ! 👋 Je suis Haniel, ton assistant IA personnel.

Je suis là pour t'aider à signaler un problème dans ton école de manière sécurisée et confidentielle.

Je vais te poser quelques questions pour bien comprendre ta situation. Ne t'inquiète pas, tout est confidentiel et je suis là pour t'aider ! 😊

Pour commencer, peux-tu me dire ce qui se passe ?`;

    const quickActions = [
        { label: '🎯 Harcèlement', message: 'Je suis victime de harcèlement' },
        { label: '⚠️ Violence physique', message: 'Il y a de la violence physique' },
        { label: '💊 Drogue', message: 'C\'est lié à la drogue' },
        { label: '🔪 Arme', message: 'J\'ai vu une arme' },
        { label: '💬 Cyberharcelement', message: 'Je suis victime de cyberharcelement' },
        { label: '🚨 Situation urgente', message: 'C\'est une situation urgente' },
        { label: '💰 Vol/Racket', message: 'Il y a eu un vol ou du racket' },
        { label: '📱 Autre problème', message: 'Je veux signaler autre chose' }
    ];

    // Initialiser le contexte de la conversation
    const context = {
        step: 'initial',
        schoolCode: null,
        category: null,
        urgency: null,
        description: null,
        location: null,
        userType: 'eleve',
        witnesses: null,
        contactInfo: null
    };

    conversationSessions.set(sessionId, {
        context: context,
        messages: [],
        startTime: new Date()
    });

    // Enregistrer dans la base de données
    db.run(`
        INSERT INTO ai_conversations 
        (session_id, access_code, status, created_at)
        VALUES (?, ?, 'active', datetime('now'))
    `, [sessionId, accessCode]);

    res.json({
        success: true,
        sessionId: sessionId,
        accessCode: accessCode,
        welcomeMessage: welcomeMessage,
        quickActions: quickActions,
        context: context
    });
});

// Traiter un message de l'utilisateur
router.post('/message', async (req, res) => {
    const { sessionId, message, context } = req.body;

    if (!sessionId || !conversationSessions.has(sessionId)) {
        return res.status(400).json({
            success: false,
            message: 'Session invalide'
        });
    }

    const session = conversationSessions.get(sessionId);
    
    // Enregistrer le message utilisateur
    session.messages.push({
        role: 'user',
        content: message,
        timestamp: new Date()
    });

    // Analyser le message et générer une réponse
    const aiResponse = await generateAIResponse(message, session.context);
    
    // Enregistrer la réponse IA
    session.messages.push({
        role: 'ai',
        content: aiResponse.text,
        timestamp: new Date()
    });

    // Mettre à jour le contexte
    Object.assign(session.context, aiResponse.updatedContext);

    // Enregistrer dans la base de données
    db.run(`
        INSERT INTO ai_messages 
        (session_id, role, message, context_data, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
    `, [sessionId, 'user', message, JSON.stringify(session.context)]);

    db.run(`
        INSERT INTO ai_messages 
        (session_id, role, message, context_data, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
    `, [sessionId, 'ai', aiResponse.text, JSON.stringify(session.context)]);

    // Si toutes les informations sont collectées, créer le signalement
    let reportCreated = false;
    let reportCode = null;
    let accessCode = null;

    if (aiResponse.readyToCreateReport) {
        console.log('🔄 Création du signalement demandée');
        console.log('📋 Contexte:', JSON.stringify(session.context, null, 2));
        
        const result = await createReportFromContext(session.context);
        
        console.log('📊 Résultat création:', result);
        
        if (result.success) {
            reportCreated = true;
            reportCode = result.reportCode;
            accessCode = result.accessCode;
            
            console.log('✅ Signalement créé:', reportCode, 'Accès:', accessCode);
            
            // Marquer la session comme complétée
            db.run(`
                UPDATE ai_conversations 
                SET status = 'completed', report_code = ?, completed_at = datetime('now')
                WHERE session_id = ?
            `, [reportCode, sessionId], (err) => {
                if (err) {
                    console.error('❌ Erreur update conversation:', err);
                } else {
                    console.log('✅ Session marquée comme complétée');
                }
            });
        } else {
            console.error('❌ Échec création signalement:', result.error);
        }
    }

    res.json({
        success: true,
        aiResponse: aiResponse.text,
        context: session.context,
        quickActions: aiResponse.quickActions || [],
        reportCreated: reportCreated,
        reportCode: reportCode,
        accessCode: accessCode
    });
});

// Route pour uploader la photo de visage
router.post('/upload-face', uploadFace.single('facePhoto'), (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId || !conversationSessions.has(sessionId)) {
        return res.status(400).json({
            success: false,
            message: 'Session invalide'
        });
    }

    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: 'Photo de visage requise'
        });
    }

    const session = conversationSessions.get(sessionId);
    const facePhotoPath = `/uploads/faces/${req.file.filename}`;
    
    // Sauvegarder le chemin de la photo dans le contexte
    session.context.facePhoto = facePhotoPath;
    session.context.waitingForPhoto = false;
    
    console.log('📸 Photo de visage uploadée:', facePhotoPath);

    res.json({
        success: true,
        message: 'Photo enregistrée avec succès',
        facePhotoPath: facePhotoPath
    });
});

// Générer une réponse IA basée sur le contexte
async function generateAIResponse(userMessage, context) {
    const message = userMessage.toLowerCase();
    let response = {
        text: '',
        updatedContext: {},
        quickActions: [],
        readyToCreateReport: false
    };

    // ÉTAPE 1 : Déterminer le type de problème
    if (!context.category) {
        if (message.includes('harcèlement') || message.includes('harcele') || message.includes('insulte') || message.includes('moque')) {
            response.updatedContext.category = 'harcelement';
            response.text = `Je comprends que tu es victime de harcèlement. C'est très courageux de ta part d'en parler. 💪

Peux-tu me dire où cela se passe ? (classe, cour de récréation, couloirs, etc.)`;
        } else if (message.includes('violence') || message.includes('frappe') || message.includes('bagarre') || message.includes('coup')) {
            response.updatedContext.category = 'violence';
            response.text = `Je comprends qu'il y a une situation de violence. C'est très sérieux et nous allons t'aider.

Peux-tu me dire où cela se passe ?`;
        } else if (message.includes('drogue') || message.includes('stupéfiant')) {
            response.updatedContext.category = 'drogue';
            response.text = `Merci de signaler cette situation de drogue. C'est important.

Peux-tu me dire où cela se passe dans l'école ?`;
        } else if (message.includes('vol') || message.includes('volé') || message.includes('voler') || message.includes('racket')) {
            response.updatedContext.category = 'vol';
            response.text = `Je comprends qu'il y a eu un vol ou du racket. Nous allons t'aider.

Où est-ce que cela s'est passé ?`;
        } else if (message.includes('arme') || message.includes('couteau') || message.includes('pistolet')) {
            response.updatedContext.category = 'arme';
            response.updatedContext.urgency = 'critique';
            response.text = `🚨 C'est une situation EXTRÊMEMENT URGENTE. Merci de me le signaler.

Où as-tu vu cette arme ? Peux-tu me donner des détails précis ?

⚠️ Si tu es en danger immédiat, contacte aussi les autorités (police 17).`;
        } else if (message.includes('cyber') || message.includes('internet') || message.includes('réseau') || message.includes('photo') || message.includes('vidéo')) {
            response.updatedContext.category = 'cyberharcelement';
            response.text = `Je comprends que tu es victime de cyberharcelement. C'est un problème très sérieux.

Où cela se passe-t-il principalement ? (réseaux sociaux, messages, groupes de classe, etc.)`;
        } else if (message.includes('discrimination') || message.includes('racisme') || message.includes('sexisme') || message.includes('homophobie')) {
            response.updatedContext.category = 'discrimination';
            response.text = `Je comprends que tu es victime de discrimination. C'est inacceptable.

Peux-tu me dire où cela se passe ?`;
        } else if (message.includes('professeur') || message.includes('enseignant') || message.includes('adulte')) {
            response.updatedContext.category = 'adulte';
            response.updatedContext.urgency = 'eleve';
            response.text = `Je comprends que cela implique un adulte de l'établissement. C'est très sérieux.

Peux-tu me dire où cela se passe ?`;
        } else if (message.includes('sexuel') || message.includes('attouchement') || message.includes('agression')) {
            response.updatedContext.category = 'agression_sexuelle';
            response.updatedContext.urgency = 'critique';
            response.text = `🚨 C'est une situation TRÈS GRAVE. Tu es très courageux(se) de me le dire.

Où cela s'est-il passé ?

⚠️ Important : Tu peux aussi appeler le 119 (Allô Enfance en Danger) pour parler à quelqu'un immédiatement.`;
        } else {
            response.text = `Je vois. Peux-tu me donner plus de détails sur ce qui se passe ? Cela m'aidera à mieux comprendre la situation.

Par exemple :
- Est-ce du harcèlement ?
- De la violence ?
- Un vol ?
- Autre chose ?`;
            response.quickActions = [
                { label: '🎯 Harcèlement', message: 'C\'est du harcèlement' },
                { label: '⚠️ Violence', message: 'C\'est de la violence' },
                { label: '💊 Drogue', message: 'C\'est lié à la drogue' },
                { label: '🔪 Arme', message: 'J\'ai vu une arme' }
            ];
        }
        return response;
    }

    // ÉTAPE 2 : Obtenir le lieu
    if (!context.location) {
        response.updatedContext.location = extractLocation(userMessage);
        response.text = `D'accord, noté pour le lieu : ${response.updatedContext.location}

Maintenant, peux-tu me décrire ce qui s'est passé ? Donne-moi autant de détails que possible pour que l'administration puisse bien comprendre.`;
        return response;
    }

    // ÉTAPE 3 : Obtenir la description
    if (!context.description) {
        response.updatedContext.description = userMessage;
        
        // Déterminer l'urgence basée sur des mots-clés
        if (!context.urgency) {
            if (message.includes('maintenant') || message.includes('en ce moment') || message.includes('urgent') || message.includes('danger')) {
                response.updatedContext.urgency = 'critique';
            } else if (message.includes('souvent') || message.includes('tous les jours') || message.includes('régulier') || message.includes('chaque jour')) {
                response.updatedContext.urgency = 'eleve';
            } else if (message.includes('parfois') || message.includes('quelquefois')) {
                response.updatedContext.urgency = 'moyen';
            } else {
                response.updatedContext.urgency = 'moyen';
            }
        }

        // Réponse empathique basée sur le type
        let empathyMessage = 'Merci pour ces informations détaillées. Je comprends mieux la situation.';
        
        if (context.category === 'harcelement' || context.category === 'cyberharcelement') {
            empathyMessage = 'Merci d\'avoir partagé ça avec moi. Le harcèlement n\'est jamais acceptable et tu as raison de le signaler. 💪';
        } else if (context.category === 'violence') {
            empathyMessage = 'C\'est très courageux de ta part de parler de cette violence. Personne ne devrait vivre ça.';
        } else if (context.category === 'agression_sexuelle') {
            empathyMessage = 'Merci de ta confiance. Ce que tu vis n\'est PAS de ta faute. Tu as bien fait de me le dire.';
        }

        response.text = `${empathyMessage}

Y a-t-il des témoins ? D'autres personnes ont-elles vu ce qui s'est passé ?`;
        response.quickActions = [
            { label: '✅ Oui, il y a des témoins', message: 'Oui, il y a des témoins' },
            { label: '❌ Non, pas de témoins', message: 'Non, personne n\'a vu' },
            { label: '🤷 Je ne sais pas', message: 'Je ne sais pas s\'il y a des témoins' }
        ];
        return response;
    }

    // ÉTAPE 4 : Témoins
    if (!context.witnesses) {
        if (message.includes('oui') || message.includes('témoins')) {
            response.updatedContext.witnesses = 'oui';
        } else if (message.includes('non')) {
            response.updatedContext.witnesses = 'non';
        } else {
            response.updatedContext.witnesses = 'incertain';
        }

        response.text = `Parfait. Maintenant, j'ai besoin de connaître le code de ton école pour créer le signalement.

Peux-tu me donner le code de ton école ? (Si tu ne le connais pas, demande à un adulte ou cherche sur le site de ton école)`;
        return response;
    }

    // ÉTAPE 5 : Code école
    if (!context.schoolCode) {
        // Vérifier si l'utilisateur ne connaît pas le code
        if (message.includes('ne connais pas') || message.includes('ne sais pas') || message.includes('s\'appelle')) {
            // Essayer de rechercher par nom
            const schoolNameMatch = userMessage.match(/s'appelle\s+(.+)/i);
            if (schoolNameMatch) {
                const schoolName = schoolNameMatch[1].trim();
                const schools = await findSchoolByName(schoolName);
                
                if (schools.length > 0) {
                    response.text = `🎯 J'ai trouvé ${schools.length} école(s) qui correspond(ent) :\n\n`;
                    response.quickActions = [];
                    
                    schools.forEach((school, index) => {
                        response.text += `${index + 1}. **${school.name}** (Code: ${school.school_code})\n`;
                        response.quickActions.push({
                            label: `✅ ${school.name}`,
                            message: school.school_code
                        });
                    });
                    
                    response.text += `\n📋 Clique sur ton école pour continuer !`;
                    return response;
                } else {
                    response.text = `❌ Je n'ai pas trouvé d'école avec ce nom.

Essaye de donner plus de détails ou le nom complet de ton école.

Exemple : "Mon école s'appelle Lycée Victor Hugo"`;
                    return response;
                }
            } else {
                response.text = `D'accord, pas de problème ! 

Pour t'aider à trouver ton école, peux-tu me donner son nom ?

📝 Écris : "Mon école s'appelle [nom complet de ton école]"

Exemple : "Mon école s'appelle Collège Jules Ferry"`;
                return response;
            }
        }
        
        // Extraire le code de plusieurs façons
        let possibleCode = extractSchoolCode(userMessage);
        
        // Si pas trouvé avec le pattern, essayer de prendre les majuscules + chiffres
        if (!possibleCode) {
            const cleanMessage = userMessage.toUpperCase().replace(/\s/g, '');
            if (cleanMessage.match(/^[A-Z]{3}\d+$/)) {
                possibleCode = cleanMessage;
            } else if (cleanMessage.match(/[A-Z]{3}\d+/)) {
                possibleCode = cleanMessage.match(/[A-Z]{3}\d+/)[0];
            }
        }
        
        if (possibleCode) {
            // Vérifier si l'école existe
            const schoolExists = await checkSchoolExists(possibleCode);
            if (schoolExists) {
                response.updatedContext.schoolCode = possibleCode;
                
                // Demander si situation urgente nécessite contact
                if (context.urgency === 'critique' || context.urgency === 'eleve') {
                    response.text = `✅ École trouvée : ${possibleCode}

Étant donné que c'est une situation ${context.urgency === 'critique' ? 'URGENTE' : 'importante'}, veux-tu laisser tes coordonnées pour que l'école puisse te contacter rapidement ?

⚠️ C'est optionnel, mais cela peut permettre une intervention plus rapide.`;
                    response.quickActions = [
                        { label: '📞 Oui, je laisse mes coordonnées', message: 'Oui, je veux laisser mes coordonnées' },
                        { label: '🔒 Non, je reste anonyme', message: 'Non, je préfère rester anonyme' }
                    ];
                } else {
                    // Créer le signalement directement (photo optionnelle)
                    response.readyToCreateReport = true;
                    response.text = `✅ Parfait ! J'ai toutes les informations nécessaires.

Je vais maintenant créer ton signalement de manière sécurisée. Tu vas recevoir un code de suivi et un code d'accès pour suivre ton dossier.

⏳ Création en cours...`;
                }
            } else {
                response.text = `❌ Je ne trouve pas le code "${possibleCode}" dans notre système.

Voici comment retrouver ton code d'école :

1️⃣ **Demande à un adulte** (parent, professeur)
2️⃣ **Regarde sur le site web** de ton école
3️⃣ **Vérifie tes documents** scolaires (carnet, inscription)

Le format est : 3 lettres + chiffres (exemple: ECO3847)

💡 Tu peux aussi essayer sans le code en utilisant le nom de ton école. Tape : "Mon école s'appelle [nom]"`;
                response.quickActions = [
                    { label: '🏫 Essayer avec le nom', message: 'Je ne connais pas le code, mon école s\'appelle' },
                    { label: '🔄 Réessayer le code', message: 'Je veux réessayer avec un autre code' }
                ];
            }
        } else {
            response.text = `Je n'ai pas bien compris le code de ton école.

📋 **Format attendu** : ECO3847 (3 lettres + chiffres)

**Exemples corrects** :
✅ ECO3847
✅ LYC1234
✅ COL9876

Peux-tu me donner le code de ton école ?

💡 Si tu ne le connais pas, tape : "Je ne connais pas le code"`;
            response.quickActions = [
                { label: '❓ Je ne connais pas le code', message: 'Je ne connais pas le code de mon école' }
            ];
        }
        return response;
    }

    // ÉTAPE 6 : Contact (optionnel pour cas graves)
    if ((context.urgency === 'critique' || context.urgency === 'eleve') && !context.contactDecision) {
        if (message.includes('oui') || message.includes('coordonnées') || message.includes('contact')) {
            response.updatedContext.contactDecision = 'yes';
            response.text = `D'accord. Pour que l'école puisse te contacter :

Peux-tu me donner ton prénom et un numéro de téléphone ou email ?

Format : Prénom - Téléphone/Email`;
        } else {
            response.updatedContext.contactDecision = 'no';
            
            // Créer le signalement directement (photo optionnelle)
            response.readyToCreateReport = true;
            response.text = `Pas de problème, ton signalement restera totalement anonyme. 🔒

Je crée maintenant ton signalement...

⏳ Création en cours...`;
        }
        return response;
    }

    // ÉTAPE 7 : Informations de contact
    if (context.contactDecision === 'yes' && !context.contactInfo) {
        const contactInfo = extractContactInfo(userMessage);
        response.updatedContext.contactInfo = contactInfo;
        
        // Créer le signalement directement (photo optionnelle)
        response.readyToCreateReport = true;
        response.text = `✅ Informations de contact enregistrées.

Je crée maintenant ton signalement avec tes coordonnées pour une intervention rapide.

⏳ Création en cours...`;
        return response;
    }

    // Gestion des commandes spéciales
    
    // Si l'utilisateur demande explicitement de créer le signalement
    if ((message.includes('crée') || message.includes('créer') || message.includes('finaliser')) && 
        message.includes('signalement') && 
        context.schoolCode && 
        context.category && 
        context.description) {
        response.readyToCreateReport = true;
        response.text = `✅ Parfait ! Je crée ton signalement maintenant.

⏳ Création en cours...`;
        return response;
    }
    
    if (message.includes('résumé') || message.includes('recap')) {
        const summary = generateSummary(context);
        response.text = summary;
        response.quickActions = [
            { label: '✅ Créer le signalement', message: 'Oui, crée le signalement maintenant' },
            { label: '✏️ Modifier quelque chose', message: 'Je veux modifier quelque chose' }
        ];
        return response;
    }

    if (message.includes('modifier') || message.includes('changer')) {
        response.text = `Que veux-tu modifier ?`;
        response.quickActions = [
            { label: '📍 Le lieu', message: 'Je veux changer le lieu' },
            { label: '📝 La description', message: 'Je veux modifier la description' },
            { label: '👥 Les témoins', message: 'Je veux modifier les témoins' },
            { label: '🔙 Annuler', message: 'Finalement non, continue' }
        ];
        return response;
    }

    if (message.includes('aide') || message.includes('conseil')) {
        response.text = getAdviceBasedOnCategory(context.category);
        response.quickActions = [
            { label: '✅ Créer le signalement', message: 'Merci, je veux créer le signalement' },
            { label: '💬 Parler plus', message: 'Je veux en parler plus' }
        ];
        return response;
    }

    // Réponse par défaut
    response.text = `Je comprends. Y a-t-il autre chose que tu veux ajouter à ton signalement ?

💡 **Tu peux aussi** :
- Taper "résumé" pour voir tout ce que j'ai noté
- Taper "aide" pour des conseils
- Taper "modifier" pour changer une information`;
    
    response.quickActions = [
        { label: '✅ Créer le signalement', message: 'Non, c\'est bon, crée le signalement' },
        { label: '📝 Ajouter des détails', message: 'Oui, je veux ajouter des détails' },
        { label: '📋 Voir le résumé', message: 'Montre-moi le résumé' }
    ];

    return response;
}

// Générer un résumé de la conversation
function generateSummary(context) {
    let summary = `📋 **RÉSUMÉ DE TON SIGNALEMENT**\n\n`;
    
    if (context.category) {
        const categoryNames = {
            'harcelement': '🎯 Harcèlement',
            'violence': '⚠️ Violence',
            'drogue': '💊 Drogue',
            'vol': '💰 Vol/Racket',
            'arme': '🔪 Arme',
            'cyberharcelement': '💬 Cyberharcelement',
            'discrimination': '⚖️ Discrimination',
            'adulte': '👨‍🏫 Implication adulte',
            'agression_sexuelle': '🚨 Agression sexuelle'
        };
        summary += `**Type** : ${categoryNames[context.category] || context.category}\n`;
    }
    
    if (context.urgency) {
        const urgencyNames = {
            'critique': '🚨 CRITIQUE',
            'eleve': '⚡ ÉLEVÉE',
            'moyen': '📊 Moyen',
            'faible': '📊 Faible'
        };
        summary += `**Urgence** : ${urgencyNames[context.urgency]}\n`;
    }
    
    if (context.location) {
        summary += `**Lieu** : ${context.location}\n`;
    }
    
    if (context.description) {
        summary += `**Description** : ${context.description.substring(0, 100)}${context.description.length > 100 ? '...' : ''}\n`;
    }
    
    if (context.witnesses) {
        summary += `**Témoins** : ${context.witnesses}\n`;
    }
    
    if (context.schoolCode) {
        summary += `**École** : ${context.schoolCode}\n`;
    }
    
    summary += `\n✅ Tout est correct ?`;
    
    return summary;
}

// Donner des conseils basés sur la catégorie
function getAdviceBasedOnCategory(category) {
    const advice = {
        'harcelement': `💪 **CONSEILS CONTRE LE HARCÈLEMENT** :

1. **Tu n'es pas seul(e)** - Ce n'est PAS de ta faute
2. **Parles-en** - À un adulte de confiance (parent, CPE, prof)
3. **Note tout** - Dates, lieux, témoins
4. **Ne réponds pas** aux provocations
5. **Bloque** si c'est en ligne

📞 **Numéros utiles** :
- 3020 : Non au harcèlement
- 3018 : Cyberharcèlement`,

        'violence': `⚠️ **EN CAS DE VIOLENCE** :

1. **Éloigne-toi** du danger si possible
2. **Préviens un adulte** immédiatement
3. **Appelle le 17** si danger immédiat
4. **Ne reste pas seul(e)**
5. **Documente** (photos blessures si besoin)`,

        'cyberharcelement': `💬 **CONTRE LE CYBERHARCÈLEMENT** :

1. **Ne réponds pas** aux messages
2. **Bloque** l'harceleur
3. **Garde les preuves** (screenshots)
4. **Signale** sur la plateforme
5. **Parles-en** à un adulte

📱 3018 : Cyberharcèlement`,

        'agression_sexuelle': `🚨 **AGRESSION SEXUELLE** :

⚠️ **C'est TRÈS grave et ce n'est PAS de ta faute !**

1. **Tu es en sécurité maintenant ?**
2. **Appelle le 119** - Allô Enfance en Danger (gratuit, 24h/24)
3. **Parles-en** à un adulte de confiance
4. **Ne te lave pas** si récent (preuves médicales)
5. **Porter plainte** est ton droit

Tu es très courageux(se) d'en parler.`,

        'arme': `🔪 **ARME DÉTECTÉE** :

🚨 **DANGER IMMÉDIAT** :

1. **Éloigne-toi** immédiatement
2. **Appelle le 17** (Police) maintenant
3. **Préviens un adulte** rapidement
4. **Ne t'approche PAS** de l'arme
5. **Mets-toi en sécurité**

⚠️ La police doit intervenir tout de suite !`
    };

    return advice[category] || `💡 Tu fais bien de signaler. L'école va t'aider.

N'hésite pas à demander de l'aide à un adulte de confiance.`;
}

// Extraire le lieu du message
function extractLocation(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('classe') || lowerMessage.includes('salle')) return 'Salle de classe';
    if (lowerMessage.includes('cour') || lowerMessage.includes('récréation')) return 'Cour de récréation';
    if (lowerMessage.includes('couloir')) return 'Couloirs';
    if (lowerMessage.includes('toilette')) return 'Toilettes';
    if (lowerMessage.includes('cantine')) return 'Cantine';
    if (lowerMessage.includes('entrée') || lowerMessage.includes('sortie')) return 'Entrée/Sortie';
    if (lowerMessage.includes('vestiaire')) return 'Vestiaires';
    if (lowerMessage.includes('bus')) return 'Transport scolaire';
    
    return message.substring(0, 50); // Retourner le message si lieu spécifique
}

// Extraire le code école
function extractSchoolCode(message) {
    const match = message.match(/ECO\d+/i);
    if (match) {
        return match[0].toUpperCase();
    }
    return null;
}

// Extraire les informations de contact
function extractContactInfo(message) {
    const parts = message.split('-');
    if (parts.length >= 2) {
        return {
            name: parts[0].trim(),
            phone: parts[1].trim()
        };
    }
    return { raw: message };
}

// Vérifier si l'école existe
function checkSchoolExists(schoolCode) {
    return new Promise((resolve) => {
        db.get('SELECT id FROM schools WHERE school_code = ?', [schoolCode], (err, school) => {
            resolve(!!school);
        });
    });
}

// Rechercher une école par nom
function findSchoolByName(schoolName) {
    return new Promise((resolve) => {
        db.all(`
            SELECT school_code, name 
            FROM schools 
            WHERE name LIKE ? OR name LIKE ?
            LIMIT 5
        `, [`%${schoolName}%`, `${schoolName}%`], (err, schools) => {
            if (err) {
                resolve([]);
            } else {
                resolve(schools || []);
            }
        });
    });
}

// Fonction pour mapper les catégories de Haniel vers les catégories valides de la base de données
function mapCategoryToValid(category) {
    const categoryMap = {
        'cyberharcelement': 'harcelement',
        'vol': 'fraude',
        'arme': 'violence',
        'adulte': 'abus',
        'agression_sexuelle': 'abus'
    };
    
    // Si la catégorie est dans le mapping, retourner la catégorie mappée
    if (categoryMap[category]) {
        return categoryMap[category];
    }
    
    // Sinon, vérifier si c'est déjà une catégorie valide
    const validCategories = ['harcelement', 'violence', 'fraude', 'discrimination', 'abus', 'drogue', 'administration', 'infrastructure', 'autre'];
    if (validCategories.includes(category)) {
        return category;
    }
    
    // Par défaut, retourner 'autre'
    return 'autre';
}

// Créer un signalement à partir du contexte
function createReportFromContext(context) {
    return new Promise((resolve) => {
        console.log('🔵 Début création signalement');
        console.log('🔵 School code:', context.schoolCode);
        
        const reportCode = `SF-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        const accessCode = Math.floor(100000 + Math.random() * 900000).toString();

        console.log('🔵 Codes générés:', reportCode, accessCode);

        if (!context.schoolCode) {
            console.error('❌ Pas de code école dans le contexte !');
            return resolve({ 
                success: false, 
                error: 'Code école manquant dans le contexte' 
            });
        }

        db.get('SELECT id, name FROM schools WHERE school_code = ?', [context.schoolCode], (err, school) => {
            if (err) {
                console.error('❌ Erreur BD lors recherche école:', err);
                return resolve({ 
                    success: false, 
                    error: `Erreur base de données: ${err.message}` 
                });
            }
            
            if (!school) {
                console.error('❌ École non trouvée avec le code:', context.schoolCode);
                return resolve({ 
                    success: false, 
                    error: `École non trouvée pour le code ${context.schoolCode}` 
                });
            }

            console.log('✅ École trouvée:', school.name, '(ID:', school.id, ')');

            // Mapper la catégorie vers une catégorie valide
            const validCategory = mapCategoryToValid(context.category || 'autre');
            console.log('🔵 Catégorie mappée:', context.category, '->', validCategory);

            const title = `Signalement ${context.category || 'général'}`;
            const message = context.description || 'Signalement créé via l\'assistant IA Haniel';

            console.log('🔵 Insertion dans la table reports...');

            db.run(`
                INSERT INTO reports 
                (id, school_id, user_type, category, urgency, title, message, 
                 location, witnesses, is_anonymous, status, access_code, contact_info, 
                 face_photo, face_verified, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, datetime('now'))
            `, [
                reportCode,
                school.id,
                context.userType || 'eleve',
                validCategory,
                context.urgency || 'moyen',
                title,
                message,
                context.location || 'Non précisé',
                context.witnesses || 'incertain',
                context.contactInfo ? false : true,
                accessCode,
                context.contactInfo ? JSON.stringify(context.contactInfo) : null,
                context.facePhoto || null,
                context.facePhoto ? 1 : 0
            ], (err) => {
                if (err) {
                    console.error('❌ Erreur insertion signalement:', err);
                    return resolve({ 
                        success: false, 
                        error: `Erreur insertion: ${err.message}` 
                    });
                }

                console.log('✅✅✅ Signalement créé avec succès !');
                console.log('📋 Code de suivi:', reportCode);
                console.log('🔐 Code d\'accès:', accessCode);

                resolve({
                    success: true,
                    reportCode: reportCode,
                    accessCode: accessCode
                });
            });
        });
    });
}

// Route admin pour voir toutes les conversations IA
router.get('/admin/conversations', (req, res) => {
    const { authenticateToken } = require('./auth');
    
    // Pour cette démo, on accepte sans auth, mais en production il faudrait vérifier
    db.all(`
        SELECT 
            ac.session_id,
            ac.report_code,
            ac.status,
            ac.created_at,
            ac.completed_at,
            (SELECT COUNT(*) FROM ai_messages WHERE session_id = ac.session_id) as message_count,
            (SELECT message FROM ai_messages WHERE session_id = ac.session_id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_message
        FROM ai_conversations ac
        ORDER BY ac.created_at DESC
        LIMIT 50
    `, [], (err, conversations) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        res.json({
            success: true,
            conversations: conversations || []
        });
    });
});

// Route admin pour voir les détails d'une conversation
router.get('/admin/conversations/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    db.all(`
        SELECT * FROM ai_messages 
        WHERE session_id = ? 
        ORDER BY created_at ASC
    `, [sessionId], (err, messages) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        // Récupérer aussi les infos de la conversation
        db.get(`
            SELECT * FROM ai_conversations WHERE session_id = ?
        `, [sessionId], (err, conversation) => {
            res.json({
                success: true,
                messages: messages || [],
                conversation: conversation || null
            });
        });
    });
});

// Route admin pour répondre dans une conversation (continuer la discussion)
router.post('/admin/reply', (req, res) => {
    const { sessionId, message, adminName } = req.body;

    if (!sessionId || !message) {
        return res.status(400).json({
            success: false,
            message: 'Session ID et message requis'
        });
    }

    const adminMessage = `${adminName || 'Administrateur'}: ${message}`;

    // Enregistrer le message admin dans la conversation
    db.run(`
        INSERT INTO ai_messages 
        (session_id, role, message, created_at)
        VALUES (?, 'admin', ?, datetime('now'))
    `, [sessionId, adminMessage], function(err) {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'envoi'
            });
        }

        // Mettre à jour le statut de la conversation
        db.run(`
            UPDATE ai_conversations 
            SET status = 'active'
            WHERE session_id = ?
        `, [sessionId]);

        res.json({
            success: true,
            message: 'Message envoyé',
            messageId: this.lastID
        });
    });
});

// Route utilisateur pour récupérer les nouveaux messages (polling)
router.get('/user/messages/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const { since } = req.query; // Timestamp du dernier message reçu

    let query = `
        SELECT * FROM ai_messages 
        WHERE session_id = ?
    `;
    
    const params = [sessionId];

    if (since) {
        query += ` AND created_at > ?`;
        params.push(since);
    }

    query += ` ORDER BY created_at ASC`;

    db.all(query, params, (err, messages) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        res.json({
            success: true,
            messages: messages || []
        });
    });
});

// Route pour vérifier si l'admin a répondu
router.get('/user/check-admin-reply/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    db.get(`
        SELECT COUNT(*) as admin_messages 
        FROM ai_messages 
        WHERE session_id = ? AND role = 'admin'
    `, [sessionId], (err, result) => {
        if (err) {
            return res.status(500).json({ success: false });
        }

        res.json({
            success: true,
            hasAdminReply: result.admin_messages > 0
        });
    });
});

// Route pour vérifier un code d'accès et reprendre une conversation
router.post('/verify-access', (req, res) => {
    const { accessCode } = req.body;

    if (!accessCode) {
        return res.status(400).json({
            success: false,
            message: 'Code d\'accès requis'
        });
    }

    // Chercher la conversation avec ce code
    db.get(`
        SELECT session_id, status, report_code, created_at
        FROM ai_conversations
        WHERE access_code = ?
    `, [accessCode], (err, conversation) => {
        if (err) {
            console.error('Erreur BD:', err);
            return res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Code d\'accès invalide'
            });
        }

        // Récupérer les messages de la conversation
        db.all(`
            SELECT role, message, created_at
            FROM ai_messages
            WHERE session_id = ?
            ORDER BY created_at ASC
        `, [conversation.session_id], (err, messages) => {
            if (err) {
                console.error('Erreur messages:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur serveur'
                });
            }

            res.json({
                success: true,
                sessionId: conversation.session_id,
                status: conversation.status,
                reportCode: conversation.report_code,
                messages: messages || [],
                createdAt: conversation.created_at
            });
        });
    });
});

// Route pour récupérer le code d'accès d'une session (si perdu)
router.get('/get-access-code/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    db.get(`
        SELECT access_code
        FROM ai_conversations
        WHERE session_id = ?
    `, [sessionId], (err, result) => {
        if (err || !result) {
            return res.status(404).json({
                success: false,
                message: 'Session non trouvée'
            });
        }

        res.json({
            success: true,
            accessCode: result.access_code
        });
    });
});

// Route admin pour supprimer une conversation IA
router.delete('/admin/conversations/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    // Supprimer d'abord tous les messages
    db.run(`DELETE FROM ai_messages WHERE session_id = ?`, [sessionId], (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression des messages'
            });
        }

        // Puis supprimer la conversation
        db.run(`DELETE FROM ai_conversations WHERE session_id = ?`, [sessionId], (err) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la suppression de la conversation'
                });
            }

            res.json({
                success: true,
                message: 'Conversation supprimée avec succès'
            });
        });
    });
});

module.exports = router;
