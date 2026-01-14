import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../config/prisma';

export const getUserStats = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) return res.status(401).json({ message: "Utilisateur non identifié" });

        // 1. Récupérer les infos globales de l'utilisateur (Quota et utilisé)
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { storageQuota: true, usedStorage: true }
        });

        // 2. Récupérer la répartition par type de fichier (MimeType)
        const filesGrouped = await prisma.file.groupBy({
            by: ['mimeType'],
            where: { ownerId: userId, isDeleted: false },
            _sum: { size: true },
            _count: { id: true }
        });

        // 3. Récupérer l'activité récente (5 derniers fichiers ajoutés)
        const recentActivity = await prisma.file.findMany({
            where: { ownerId: userId },
            orderBy: { createdAt: 'desc' },
            take: 5
        });

        res.json({
            storage: {
                total: user?.storageQuota.toString(),
                used: user?.usedStorage.toString(),
                percentage: user ? Number((user.usedStorage * BigInt(100)) / user.storageQuota) : 0
            },
            distribution: filesGrouped,
            recentActivity
        });
    } catch (error) {
        res.status(500).json({ error: "Erreur lors de la récupération des statistiques" });
    }
};