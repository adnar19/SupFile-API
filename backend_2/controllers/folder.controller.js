import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';
import archiver from 'archiver';
import path from 'path';
import fs from 'fs';
// npm install archiver

// ============================================
// DEFAULT FOLDERS - Noms des dossiers par défaut
// ============================================
const DEFAULT_FOLDERS = ['Documents', 'Photos', 'Videos', 'Audios'];

// ============================================
// HELPER - Gérer les conflits de noms (ex: "Folder" -> "Folder (1)")
// ============================================
const getUniqueFolderName = async (folderName, parentId, ownerId) => {
  let name = folderName;
  let counter = 1;

  while (true) {
    const existingFolder = await prisma.folder.findFirst({
      where: {
        name: name,
        parentId: parentId,
        ownerId: ownerId,
        isDeleted: false
      }
    });

    if (!existingFolder) return name;

    name = `${folderName} (${counter})`;
    counter++;
  }
};

// ============================================
// ENSURE DEFAULT FOLDERS - Créer les dossiers par défaut s'ils n'existent pas
// ============================================
const ensureDefaultFolders = async (userId) => {
  // Nettoyer les dossiers avec des noms incorrects pour Audios
  const incorrectAudioFolders = await prisma.folder.findMany({
    where: {
      ownerId: userId,
      parentId: null,
      isDeleted: false,
      name: { in: ['audio', 'Audio', 'audios'] }
    }
  });

  for (const folder of incorrectAudioFolders) {
    const correctFolder = await prisma.folder.findFirst({
      where: {
        ownerId: userId,
        name: 'Audios',
        parentId: null,
        isDeleted: false
      }
    });

    if (correctFolder) {
      await prisma.file.updateMany({
        where: { folderId: folder.id },
        data: { folderId: correctFolder.id }
      });
    }

    await prisma.folder.delete({ where: { id: folder.id } });
    console.log(`Deleted incorrect audio folder: ${folder.name} (${folder.id})`);
  }

  // Nettoyer les doublons de dossiers par défaut
  for (const folderName of DEFAULT_FOLDERS) {
    const duplicates = await prisma.folder.findMany({
      where: {
        ownerId: userId,
        name: folderName,
        parentId: null,
        isDeleted: false
      },
      orderBy: { createdAt: 'asc' }
    });

    if (duplicates.length > 1) {
      const [keep, ...toDelete] = duplicates;
      for (const dup of toDelete) {
        await prisma.file.updateMany({
          where: { folderId: dup.id },
          data: { folderId: keep.id }
        });
        await prisma.folder.delete({ where: { id: dup.id } });
        console.log(`Deleted duplicate folder: ${folderName} (${dup.id})`);
      }
    }
  }

  // Créer les dossiers manquants
  const existingFolders = await prisma.folder.findMany({
    where: {
      ownerId: userId,
      name: { in: DEFAULT_FOLDERS },
      parentId: null,
      isDeleted: false
    },
    select: { name: true }
  });

  const existingNames = existingFolders.map(f => f.name);
  const missingFolders = DEFAULT_FOLDERS.filter(name => !existingNames.includes(name));

  for (const folderName of missingFolders) {
    await prisma.folder.create({
      data: {
        name: folderName,
        ownerId: userId,
        path: `/${folderName}`,
        parentId: null
      }
    });
    console.log(`Created default folder: ${folderName} for user ${userId}`);
  }

  return missingFolders.length > 0;
};

// ============================================
// AUTO-ORGANIZE FILES INTERNAL - Fonction interne sans route
// ============================================
const autoOrganizeFilesInternal = async (userId) => {
  try {
    const defaultFolders = await prisma.folder.findMany({
      where: {
        ownerId: userId,
        name: { in: DEFAULT_FOLDERS },
        parentId: null,
        isDeleted: false
      }
    });

    const folderMap = {};
    defaultFolders.forEach(f => {
      folderMap[f.name] = f.id;
    });

    const mimeCategories = {
      Photos: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'],
      Videos: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/webm', 'video/3gpp', 'video/3gpp2', 'video/mpeg', 'video/x-matroska'],
      Audios: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/flac', 'audio/opus', 'audio/x-wav', 'audio/webm', 'audio/3gpp', 'audio/x-flac'],
      Documents: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/csv', 'application/rtf', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation']
    };

    let movedCount = 0;

    for (const [folderName, mimeTypes] of Object.entries(mimeCategories)) {
      const folderId = folderMap[folderName];
      if (!folderId) continue;

      // Déplacer uniquement les fichiers sans dossier (à la racine)
      const files = await prisma.file.findMany({
        where: {
          ownerId: userId,
          isDeleted: false,
          mimeType: { in: mimeTypes },
          folderId: null
        }
      });

      for (const file of files) {
        await prisma.file.update({
          where: { id: file.id },
          data: { folderId }
        });
        movedCount++;
      }
    }

    if (movedCount > 0) {
      console.log(`Auto-organized ${movedCount} files for user ${userId}`);
    }
  } catch (error) {
    console.error('Auto-organize error:', error);
  }
};

// ============================================
// GET ALL FOLDERS (Liste tous les dossiers de l'utilisateur)
// ============================================
export const getAllFolders = async (req, res, next) => {
  try {
    const userId = req.user.id;

    await ensureDefaultFolders(userId);
    await autoOrganizeFilesInternal(userId);

    const folders = await prisma.folder.findMany({
      where: {
        ownerId: userId,
        isDeleted: false
      },
      include: {
        favorites: { where: { userId } },
        _count: {
          select: {
            files: { where: { isDeleted: false } },
            subfolders: { where: { isDeleted: false } }
          }
        }
      },
      orderBy: [{ name: 'asc' }]
    });

    const formattedFolders = folders.map(folder => ({
      ...folder,
      isFavorited: folder.favorites.length > 0,
      fileCount: folder._count.files,
      subfolderCount: folder._count.subfolders,
      isDefault: DEFAULT_FOLDERS.includes(folder.name) && folder.parentId === null
    }));

    res.status(200).json({
      success: true,
      data: formattedFolders
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// AUTO-ORGANIZE FILES - Route publique
// ============================================
export const autoOrganizeFiles = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const defaultFolders = await prisma.folder.findMany({
      where: {
        ownerId: userId,
        name: { in: DEFAULT_FOLDERS },
        parentId: null,
        isDeleted: false
      }
    });

    const folderMap = {};
    defaultFolders.forEach(f => {
      folderMap[f.name] = f.id;
    });

    const mimeCategories = {
      Photos: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'],
      Videos: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/webm', 'video/3gpp', 'video/3gpp2', 'video/mpeg', 'video/x-matroska'],
      Audios: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/flac', 'audio/opus', 'audio/x-wav', 'audio/webm', 'audio/3gpp', 'audio/x-flac'],
      Documents: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/csv', 'application/rtf']
    };

    let movedCount = 0;

    for (const [folderName, mimeTypes] of Object.entries(mimeCategories)) {
      const folderId = folderMap[folderName];
      if (!folderId) continue;

      const files = await prisma.file.findMany({
        where: {
          ownerId: userId,
          isDeleted: false,
          mimeType: { in: mimeTypes },
          folderId: null
        }
      });

      for (const file of files) {
        await prisma.file.update({
          where: { id: file.id },
          data: { folderId }
        });
        movedCount++;
      }
    }

    res.status(200).json({
      success: true,
      message: `${movedCount} fichiers organisés automatiquement`,
      data: { movedCount }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// CREATE FOLDER
// ============================================
export const createFolder = async (req, res, next) => {
  try {
    const { name, parentId } = req.body;
    const userId = req.user.id;

    if (!name) {
      throw ErrorTypes.BadRequest('Le nom du dossier est requis');
    }

    let parentPath = '';
    let finalParentId = parentId;

    if (parentId) {
      const parentFolder = await prisma.folder.findUnique({
        where: { id: parentId }
      });

      if (!parentFolder) throw ErrorTypes.NotFound('Dossier parent introuvable');

      // Vérification permission d'écriture si pas propriétaire
      if (parentFolder.ownerId !== userId) {
        const shares = await prisma.internalShare.findMany({
          where: { sharedWithId: userId, permission: 'WRITE' },
          include: { folder: true }
        });
        const hasWriteAccess = shares.some(s => parentFolder.path.startsWith(s.folder.path));
        if (!hasWriteAccess) throw ErrorTypes.Forbidden("Vous n'avez pas la permission d'écrire dans ce dossier.");
      }

      parentPath = parentFolder.path;
    } else {
      // Pas de parentId : créer à la racine sans rattacher à "My Files"
      finalParentId = null;
      parentPath = `/${name}`;
    }

    // Gestion des conflits de nom
    const uniqueName = await getUniqueFolderName(name, finalParentId, userId);

    const folder = await prisma.folder.create({
      data: {
        name: uniqueName,
        path: finalParentId ? `${parentPath}/${uniqueName}` : `/${uniqueName}`,
        parentId: finalParentId,
        ownerId: userId
      }
    });

    res.status(201).json({
      success: true,
      message: 'Dossier créé avec succès',
      data: folder
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// GET FOLDER CONTENTS (Navigation)
// ============================================
export const getFolderContents = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    let currentFolder;

    if (id === 'root') {
      currentFolder = await prisma.folder.findFirst({
        where: { ownerId: userId, parentId: null }
      });

      if (!currentFolder) {
        currentFolder = await prisma.folder.create({
          data: { name: 'My Files', ownerId: userId, path: '/My Files' }
        });
      }
    } else {
      currentFolder = await prisma.folder.findUnique({ where: { id } });

      if (!currentFolder || currentFolder.ownerId !== userId) {
        // Vérification accès partagé direct
        const directShare = await prisma.internalShare.findFirst({
          where: { folderId: id, sharedWithId: userId }
        });

        // Vérification accès partagé hérité (sous-dossier)
        const allUserShares = await prisma.internalShare.findMany({
          where: {
            sharedWithId: userId,
            folder: { isDeleted: false }
          },
          include: { folder: { select: { path: true } } }
        });

        const isChildOfShare = allUserShares.some(
          share => currentFolder && currentFolder.path.startsWith(share.folder.path + '/')
        );

        if (!directShare && !isChildOfShare) {
          throw ErrorTypes.NotFound('Dossier introuvable ou accès refusé');
        }
      }
    }

    // Utiliser le bon ownerId selon que c'est son dossier ou un dossier partagé
    const queryOwnerId = currentFolder.ownerId === userId ? userId : currentFolder.ownerId;

    console.log('getFolderContents:', {
      folderId: currentFolder.id,
      folderName: currentFolder.name,
      folderOwnerId: currentFolder.ownerId,
      userId,
      queryOwnerId
    });

    const [folders, files] = await Promise.all([
      prisma.folder.findMany({
        where: {
          parentId: currentFolder.id,
          ownerId: queryOwnerId,
          isDeleted: false
        },
        include: {
          favorites: { where: { userId } },
          _count: {
            select: {
              files: { where: { isDeleted: false } },
              subfolders: { where: { isDeleted: false } }
            }
          }
        },
        orderBy: { name: 'asc' }
      }),
      prisma.file.findMany({
        where: {
          folderId: currentFolder.id,
          ownerId: queryOwnerId,
          isDeleted: false
        },
        include: {
          favorites: { where: { userId } }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    console.log('getFolderContents results:', {
      foldersFound: folders.length,
      filesFound: files.length,
      fileNames: files.map(f => f.name)
    });

    // Breadcrumbs optimisés via les paths
    const pathParts = currentFolder.path.split('/').filter(p => p);
    const ancestorPaths = pathParts.map((_, index) => {
      return '/' + pathParts.slice(0, index + 1).join('/');
    });

    const breadcrumbsData = await prisma.folder.findMany({
      where: {
        ownerId: userId,
        path: { in: ancestorPaths }
      },
      select: { id: true, name: true, path: true }
    });

    const breadcrumbs = breadcrumbsData.sort((a, b) => a.path.length - b.path.length);

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const formattedFolders = folders.map(f => {
      const { favorites, _count, ...folderData } = f;
      return {
        ...folderData,
        type: 'folder',
        isFavorite: favorites.length > 0,
        isFavorited: favorites.length > 0,
        fileCount: _count.files,
        subfolderCount: _count.subfolders
      };
    });

    const formattedFiles = files.map(f => {
      const { favorites, ...fileData } = f;
      return {
        ...fileData,
        type: 'file',
        size: f.size.toString(),
        isFavorite: favorites.length > 0,
        isFavorited: favorites.length > 0
      };
    });

    const combined = [...formattedFolders, ...formattedFiles];
    const totalItems = combined.length;
    const totalPages = Math.ceil(totalItems / limit);
    const paginatedItems = combined.slice(skip, skip + limit);

    const paginatedFolders = paginatedItems.filter(item => item.type === 'folder');
    const paginatedFiles = paginatedItems.filter(item => item.type === 'file');

    res.status(200).json({
      success: true,
      data: {
        currentFolder,
        breadcrumbs,
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

// ============================================
// DELETE FOLDER (Soft Delete)
// ============================================
export const deleteFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const folder = await prisma.folder.findUnique({ where: { id } });

    if (!folder || folder.ownerId !== userId) {
      throw ErrorTypes.NotFound('Dossier introuvable');
    }

    // Empêcher la suppression des dossiers par défaut
    const isDefaultFolder = DEFAULT_FOLDERS.includes(folder.name) && folder.parentId === null;
    if (isDefaultFolder) {
      throw ErrorTypes.Forbidden('Les dossiers par défaut (Documents, Photos, Videos, Audios) ne peuvent pas être supprimés.');
    }

    if (!folder.path) {
      throw ErrorTypes.InternalError('Chemin du dossier manquant, impossible de supprimer récursivement.');
    }

    await prisma.$transaction(async (tx) => {
      const foldersToDelete = await tx.folder.findMany({
        where: {
          ownerId: userId,
          OR: [
            { id: id },
            { path: { startsWith: `${folder.path}/` } }
          ]
        },
        select: { id: true }
      });

      const folderIds = foldersToDelete.map(f => f.id);

      await tx.folder.updateMany({
        where: { id: { in: folderIds } },
        data: { isDeleted: true, deletedAt: new Date() }
      });

      await tx.file.updateMany({
        where: { folderId: { in: folderIds } },
        data: { isDeleted: true, deletedAt: new Date() }
      });
    });

    res.status(200).json({
      success: true,
      message: 'Dossier et son contenu déplacés dans la corbeille'
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// RENAME FOLDER
// ============================================
export const renameFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user.id;

    if (!name) throw ErrorTypes.BadRequest("Le nom est requis");

    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable");

    const oldPath = folder.path;
    const newPath = oldPath.substring(0, oldPath.lastIndexOf('/')) + '/' + name;

    await prisma.$transaction(async (tx) => {
      await tx.folder.update({
        where: { id },
        data: { name, path: newPath }
      });

      const children = await tx.folder.findMany({
        where: {
          ownerId: userId,
          path: { startsWith: oldPath + '/' }
        }
      });

      for (const child of children) {
        const childNewPath = newPath + child.path.substring(oldPath.length);
        await tx.folder.update({
          where: { id: child.id },
          data: { path: childNewPath }
        });
      }
    });

    res.status(200).json({ success: true, message: "Dossier renommé" });
  } catch (error) {
    next(error);
  }
};

// ============================================
// MOVE FOLDER
// ============================================
export const moveFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { parentId } = req.body;
    const userId = req.user.id;

    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable");

    let newPathPrefix = '';
    let finalParentId = parentId;

    if (parentId) {
      const parent = await prisma.folder.findUnique({ where: { id: parentId } });
      if (!parent || parent.ownerId !== userId) throw ErrorTypes.BadRequest("Dossier de destination invalide");

      if (parent.path.startsWith(folder.path)) {
        throw ErrorTypes.BadRequest("Impossible de déplacer un dossier dans lui-même");
      }
      newPathPrefix = parent.path;
    } else {
      const rootFolder = await prisma.folder.findFirst({ where: { ownerId: userId, parentId: null } });
      if (rootFolder) {
        finalParentId = rootFolder.id;
        newPathPrefix = rootFolder.path;
      }
    }

    const oldPath = folder.path;
    const newPath = `${newPathPrefix}/${folder.name}`;

    await prisma.$transaction(async (tx) => {
      await tx.folder.update({
        where: { id },
        data: { parentId: finalParentId, path: newPath }
      });

      const children = await tx.folder.findMany({
        where: { ownerId: userId, path: { startsWith: oldPath + '/' } }
      });

      for (const child of children) {
        const childNewPath = newPath + child.path.substring(oldPath.length);
        await tx.folder.update({
          where: { id: child.id },
          data: { path: childNewPath }
        });
      }
    });

    res.status(200).json({ success: true, message: "Dossier déplacé" });
  } catch (error) {
    next(error);
  }
};

// ============================================
// RESTORE FOLDER
// ============================================
export const restoreFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log('=== RESTORE FOLDER ===', { id, userId });

    const folderToRestore = await prisma.folder.findFirst({
      where: { id, ownerId: userId },
      include: { parent: true }
    });

    if (!folderToRestore) {
      throw ErrorTypes.NotFound("Dossier introuvable ou vous n'avez pas les permissions.");
    }

    if (!folderToRestore.isDeleted) {
      return res.status(400).json({ success: false, message: "Le dossier n'est pas dans la corbeille." });
    }

    if (folderToRestore.parent && folderToRestore.parent.isDeleted) {
      throw ErrorTypes.BadRequest("Impossible de restaurer ce dossier car son dossier parent est dans la corbeille. Veuillez d'abord restaurer le dossier parent.");
    }

    await prisma.$transaction(async (tx) => {
      let folderIdsToRestore = [folderToRestore.id];

      if (folderToRestore.path) {
        const subFolders = await tx.folder.findMany({
          where: {
            ownerId: userId,
            path: { startsWith: folderToRestore.path }
          },
          select: { id: true }
        });
        folderIdsToRestore = subFolders.map(f => f.id);
        if (!folderIdsToRestore.includes(folderToRestore.id)) {
          folderIdsToRestore.push(folderToRestore.id);
        }
      }

      await tx.folder.updateMany({ where: { id: { in: folderIdsToRestore } }, data: { isDeleted: false, deletedAt: null } });
      await tx.file.updateMany({ where: { folderId: { in: folderIdsToRestore } }, data: { isDeleted: false, deletedAt: null } });
    });

    res.status(200).json({
      success: true,
      message: "Dossier et son contenu restaurés avec succès."
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// DOWNLOAD FOLDER (ZIP)
// ============================================
export const downloadFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const rootFolder = await prisma.folder.findUnique({ where: { id } });
    if (!rootFolder || rootFolder.isDeleted) throw ErrorTypes.NotFound("Dossier introuvable");

    // Vérification accès : propriétaire OU partage interne
    if (rootFolder.ownerId !== userId) {
      const directShare = await prisma.internalShare.findFirst({
        where: { folderId: id, sharedWithId: userId }
      });

      const allUserShares = await prisma.internalShare.findMany({
        where: { sharedWithId: userId, folder: { isDeleted: false } },
        include: { folder: { select: { path: true } } }
      });

      const isChildOfShare = allUserShares.some(share => rootFolder.path.startsWith(share.folder.path + '/'));

      if (!directShare && !isChildOfShare) {
        throw ErrorTypes.Forbidden("Vous n'avez pas la permission de télécharger ce dossier.");
      }
    }

    if (!rootFolder.path) {
      throw ErrorTypes.InternalError("Chemin du dossier manquant, impossible de générer l'archive.");
    }

    const folders = await prisma.folder.findMany({
      where: {
        ownerId: rootFolder.ownerId,
        isDeleted: false,
        OR: [{ id: id }, { path: { startsWith: rootFolder.path + '/' } }]
      }
    });

    const folderIds = folders.map(f => f.id);
    const files = await prisma.file.findMany({
      where: {
        folderId: { in: folderIds },
        isDeleted: false
      }
    });

    const archive = archiver('zip', { zlib: { level: 9 } });
    res.attachment(`${rootFolder.name}.zip`);
    archive.pipe(res);
    archive.on('error', (err) => next(err));

    for (const folder of folders) {
      if (folder.id === rootFolder.id) continue;
      const relativePath = folder.path.substring(rootFolder.path.length + 1);
      archive.append(null, { name: relativePath + '/' });
    }

    for (const file of files) {
      const physicalPath = path.join(process.cwd(), 'uploads', file.storageName);

      if (fs.existsSync(physicalPath)) {
        const parentFolder = folders.find(f => f.id === file.folderId);
        let relativePath = file.name;

        if (parentFolder && parentFolder.id !== rootFolder.id) {
          const folderPart = parentFolder.path.substring(rootFolder.path.length + 1);
          relativePath = path.join(folderPart, file.name);
        }

        archive.file(physicalPath, { name: relativePath });
      }
    }

    await archive.finalize();
  } catch (error) {
    next(error);
  }
};

// ============================================
// PERMANENT DELETE FOLDER (Suppression définitive)
// ============================================
export const deleteFolderPermanently = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log('=== DELETE FOLDER PERMANENTLY ===', { id, userId });

    const folder = await prisma.folder.findFirst({
      where: { id, ownerId: userId, isDeleted: true }
    });

    if (!folder) throw ErrorTypes.NotFound("Dossier introuvable dans la corbeille");

    // Empêcher la suppression définitive des dossiers par défaut à la racine
    const isDefaultFolder = DEFAULT_FOLDERS.includes(folder.name) && folder.parentId === null;
    if (isDefaultFolder) {
      throw ErrorTypes.Forbidden(`Le dossier par défaut "${folder.name}" ne peut pas être supprimé définitivement.`);
    }

    let totalSize = BigInt(0);

    await prisma.$transaction(async (tx) => {
      // 1. Trouver tous les dossiers à supprimer
      const whereClause = folder.path
        ? { ownerId: userId, isDeleted: true, OR: [{ id: id }, { path: { startsWith: `${folder.path}/` } }] }
        : { id: id };

      const foldersToDelete = await tx.folder.findMany({
        where: whereClause,
        select: { id: true }
      });

      const folderIds = foldersToDelete.map(f => f.id);

      // 2. Trouver tous les fichiers dans ces dossiers
      const filesToDelete = await tx.file.findMany({
        where: {
          ownerId: userId,
          folderId: { in: folderIds }
        },
        select: { id: true, storageName: true, size: true }
      });

      // 3. Calculer la taille totale
      for (const file of filesToDelete) {
        totalSize += file.size;
      }

      // 4. Supprimer physiquement les fichiers
      for (const file of filesToDelete) {
        try {
          const filePath = path.join(process.cwd(), 'uploads', file.storageName);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted physical file: ${file.storageName}`);
          }
        } catch (err) {
          console.error(`Error deleting physical file ${file.storageName}:`, err.message);
        }
      }

      // 5. Supprimer les favoris liés
      await tx.favorite.deleteMany({
        where: {
          OR: [
            { fileId: { in: filesToDelete.map(f => f.id) } },
            { folderId: { in: folderIds } }
          ]
        }
      });

      // 6. Supprimer les partages publics liés
      await tx.publicShare.deleteMany({
        where: {
          OR: [
            { fileId: { in: filesToDelete.map(f => f.id) } },
            { folderId: { in: folderIds } }
          ]
        }
      });

      // 7. Supprimer les partages internes liés
      await tx.internalShare.deleteMany({
        where: { folderId: { in: folderIds } }
      });

      // 8. Supprimer les fichiers de la DB
      await tx.file.deleteMany({
        where: { id: { in: filesToDelete.map(f => f.id) } }
      });

      // 9. Supprimer les dossiers de la DB
      await tx.folder.deleteMany({
        where: { id: { in: folderIds } }
      });

      // 10. Mettre à jour le quota
      if (totalSize > BigInt(0)) {
        await tx.user.update({
          where: { id: userId },
          data: { storageUsed: { decrement: totalSize } }
        });
      }
    });

    res.status(200).json({
      success: true,
      message: "Dossier et son contenu supprimés définitivement"
    });
  } catch (error) {
    next(error);
  }
};