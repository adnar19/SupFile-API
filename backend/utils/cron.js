
import cron from 'node-cron';
import { cleanupExpiredTokens } from '../services/email.service.js';

// Exécuter tous les jours à 2h du matin
export const startCronJobs = () => {
  cron.schedule('0 2 * * *', async () => {
    console.log('🧹 Nettoyage automatique des tokens...');
    await cleanupExpiredTokens();
  });
};


