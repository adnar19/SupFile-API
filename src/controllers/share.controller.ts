import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../config/prisma';
import crypto from 'crypto';

// --- PARTAGE PUBLIC (Lien) ---
export const createPublicLink = async (req: AuthRequest, res: Response) => {
    try {
        const { fileId, expiresAt } = req.body;
        const userId = req.user?.userId;

        // Générer un token unique pour l'URL
        const token = crypto.randomBytes(16).toString('hex');

        const share = await prisma.publicShare.create({
            data: {
                token,
                fileId,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
            }
        });

        // On renvoie l'URL complète
        res.json({ shareUrl: `${process.env.CLIENT_URL}/share/${token}` });
    } catch (error) {
        res.status(500).json({ error: "Erreur lors de la création du lien public" });
    }
};

// --- PARTAGE INTERNE (Utilisateur à Utilisateur) ---
export const shareWithUser = async (req: AuthRequest, res: Response) => {
    try {
        const { fileId, folderId, targetUserEmail } = req.body;
        const ownerId = req.user?.userId;

        // 1. Trouver l'utilisateur cible par son email
        const targetUser = await prisma.user.findUnique({ where: { email: targetUserEmail } });
        if (!targetUser) return res.status(404).json({ message: "Utilisateur non trouvé" });

        // 2. Créer l'accès dans la table InternalShare
        const internalShare = await prisma.internalShare.create({
            data: {
                sharedById: ownerId!,
                sharedWithId: targetUser.id,
                fileId: fileId || null,
                folderId: folderId || null
            }
        });

        res.status(201).json({ message: `Élément partagé avec ${targetUser.fullName}` });
    } catch (error) {
        res.status(500).json({ error: "Erreur lors du partage interne" });
    }
};