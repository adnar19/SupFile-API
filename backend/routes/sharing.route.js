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

// ============================================
// Routes Publiques (Accessibles sans être connecté)
// ============================================
router.get('/public/:token', getPublicShareInfo);
router.post('/public/:token/download', accessPublicShare);

// ============================================
// Routes Protégées — Liens publics
// ============================================
router.post('/public/create', protect, createPublicLink);
router.get('/public/my-links', protect, getMyPublicLinks);          // Liste de mes liens
router.delete('/public/:token', protect, deletePublicLink);          // Révoquer un lien

// ============================================
// Routes Protégées — Partage interne
// ============================================
router.post('/internal', protect, shareFolderInternal);              // Partager (+ permission)
router.delete('/internal', protect, removeInternalShare);            // Révoquer un partage
router.get('/internal/list', protect, getSharedWithMe);              // "Partagés avec moi"
router.get('/internal/:folderId/shares', protect, getFolderShares);  // Collaborateurs d'un dossier

export default router;