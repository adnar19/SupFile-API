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
// ENSURE DEFAULT FOLDERS - Créer les dossiers par défaut s'ils n'existent pas
// ============================================
const ensureDefaultFolders = async (userId) => {
  // D'abord, nettoyer tous les dossiers avec des noms incorrects pour Audios
  const incorrectAudioFolders = await prisma.folder.findMany({
    where: {
      ownerId: userId,
      parentId: null,
      isDeleted: false,
      name: { in: ['audio', 'Audio', 'audios'] }
    }
  });

  // Supprimer les dossiers avec des noms incorrects et déplacer leurs fichiers
  for (const folder of incorrectAudioFolders) {
    // Trouver le dossier correct "Audios" ou le créer
    const correctFolder = await prisma.folder.findFirst({
      where: {
        ownerId: userId,
        name: 'Audios',
        parentId: null,
        isDeleted: false
      }
    });

    if (correctFolder) {
      // Déplacer les fichiers du dossier incorrect vers "Audios"
      await prisma.file.updateMany({
        where: { folderId: folder.id },
        data: { folderId: correctFolder.id }
      });
    }

    // Supprimer le dossier incorrect
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

    // Garder le premier, supprimer les autres
    if (duplicates.length > 1) {
      const [keep, ...toDelete] = duplicates;
      for (const dup of toDelete) {
        // Déplacer les fichiers du dossier dupliqué vers le premier
        await prisma.file.updateMany({
          where: { folderId: dup.id },
          data: { folderId: keep.id }
        });
        // Supprimer le dossier dupliqué
        await prisma.folder.delete({ where: { id: dup.id } });
        console.log(`Deleted duplicate folder: ${folderName} (${dup.id})`);
      }
    }
  }

  // Vérifier si les dossiers par défaut existent
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

  // Créer les dossiers manquants
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
// GET ALL FOLDERS (Liste tous les dossiers de l'utilisateur)
// ============================================
export const getAllFolders = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // S'assurer que les dossiers par défaut existent
    await ensureDefaultFolders(userId);

    // Organiser automatiquement les fichiers dans les dossiers par défaut
    await autoOrganizeFilesInternal(userId);

    // Récupérer tous les dossiers non supprimés
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
      orderBy: [
        { name: 'asc' }
      ]
    });

    // Formater la réponse
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
// AUTO-ORGANIZE FILES INTERNAL - Fonction interne sans route
// ============================================
const autoOrganizeFilesInternal = async (userId) => {
  try {
    // Récupérer les dossiers par défaut
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

    // Définir les catégories MIME pour chaque dossier
    const mimeCategories = {
      Photos: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif'],
      Videos: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/webm', 'video/3gpp', 'video/3gpp2', 'video/mpeg', 'video/x-matroska'],
      Audios: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/flac', 'audio/opus', 'audio/x-wav', 'audio/webm', 'audio/3gpp', 'audio/x-flac'],
      Documents: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/csv', 'application/rtf', 'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.presentation']
    };

    let movedCount = 0;

    // Pour chaque catégorie, déplacer les fichiers
    for (const [folderName, mimeTypes] of Object.entries(mimeCategories)) {
      const folderId = folderMap[folderName];
      if (!folderId) continue;

      // Trouver uniquement les fichiers sans dossier (à la racine)
      // Ne pas déplacer les fichiers déjà dans des dossiers personnalisés
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
    // Ne pas lancer d'erreur, c'est juste une fonction d'optimisation
  }
};

// ============================================
// AUTO-ORGANIZE FILES - Organiser automatiquement les fichiers dans les dossiers par défaut
// ============================================
export const autoOrganizeFiles = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Récupérer les dossiers par défaut
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

    // Définir les catégories MIME pour chaque dossier
    const mimeCategories = {
      Photos: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff'],
      Videos: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/webm'],
      Audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/m4a'],
      Documents: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/csv']
    };

    let movedCount = 0;

    // Pour chaque catégorie, déplacer les fichiers
    for (const [folderName, mimeTypes] of Object.entries(mimeCategories)) {
      const folderId = folderMap[folderName];
      if (!folderId) continue;

      // Trouver les fichiers non organisés (sans dossier ou dans un dossier non par défaut)
      const files = await prisma.file.findMany({
        where: {
          ownerId: userId,
          isDeleted: false,
          mimeType: { in: mimeTypes },
          OR: [
            { folderId: null }, // Sans dossier
            { folder: { parentId: { not: null } } } // Dans un sous-dossier
          ]
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

    // If parentId is provided, verify it exists and belongs to user
    if (parentId) {
      const parentFolder = await prisma.folder.findUnique({
        where: { id: parentId }
      });

      if (!parentFolder) throw ErrorTypes.NotFound('Dossier parent introuvable');
      
      // Si je ne suis pas le propriétaire, je dois avoir une permission d'écriture
      if (parentFolder.ownerId !== userId) {
        const shares = await prisma.internalShare.findMany({
          where: { sharedWithId: userId, permission: 'WRITE' },
          include: { folder: true }
        });
        
        // On vérifie si le dossier parent fait partie d'une arborescence partagée en écriture
        const hasWriteAccess = shares.some(s => parentFolder.path.startsWith(s.folder.path));
        if (!hasWriteAccess) throw ErrorTypes.Forbidden("Vous n'avez pas la permission d'écrire dans ce dossier.");
      }

      parentPath = parentFolder.path;
    } else {
      // If no parentId, create at root level (not under My Files)
      parentPath = `/${name}`;
      finalParentId = null;
    }

    const folder = await prisma.folder.create({
      data: {
        name,
        path: parentPath,
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
    const { id } = req.params; // Can be 'root' or a UUID
    const userId = req.user.id;

    let currentFolder;

    // Handle "root" alias
    if (id === 'root') {
      currentFolder = await prisma.folder.findFirst({
        where: { ownerId: userId, parentId: null }
      });
      
      // Fallback: Create root if it doesn't exist (safety net)
      if (!currentFolder) {
        currentFolder = await prisma.folder.create({
          data: { name: 'My Files', ownerId: userId, path: '/My Files' }
        });
      }
    } else {
      currentFolder = await prisma.folder.findUnique({
        where: { id }
      });
      
      if (!currentFolder || currentFolder.ownerId !== userId) {
        // Vérification si c'est un dossier partagé (ou un sous-dossier d'un partage)
        // 1. Vérification directe (le dossier racine partagé)
        const directShare = await prisma.internalShare.findUnique({
          where: { folderId_sharedWithId: { folderId: id, sharedWithId: userId } }
        });

        // 2. Vérification héritée (sous-dossier)
        // On cherche tous les partages de l'utilisateur et on regarde si le chemin correspond
        const allUserShares = await prisma.internalShare.findMany({
          where: { 
            sharedWithId: userId,
            folder: { isDeleted: false } // SÉCURITÉ : Ignorer les partages provenant de dossiers supprimés
          },
          include: { folder: { select: { path: true } } }
        });

        const isChildOfShare = allUserShares.some(share => currentFolder && currentFolder.path.startsWith(share.folder.path + '/'));

        if (!directShare && !isChildOfShare) {
           throw ErrorTypes.NotFound('Dossier introuvable ou accès refusé');
        }
      }
    }

    // Déterminer le propriétaire à utiliser pour la requête
    // Si c'est le dossier de l'utilisateur courant, utiliser userId
    // Sinon (dossier partagé), utiliser le propriétaire du dossier
    const queryOwnerId = currentFolder.ownerId === userId ? userId : currentFolder.ownerId;
    
    console.log('getFolderContents:', {
      folderId: currentFolder.id,
      folderName: currentFolder.name,
      folderOwnerId: currentFolder.ownerId,
      userId,
      queryOwnerId
    });

    // Fetch subfolders and files in parallel
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

    // Build Breadcrumbs (Ancestors) - Optimized version
    const pathParts = currentFolder.path.split('/').filter(p => p);
    const ancestorPaths = pathParts.map((part, index) => {
      return '/' + pathParts.slice(0, index + 1).join('/');
    });

    const breadcrumbsData = await prisma.folder.findMany({
      where: {
        ownerId: userId,
        path: { in: ancestorPaths }
      },
      select: { id: true, name: true, path: true },
    });

    // Sort breadcrumbs correctly based on path depth
    const breadcrumbs = breadcrumbsData.sort((a, b) => a.path.length - b.path.length);

    res.status(200).json({
      success: true,
      data: {
        currentFolder,
        breadcrumbs,
        folders: folders.map(f => {
          const { favorites, _count, ...folderData } = f;
          return { 
            ...folderData, 
            isFavorited: favorites.length > 0,
            fileCount: _count.files,
            subfolderCount: _count.subfolders
          };
        }),
        files: files.map(f => {
          const { favorites, ...fileData } = f;
          return { ...fileData, size: f.size.toString(), isFavorited: favorites.length > 0 };
        })
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
      throw ErrorTypes.Forbidden('Les dossiers par défaut (Documents, Photos, Videos, Audio) ne peuvent pas être supprimés.');
    }

    if (!folder.path) {
      throw ErrorTypes.InternalError('Chemin du dossier manquant, impossible de supprimer récursivement.');
    }

    // Suppression récursive (Soft Delete)
    // On utilise une transaction pour garantir que tout ou rien n'est supprimé
    await prisma.$transaction(async (tx) => {
      // 1. Identifier tous les sous-dossiers (le dossier cible + ses descendants)
      // On utilise le chemin (path) pour trouver les descendants efficacement
      const foldersToDelete = await tx.folder.findMany({
        where: {
          ownerId: userId,
          OR: [
            { id: id }, // Le dossier lui-même
            { path: { startsWith: `${folder.path}/` } } // Ses enfants (ex: /Parent/Enfant)
          ]
        },
        select: { id: true }
      });

      const folderIds = foldersToDelete.map(f => f.id);

      // 2. Marquer les dossiers comme supprimés
      await tx.folder.updateMany({
        where: { id: { in: folderIds } },
        data: { isDeleted: true, deletedAt: new Date() }
      });

      // 3. Marquer les fichiers contenus dans ces dossiers comme supprimés
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

    // Mise à jour du chemin pour le dossier et ses enfants
    // Note: C'est une opération coûteuse si l'arborescence est profonde.
    // Pour simplifier ici, on met juste à jour le nom. 
    // Dans un système de production avec "path" matérialisé, il faudrait mettre à jour tous les enfants :
    // oldPath: /A/OldName -> newPath: /A/NewName
    // child: /A/OldName/B -> /A/NewName/B

    const oldPath = folder.path;
    const newPath = oldPath.substring(0, oldPath.lastIndexOf('/')) + '/' + name;

    await prisma.$transaction(async (tx) => {
      // 1. Renommer le dossier
      await tx.folder.update({
        where: { id },
        data: { name, path: newPath }
      });

      // 2. Mettre à jour les chemins des enfants (SQL brut souvent plus simple pour le remplacement de chaîne)
      // Ici on le fait en JS pour rester agnostique, mais attention aux perfs sur gros volumes
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
    const { parentId } = req.body; // null pour root
    const userId = req.user.id;

    const folder = await prisma.folder.findUnique({ where: { id } });
    if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable");

    let newPathPrefix = '';
    let finalParentId = parentId;

    if (parentId) {
      const parent = await prisma.folder.findUnique({ where: { id: parentId } });
      if (!parent || parent.ownerId !== userId) throw ErrorTypes.BadRequest("Dossier de destination invalide");
      
      // Empêcher le déplacement d'un dossier dans lui-même ou ses enfants
      if (parent.path.startsWith(folder.path)) {
         throw ErrorTypes.BadRequest("Impossible de déplacer un dossier dans lui-même");
      }
      newPathPrefix = parent.path;
    } else {
      // Déplacement vers la racine (My Files)
      const rootFolder = await prisma.folder.findFirst({ where: { ownerId: userId, parentId: null } });
      if (rootFolder) {
        finalParentId = rootFolder.id;
        newPathPrefix = rootFolder.path;
      }
    }

    const oldPath = folder.path;
    const newPath = `${newPathPrefix}/${folder.name}`;

    await prisma.$transaction(async (tx) => {
      // 1. Déplacer le dossier
      await tx.folder.update({
        where: { id },
        data: { parentId: finalParentId, path: newPath }
      });

      // 2. Mettre à jour les chemins des enfants
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
    
    console.log('=== RESTORE FOLDER ===');
    console.log('Folder ID:', id);
    console.log('User ID:', userId);

    const folderToRestore = await prisma.folder.findFirst({
      where: { id, ownerId: userId },
      include: { parent: true } // Include parent to check its status
    });

    if (!folderToRestore) {
      throw ErrorTypes.NotFound("Dossier introuvable ou vous n'avez pas les permissions.");
    }

    if (!folderToRestore.isDeleted) {
      return res.status(400).json({ success: false, message: "Le dossier n'est pas dans la corbeille." });
    }

    // Empêche la restauration si le dossier parent est lui-même dans la corbeille.
    if (folderToRestore.parent && folderToRestore.parent.isDeleted) {
      throw ErrorTypes.BadRequest("Impossible de restaurer ce dossier car son dossier parent est dans la corbeille. Veuillez d'abord restaurer le dossier parent.");
    }

    // Restauration atomique
    await prisma.$transaction(async (tx) => {
      let folderIdsToRestore = [folderToRestore.id];

      // Si le path est disponible, restaurer récursivement tous les sous-dossiers
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

      await tx.folder.updateMany({ where: { id: { in: folderIdsToRestore } }, data: { isDeleted: false } });
      await tx.file.updateMany({ where: { folderId: { in: folderIdsToRestore } }, data: { isDeleted: false } });
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
// PERMANENT DELETE FOLDER (Suppression définitive)
// ============================================
export const deleteFolderPermanently = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    console.log('=== DELETE FOLDER PERMANENTLY ===');
    console.log('Folder ID:', id);
    console.log('User ID:', userId);

    const folder = await prisma.folder.findUnique({
      where: { id }
    });

    if (!folder || folder.ownerId !== userId) {
      throw ErrorTypes.NotFound('Dossier introuvable');
    }

    if (!folder.isDeleted) {
      throw ErrorTypes.BadRequest('Le dossier doit être dans la corbeille pour être supprimé définitivement.');
    }

    // Empêcher la suppression définitive des dossiers par défaut SEULEMENT s'ils sont à la racine
    const isDefaultFolder = DEFAULT_FOLDERS.includes(folder.name) && folder.parentId === null;
    if (isDefaultFolder) {
      console.log(`Preventing permanent deletion of default folder: ${folder.name}`);
      throw ErrorTypes.Forbidden(`Le dossier par défaut "${folder.name}" ne peut pas être supprimé définitivement.`);
    }

    console.log(`Proceeding with permanent deletion of folder: ${folder.name} (parentId: ${folder.parentId})`);

    let totalSize = BigInt(0);

    // Suppression définitive
    await prisma.$transaction(async (tx) => {
      // 1. Trouver tous les dossiers à supprimer (le dossier et ses sous-dossiers)
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
          isDeleted: true,
          folderId: { in: folderIds }
        },
        select: { id: true, storageName: true, size: true }
      });

      // Calculer la taille totale
      for (const file of filesToDelete) {
        totalSize += file.size;
      }

      // 3. Supprimer les fichiers physiques
      for (const file of filesToDelete) {
        try {
          const filePath = path.join(process.cwd(), 'uploads', file.storageName);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted physical file: ${file.storageName}`);
          } else {
            console.log(`Physical file not found, skipping: ${file.storageName}`);
          }
        } catch (error) {
          console.error(`Error deleting physical file ${file.storageName}:`, error.message);
          // Continuer même si un fichier ne peut pas être supprimé physiquement
        }
      }

      // 4. Supprimer les fichiers de la base de données
      await tx.file.deleteMany({
        where: {
          ownerId: userId,
          isDeleted: true,
          folderId: { in: folderIds }
        }
      });

      // 5. Supprimer les dossiers de la base de données
      await tx.folder.deleteMany({
        where: {
          id: { in: folderIds }
        }
      });

      // 6. Mettre à jour le quota de l'utilisateur
      if (totalSize > BigInt(0)) {
        await tx.user.update({
          where: { id: userId },
          data: { storageUsed: { decrement: totalSize } }
        });
      }
    });

    res.status(200).json({
      success: true,
      message: 'Dossier supprimé définitivement'
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
    if (!rootFolder || rootFolder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable");

    if (!rootFolder.path) {
      throw ErrorTypes.InternalError('Chemin du dossier manquant, impossible de générer l\'archive.');
    }

    // 1. Récupérer tous les fichiers et sous-dossiers récursivement
    const folders = await prisma.folder.findMany({
      where: { 
        ownerId: userId,
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

    // 2. Préparer l'archive
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    res.attachment(`${rootFolder.name}.zip`);
    archive.pipe(res);

    // 3. Ajouter les structures de dossiers (pour s'assurer que les dossiers vides sont inclus)
    for (const folder of folders) {
      if (folder.id === rootFolder.id) continue;

      // Calculer le chemin relatif par rapport au dossier racine téléchargé
      const relativePath = folder.path.substring(rootFolder.path.length + 1);
      archive.append(null, { name: relativePath + '/' });
    }

    // 3. Ajouter les fichiers à l'archive en reconstruisant la structure
    for (const file of files) {
      const physicalPath = path.join(process.cwd(), 'uploads', file.storageName);
      
      if (fs.existsSync(physicalPath)) {
        // Trouver le dossier parent de ce fichier pour déterminer son chemin relatif dans le ZIP
        const parentFolder = folders.find(f => f.id === file.folderId);
        let relativePath = file.name;

        if (parentFolder && parentFolder.id !== rootFolder.id) {
          // Calculer le chemin relatif par rapport au dossier racine téléchargé
          // Ex: Root=/A, File=/A/B/file.txt -> relative = B/file.txt
          const folderPart = parentFolder.path.substring(rootFolder.path.length + 1); // +1 pour le slash
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