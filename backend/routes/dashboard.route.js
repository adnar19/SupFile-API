import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { getDashboardStats,search } from '../controllers/dashboard.controller.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Statistiques et Recherche globale
 */

/**
 * @swagger
 * /dashboard:
 *   get:
 *     summary: Récupérer les statistiques du stockage
 *     description: Retourne l'espace utilisé, le quota et la distribution par type.
 *     tags: [Dashboard]
 *     security:
 *       - cookieAuth: []
 */
router.get('/', getDashboardStats);

/**
 * @swagger
 * /dashboard/search:
 *   get:
 *     summary: Recherche globale (Fichiers et Dossiers)
 *     tags: [Dashboard]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Texte à rechercher
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [image, video, audio, document, other]
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 15
 *     responses:
 *       200:
 *         description: Résultats de recherche paginés
 */
router.get('/search', search);

export default router;
