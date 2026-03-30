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

// POST /favorites/toggle
// Body: { "fileId": "uuid" } ou { "folderId": "uuid" }
router.post('/toggle', toggleFavorite);

// GET /favorites
// Récupère tous les favoris de l'utilisateur connecté
router.get('/', getFavorites);

export default router;