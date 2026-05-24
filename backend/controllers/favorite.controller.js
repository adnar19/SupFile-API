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
      await prisma.favorite.delete({ where: { id: existing.id } });
      return res.status(200).json({ success: true, message: "Retiré des favoris", favorited: false });
    } else {
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
// Mode 1 (MOBILE, défaut)  : data = [ { ...favorite, file, folder } ]
// Mode 2 (WEB, ?paginated=true ou ?page=N) : data = { folders, files }, pagination
// La compatibilité des deux clients est assurée par la query string.
// ============================================
export const getFavorites = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const wantsPaginated = req.query.paginated === 'true' || typeof req.query.page !== 'undefined';

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: {
        file: true,
        folder: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!wantsPaginated) {
      // ---- Format MOBILE (legacy) ----
      return res.status(200).json({
        success: true,
        data: favorites.map(fav => ({
          ...fav,
          file: fav.file ? { ...fav.file, size: fav.file.size.toString() } : null
        }))
      });
    }

    // ---- Format WEB (paginé, exclut la corbeille, sépare folders / files) ----
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const allFolders = [];
    const allFiles = [];

    for (const fav of favorites) {
      if (fav.folder && !fav.folder.isDeleted) {
        allFolders.push({ ...fav.folder, type: 'folder', favoriteCreatedAt: fav.createdAt });
      } else if (fav.file && !fav.file.isDeleted) {
        allFiles.push({
          ...fav.file,
          type: 'file',
          size: fav.file.size.toString(),
          favoriteCreatedAt: fav.createdAt
        });
      }
    }

    const combined = [...allFolders, ...allFiles];
    combined.sort((a, b) => new Date(b.favoriteCreatedAt) - new Date(a.favoriteCreatedAt));

    const totalItems = combined.length;
    const totalPages = Math.ceil(totalItems / limit);
    const paginatedItems = combined.slice(skip, skip + limit);

    const paginatedFolders = paginatedItems.filter(item => item.type === 'folder');
    const paginatedFiles = paginatedItems.filter(item => item.type === 'file');

    return res.status(200).json({
      success: true,
      data: {
        folders: paginatedFolders,
        files: paginatedFiles
      },
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        limit
      }
    });
  } catch (error) {
    next(error);
  }
};
