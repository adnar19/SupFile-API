import express from 'express';
import { toggleFavorite, getFavorites } from '../controllers/favorite.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Favorites
 *   description: Gestion des fichiers et dossiers favoris
 */

// Toutes les routes ci-dessous nécessitent une authentification
router.use(protect);

/**
 * @swagger
 * /favorites/toggle:
 *   post:
 *     summary: Ajouter ou retirer un élément des favoris
 *     description: Permet de basculer l'état "favori" d'un fichier ou d'un dossier.
 *     tags: [Favorites]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fileId:
 *                 type: string
 *                 format: uuid
 *                 description: ID du fichier à mettre en favori (optionnel si folderId est fourni)
 *               folderId:
 *                 type: string
 *                 format: uuid
 *                 description: ID du dossier à mettre en favori (optionnel si fileId est fourni)
 *             example:
 *               fileId: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       200:
 *         description: État favori mis à jour avec succès
 *       400:
 *         description: Requête invalide (ID manquant)
 *       401:
 *         description: Non authentifié
 */
router.post('/toggle', toggleFavorite);

/**
 * @swagger
 * /favorites:
 *   get:
 *     summary: Récupérer tous les favoris de l'utilisateur
 *     description: Retourne une liste unifiée des fichiers et dossiers marqués comme favoris.
 *     tags: [Favorites]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des favoris récupérée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     folders:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Folder'
 *                     files:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/File'
 *       401:
 *         description: Non authentifié
 */
router.get('/', getFavorites);

export default router;