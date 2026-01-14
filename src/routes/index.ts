import { Router } from 'express';
import authRoutes from './auth.routes';
import fileRoutes from './file.routes';
import folderRoutes from './folder.routes';
import shareRoutes from './share.routes';
import userRoutes from './user.routes';
import dashboardRoutes from './dashboard.routes';

const router = Router();

// 1. Authentification (Connexion, Inscription, OAuth)
router.use('/auth', authRoutes);

// 2. Gestion des Fichiers (Upload, Download, CRUD)
router.use('/files', fileRoutes);

// 3. Gestion des Dossiers (Création, Arborescence)
router.use('/folders', folderRoutes);

// 4. Partage & Liens Publics
router.use('/shares', shareRoutes);

// 5. Profil utilisateur & Paramètres
router.use('/users', userRoutes);

// 6. Dashboard (Stats & Activité)
router.use('/dashboard', dashboardRoutes);

export default router;