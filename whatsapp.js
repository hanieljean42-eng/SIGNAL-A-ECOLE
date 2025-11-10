// Module WhatsApp pour générer des liens et envoyer des messages

/**
 * Génère un lien WhatsApp qui ouvre l'application avec un message pré-rempli
 * @param {string} phoneNumber - Numéro de téléphone (avec code pays, ex: +225...)
 * @param {string} message - Message à pré-remplir
 * @returns {string} - URL WhatsApp
 */
function generateWhatsAppLink(phoneNumber, message) {
    // Nettoyer le numéro de téléphone (enlever espaces, tirets, etc.)
    const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
    
    // Encoder le message pour l'URL
    const encodedMessage = encodeURIComponent(message);
    
    // Générer l'URL WhatsApp (api.whatsapp.com pour version web/mobile)
    return `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
}

/**
 * Affiche un lien WhatsApp pour l'approbation d'école
 * @param {object} schoolData - Informations de l'école
 * @param {object} adminData - Informations de l'administrateur
 * @param {string} schoolCode - Code de l'école généré
 * @returns {object} - Objet contenant le lien WhatsApp et le numéro
 */
function displayWhatsAppLink(schoolData, adminData, schoolCode) {
    // Créer le message formaté
    const message = `🎉 *FÉLICITATIONS !*\n\n` +
        `Votre école *${schoolData.name}* a été approuvée sur la plateforme SpeakFree !\n\n` +
        `📋 *INFORMATIONS DE CONNEXION :*\n\n` +
        `🏫 *École :* ${schoolData.name}\n` +
        `🔑 *Code école :* ${schoolCode}\n` +
        `👤 *Username :* ${adminData.username}\n` +
        `📧 *Email :* ${adminData.email}\n\n` +
        `🌐 *Accès à votre espace :*\n` +
        `http://localhost:3000/login\n\n` +
        `⚠️ *IMPORTANT :*\n` +
        `- Gardez ces informations en sécurité\n` +
        `- Changez votre mot de passe après la première connexion\n` +
        `- Le mot de passe initial est celui que vous avez fourni lors de l'inscription\n\n` +
        `✅ Vous pouvez maintenant accéder à votre tableau de bord administrateur !\n\n` +
        `📞 Support : support@speakfree.ci`;

    // Générer le lien WhatsApp
    const link = generateWhatsAppLink(adminData.phone, message);
    
    return {
        link: link,
        phone: adminData.phone,
        message: message
    };
}

/**
 * Envoie un message WhatsApp (en mode développement, affiche simplement le lien)
 * @param {string} phoneNumber - Numéro de téléphone
 * @param {string} message - Message à envoyer
 * @returns {Promise<object>} - Résultat de l'envoi
 */
async function sendWhatsAppMessage(phoneNumber, message) {
    const link = generateWhatsAppLink(phoneNumber, message);
    
    console.log('\n' + '═'.repeat(70));
    console.log('📲 LIEN WHATSAPP GÉNÉRÉ');
    console.log('═'.repeat(70));
    console.log(`\n📞 Destinataire : ${phoneNumber}`);
    console.log(`\n🔗 Lien WhatsApp :\n${link}`);
    console.log(`\n💬 Message :\n${message}`);
    console.log('\n' + '═'.repeat(70));
    console.log('👉 Copiez ce lien et ouvrez-le dans votre navigateur pour envoyer le message');
    console.log('   OU utilisez le bouton WhatsApp dans l\'interface d\'administration');
    console.log('═'.repeat(70) + '\n');
    
    return { 
        success: true,
        link: link,
        message: 'Lien WhatsApp généré avec succès'
    };
}

module.exports = {
    generateWhatsAppLink,
    displayWhatsAppLink,
    sendWhatsAppMessage
};
