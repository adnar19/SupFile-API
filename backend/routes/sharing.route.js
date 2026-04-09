import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { 
  createPublicLink,
  deletePublicLink,
  getMyPublicLinks,
  getPublicShareInfo, 
  accessPublicShare, 
  shareFolderInternal, 
  getFolderShares,
  removeInternalShare,
  getSharedWithMe 
} from '../controllers/sharing.controller.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Sharing
 *   description: Liens publics et partages internes collaboratifs
 */

// ============================================
// Routes Publiques (Accessibles sans être connecté)
// ============================================

/**
 * @swagger
 * /share/public/{token}:
 *   get:
 *     summary: Obtenir les infos d'un partage public
 *     tags: [Sharing]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/public/:token', getPublicShareInfo);

/**
 * @swagger
 * /share/public/{token}/download:
 *   post:
 *     summary: Accéder au contenu public (avec mdp si requis)
 *     tags: [Sharing]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 */
router.post('/public/:token/download', accessPublicShare);

// ============================================
// Routes Protégées — Liens publics
// ============================================

/**
 * @swagger
 * /share/public/create:
 *   post:
 *     summary: Créer un lien de partage public
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, type]
 *             properties:
 *               itemId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *                 enum: [file, folder]
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *               password:
 *                 type: string
 */
router.post('/public/create', protect, createPublicLink);

/**
 * @swagger
 * /share/public/my-links:
 *   get:
 *     summary: Lister mes liens publics actifs
 *     tags: [Sharing]
 */
router.get('/public/my-links', protect, getMyPublicLinks);          // Liste de mes liens

/**
 * @swagger
 * /share/public/{token}:
 *   delete:
 *     summary: Révoquer un lien public
 *     tags: [Sharing]
 */
router.delete('/public/:token', protect, deletePublicLink);          // Révoquer un lien

// ============================================
// Routes Protégées — Partage interne
// ============================================

/**
 * @swagger
 * /share/internal:
 *   post:
 *     summary: Partager un dossier avec un autre utilisateur
 *     tags: [Sharing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [folderId, email]
 *             properties:
 *               folderId:
 *                 type: string
 *                 format: uuid
 *               email:
 *                 type: string
 *               permission:
 *                 type: string
 *                 enum: [READ, WRITE]
 */
router.post('/internal', protect, shareFolderInternal);              // Partager (+ permission)
router.delete('/internal', protect, removeInternalShare);            // Révoquer un partage
router.get('/internal/list', protect, getSharedWithMe);              // "Partagés avec moi"
router.get('/internal/:folderId/shares', protect, getFolderShares);  // Collaborateurs d'un dossier

export default router;