// Module email simplifié
module.exports = {
    sendEmail: async (to, subject, text) => {
        console.log(`📧 Email simulé envoyé à ${to}`);
        console.log(`Sujet: ${subject}`);
        return { success: true };
    }
};
