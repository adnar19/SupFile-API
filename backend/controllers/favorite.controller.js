import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';

// ============================================
// TOGGLE FAVORITE (Ajouter ou Retirer)
// ============================================
export const toggleFavorite = async (req, res, next) => {
  try {
    const { fileId, folderId } = req.body;
    const userId = req.user.id;

    if (!fileId && !folderId) {
      throw ErrorTypes.BadRequest("Un fileId ou un folderId est requis.");
    }

    if (fileId && folderId) {
      throw ErrorTypes.BadRequest("Veuillez fournir soit un fileId, soit un folderId, pas les deux.");
    }

    const where = {
      userId,
      fileId: fileId || null,
      folderId: folderId || null
    };

    const existing = await prisma.favorite.findFirst({ where });

    if (existing) {
      // Si déjà en favori, on le retire
      await prisma.favorite.delete({ where: { id: existing.id } });
      return res.status(200).json({ success: true, message: "Retiré des favoris", favorited: false });
    } else {
      // Sinon, on vérifie l'existence de l'objet et on l'ajoute
      if (fileId) {
        const file = await prisma.file.findUnique({ where: { id: fileId } });
        if (!file) throw ErrorTypes.NotFound("Fichier introuvable");
      } else {
        const folder = await prisma.folder.findUnique({ where: { id: folderId } });
        if (!folder) throw ErrorTypes.NotFound("Dossier introuvable");
      }

      const favorite = await prisma.favorite.create({ data: where });
      return res.status(201).json({ success: true, message: "Ajouté aux favoris", data: favorite, favorited: true });
    }
  } catch (error) {
    next(error);
  }
};

// ============================================
// GET FAVORITES
// ============================================
export const getFavorites = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: {
        file: true,
        folder: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      success: true,
      data: favorites.map(fav => ({
        ...fav,
        file: fav.file ? { ...fav.file, size: fav.file.size.toString() } : null
      }))
    });
  } catch (error) {
    next(error);
  }
};