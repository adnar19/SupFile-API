import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { 
  getUserById, 
  updateUserProfile 
} from '../controllers/user.controller.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Profil utilisateur et réglages
 */

// Toutes les routes utilisateur sont protégées
router.use(protect);

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Récupérer les infos d'un utilisateur
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 */
router.get('/:id', getUserById);

/**
 * @swagger
 * /users/{id}/profile:
 *   put:
 *     summary: Mettre à jour le profil
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               theme:
 *                 type: string
 *                 enum: [LIGHT, DARK]
 *               email:
 *                 type: string
 */
router.put('/:id/profile', updateUserProfile);

export default router;