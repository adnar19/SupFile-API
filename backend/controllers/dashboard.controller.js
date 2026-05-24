import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';

// Helper pour formater les tailles
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const numBytes = Number(bytes);
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(numBytes) / Math.log(k));
  return parseFloat((numBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// ============================================
// DASHBOARD STATS
// ============================================
export const getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Toutes les requêtes sont indépendantes → exécution en parallèle
    const [user, distributionRaw, recentFiles, fileCounts] = await Promise.all([

      // 1. Storage Quota & Total Usage
      prisma.user.findUnique({
        where: { id: userId },
        select: { storageUsed: true, storageQuota: true }
      }),

      // 2. Storage Distribution agrégée côté PostgreSQL
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

      // 3. Recent Files (Last 5)
      prisma.file.findMany({
        where: { ownerId: userId, isDeleted: false },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true, name: true, mimeType: true, size: true,
          folderId: true, createdAt: true, updatedAt: true
        }
      }),

      // 4. File counts by type
      prisma.$queryRaw`
        SELECT
          COUNT(CASE WHEN mime_type LIKE 'image/%' THEN 1 END) AS image_count,
          COUNT(CASE WHEN mime_type LIKE 'video/%' THEN 1 END) AS video_count,
          COUNT(CASE WHEN mime_type LIKE 'audio/%' THEN 1 END) AS audio_count,
          COUNT(CASE WHEN mime_type SIMILAR TO '%(pdf|word|text|document|sheet|presentation)%'
                      AND mime_type NOT LIKE 'image/%'
                      AND mime_type NOT LIKE 'video/%'
                      AND mime_type NOT LIKE 'audio/%'
                     THEN 1 END) AS document_count,
          COUNT(CASE WHEN mime_type NOT LIKE 'image/%'
                      AND mime_type NOT LIKE 'video/%'
                      AND mime_type NOT LIKE 'audio/%'
                      AND mime_type NOT SIMILAR TO '%(pdf|word|text|document|sheet|presentation)%'
                     THEN 1 END) AS other_count
        FROM files
        WHERE owner_id = ${userId}
          AND is_deleted = false
      `,
    ]);

    // PostgreSQL retourne les BigInt en string via queryRaw — conversion propre
    const raw = distributionRaw[0];
    const counts = fileCounts[0];
    
    const distribution = {
      image:    Number(raw.image    ?? 0),
      video:    Number(raw.video    ?? 0),
      audio:    Number(raw.audio    ?? 0),
      document: Number(raw.document ?? 0),
      other:    Number(raw.other    ?? 0),
    };

    const totalSize = distribution.image + distribution.video + distribution.audio + distribution.document + distribution.other;
    
    // Calculer les pourcentages
    const calcPercentage = (size) => totalSize > 0 ? Math.round((size / totalSize) * 100) : 0;

    // Formater les types de fichiers pour le frontend
    const fileTypes = [
      {
        name: 'Photos',
        icon: 'image',
        color: '#4285F4',
        size: distribution.image,
        sizeFormatted: formatFileSize(distribution.image),
        count: Number(counts.image_count ?? 0),
        percentage: calcPercentage(distribution.image)
      },
      {
        name: 'Videos',
        icon: 'videocam',
        color: '#EA4335',
        size: distribution.video,
        sizeFormatted: formatFileSize(distribution.video),
        count: Number(counts.video_count ?? 0),
        percentage: calcPercentage(distribution.video)
      },
      {
        name: 'Audios',
        icon: 'audiotrack',
        color: '#34A853',
        size: distribution.audio,
        sizeFormatted: formatFileSize(distribution.audio),
        count: Number(counts.audio_count ?? 0),
        percentage: calcPercentage(distribution.audio)
      },
      {
        name: 'Documents',
        icon: 'description',
        color: '#FBBC04',
        size: distribution.document,
        sizeFormatted: formatFileSize(distribution.document),
        count: Number(counts.document_count ?? 0),
        percentage: calcPercentage(distribution.document)
      },
      {
        name: 'Other',
        icon: 'folder',
        color: '#1f2937',
        size: distribution.other,
        sizeFormatted: formatFileSize(distribution.other),
        count: Number(counts.other_count ?? 0),
        percentage: calcPercentage(distribution.other)
      }
    ];

    // Calculer les valeurs de stockage
    const usedBytes = Number(user.storageUsed);
    const quotaBytes = Number(user.storageQuota);
    const usedGB = usedBytes / (1024 * 1024 * 1024);
    const totalGB = quotaBytes / (1024 * 1024 * 1024);
    // Pourcentage avec 2 décimales pour les petits fichiers
    const percentage = quotaBytes > 0 ? parseFloat(((usedBytes / quotaBytes) * 100).toFixed(2)) : 0;

    res.status(200).json({
      success: true,
      data: {
        storage: {
          used: user.storageUsed.toString(),
          quota: user.storageQuota.toString(),
          distribution
        },
        // Format pour le HamburgerMenu et StorageManagement
        used: parseFloat(usedGB.toFixed(4)),
        total: parseFloat(totalGB.toFixed(2)),
        percentage: percentage,
        usedFormatted: formatFileSize(usedBytes),
        totalFormatted: formatFileSize(quotaBytes),
        fileTypes: fileTypes,
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