// Module SMS simplifié
module.exports = {
    sendSMS: async (to, message) => {
        console.log(`📱 SMS simulé envoyé à ${to}`);
        console.log(`Message: ${message}`);
        return { success: true };
    },
    
    sendWhatsApp: async (to, message) => {
        console.log(`📲 WhatsApp simulé envoyé à ${to}`);
        console.log(`Message: ${message}`);
        return { success: true };
    }
};
