import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';

// ============================================
// DASHBOARD STATS
// ============================================
export const getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Toutes les requêtes sont indépendantes → exécution en parallèle
    const [user, distributionRaw, recentFiles] = await Promise.all([

      // 1. Storage Quota & Total Usage
      prisma.user.findUnique({
        where: { id: userId },
        select: { storageUsed: true, storageQuota: true }
      }),

      // 2. Storage Distribution agrégée côté PostgreSQL (évite de charger tous les fichiers en mémoire)
      // CASE WHEN délègue la classification au moteur SQL — O(1) mémoire Node.js
      prisma.$queryRaw`
        SELECT
          SUM(CASE WHEN mime_type LIKE 'image/%' THEN size ELSE 0 END)                                                                   AS image,
          SUM(CASE WHEN mime_type LIKE 'video/%' THEN size ELSE 0 END)                                                                   AS video,
          SUM(CASE WHEN mime_type LIKE 'audio/%' THEN size ELSE 0 END)                                                                   AS audio,
          SUM(CASE WHEN mime_type SIMILAR TO '%(pdf|word|text|document|sheet|presentation)%'
                    AND mime_type NOT LIKE 'image/%'
                    AND mime_type NOT LIKE 'video/%'
                    AND mime_type NOT LIKE 'audio/%'
                   THEN size ELSE 0 END)                                                                                                  AS document,
          SUM(CASE WHEN mime_type NOT LIKE 'image/%'
                    AND mime_type NOT LIKE 'video/%'
                    AND mime_type NOT LIKE 'audio/%'
                    AND mime_type NOT SIMILAR TO '%(pdf|word|text|document|sheet|presentation)%'
                   THEN size ELSE 0 END)                                                                                                  AS other
        FROM files
        WHERE owner_id = ${userId}
          AND is_deleted = false
      `,

      // 3. Recent Files (Last 5) — index sur (owner_id, is_deleted, updated_at DESC) recommandé
      prisma.file.findMany({
        where: { ownerId: userId, isDeleted: false },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true, name: true, mimeType: true, size: true,
          folderId: true, createdAt: true, updatedAt: true
        }
      }),
    ]);

    // PostgreSQL retourne les BigInt en string via queryRaw — conversion propre
    const raw = distributionRaw[0];
    const distribution = {
      image:    Number(raw.image    ?? 0),
      video:    Number(raw.video    ?? 0),
      audio:    Number(raw.audio    ?? 0),
      document: Number(raw.document ?? 0),
      other:    Number(raw.other    ?? 0),
    };

    res.status(200).json({
      success: true,
      data: {
        storage: {
          used: user.storageUsed.toString(),
          quota: user.storageQuota.toString(),
          distribution
        },
        recentFiles: recentFiles.map(f => ({ ...f, size: f.size.toString() }))
      }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// SEARCH FILES & FOLDERS
// Query params:
//   q        - texte à rechercher (obligatoire)
//   type     - filtre par type MIME : 'image' | 'video' | 'document' | 'audio' | 'other'
//   dateFrom - filtre date de création (ISO 8601, ex: 2024-01-01)
//   dateTo   - filtre date de création (ISO 8601, ex: 2024-12-31)
//   page     - numéro de page (défaut: 1)
//   limit    - items par page (défaut: 15, max: 50)
// ============================================
export const search = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { q, type, dateFrom, dateTo, page, limit } = req.query;

    if (!q || q.trim().length === 0) {
      throw ErrorTypes.BadRequest("Le paramètre de recherche 'q' est requis.");
    }

    const searchTerm = q.trim();

    // --- Pagination ---
    const PAGE_SIZE = Math.min(parseInt(limit) || 15, 50); // défaut 15, max 50
    const currentPage = Math.max(parseInt(page) || 1, 1);  // min page 1
    const skip = (currentPage - 1) * PAGE_SIZE;

    // --- Filtre date ---
    const dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        // Inclure toute la journée du dateTo
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        dateFilter.createdAt.lte = to;
      }
    }

    // --- Filtre type MIME pour les fichiers ---
    const buildMimeFilter = (type) => {
      switch (type) {
        case 'image':    return { mimeType: { startsWith: 'image/' } };
        case 'video':    return { mimeType: { startsWith: 'video/' } };
        case 'audio':    return { mimeType: { startsWith: 'audio/' } };
        case 'document': return {
          OR: [
            { mimeType: { contains: 'pdf' } },
            { mimeType: { contains: 'word' } },
            { mimeType: { contains: 'text' } },
            { mimeType: { contains: 'document' } },
            { mimeType: { contains: 'sheet' } },
            { mimeType: { contains: 'presentation' } },
          ]
        };
        case 'other': return {
          NOT: {
            OR: [
              { mimeType: { startsWith: 'image/' } },
              { mimeType: { startsWith: 'video/' } },
              { mimeType: { startsWith: 'audio/' } },
              { mimeType: { contains: 'pdf' } },
              { mimeType: { contains: 'word' } },
              { mimeType: { contains: 'text' } },
              { mimeType: { contains: 'document' } },
              { mimeType: { contains: 'sheet' } },
              { mimeType: { contains: 'presentation' } },
            ]
          }
        };
        default: return {};
      }
    };

    const mimeFilter = type ? buildMimeFilter(type) : {};

    const fileWhere = {
      ownerId: userId,
      isDeleted: false,
      name: { contains: searchTerm, mode: 'insensitive' },
      ...mimeFilter,
      ...dateFilter,
    };

    const folderWhere = {
      ownerId: userId,
      isDeleted: false,
      name: { contains: searchTerm, mode: 'insensitive' },
      ...dateFilter,
    };

    // --- Recherche en parallèle : données + totaux pour la pagination ---
    const [files, totalFiles, folders, totalFolders] = await Promise.all([
      prisma.file.findMany({
        where: fileWhere,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: PAGE_SIZE,
      }),
      prisma.file.count({ where: fileWhere }),

      // Les dossiers ne sont filtrés que par nom et date (pas de type MIME)
      type ? Promise.resolve([]) : prisma.folder.findMany({
        where: folderWhere,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: PAGE_SIZE,
      }),
      type ? Promise.resolve(0) : prisma.folder.count({ where: folderWhere }),
    ]);

    res.status(200).json({
      success: true,
      pagination: {
        page: currentPage,
        limit: PAGE_SIZE,
        totalFiles,
        totalFolders,
        totalPages: {
          files: Math.ceil(totalFiles / PAGE_SIZE),
          folders: Math.ceil(totalFolders / PAGE_SIZE),
        }
      },
      data: {
        files: files.map(f => ({ ...f, size: f.size.toString() })),
        folders,
      }
    });
  } catch (error) {
    next(error);
  }
};