import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import {
  createPublicLink,
  deletePublicLink,
  getMyPublicLinks,
  getPublicShareInfo,
  accessPublicShare,
  shareFileInternal,
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
// Routes Protégées — Liens publics (spécifiques AVANT :token)
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
 *     description: Récupère la liste de tous les liens de partage publics créés par l'utilisateur connecté.
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des liens publics récupérée avec succès.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       token:
 *                         type: string
 *                       link:
 *                         type: string
 *                         format: url
 *                       type:
 *                         type: string
 *                         enum: [file, folder]
 *                       item:
 *                         type: object
 *                       isPasswordProtected:
 *                         type: boolean
 *                       expiresAt:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       views:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/public/my-links', protect, getMyPublicLinks);

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

/**
 * @swagger
 * /share/public/{token}:
 *   delete:
 *     summary: Révoquer un lien public
 *     tags: [Sharing]
 */
router.delete('/public/:token', protect, deletePublicLink);

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
router.post('/internal', protect, shareFolderInternal);              // Partager dossier (+ permission)

/**
 * @swagger
 * /share/internal/file:
 *   post:
 *     summary: Partager un fichier individuel avec un autre utilisateur (apport MOBILE)
 *     tags: [Sharing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileId, email]
 *             properties:
 *               fileId:
 *                 type: string
 *                 format: uuid
 *               email:
 *                 type: string
 *               permission:
 *                 type: string
 *                 enum: [READ, WRITE]
 */
router.post('/internal/file', protect, shareFileInternal);           // Partager fichier (+ permission)

/**
 * @swagger
 * /share/internal:
 *   delete:
 *     summary: Révoquer un partage interne (fichier ou dossier)
 *     tags: [Sharing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, type, email]
 *             properties:
 *               itemId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *                 enum: [file, folder]
 *               email:
 *                 type: string
 */
router.delete('/internal', protect, removeInternalShare);            // Révoquer un partage

/**
 * @swagger
 * /share/internal/list:
 *   get:
 *     summary: Lister les éléments partagés avec moi
 *     description: Récupère tous les fichiers et dossiers auxquels l'utilisateur a accès via un partage interne.
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des éléments partagés récupérée avec succès
 */
router.get('/internal/list', protect, getSharedWithMe);              // "Partagés avec moi"

/**
 * @swagger
 * /share/internal/{folderId}/shares:
 *   get:
 *     summary: Lister les collaborateurs d'un dossier
 *     description: Récupère la liste des utilisateurs ayant accès à un dossier spécifique.
 *     tags: [Sharing]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Liste des partages récupérée avec succès
 */
router.get('/internal/:folderId/shares', protect, getFolderShares);  // Collaborateurs d'un dossier

export default router;
