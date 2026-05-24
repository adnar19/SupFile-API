import prisma from '../lib/prisma.js';
import { ErrorTypes } from '../utils/ApiError.js';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';

// ============================================
// HELPER : Récupération récursive des sous-dossiers par ID
// (Évite d'utiliser startsWith sur le path, plus sûr)
// ============================================
const getSubFolderIds = async (folderId, ownerId) => {
  const allFolderIds = [folderId];
  const queue = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = await prisma.folder.findMany({
      where: { parentId: currentId, ownerId, isDeleted: false },
      select: { id: true }
    });
    for (const child of children) {
      allFolderIds.push(child.id);
      queue.push(child.id);
    }
  }

  return allFolderIds;
};

// ============================================
// PUBLIC LINKS (Génération)
// ============================================
export const createPublicLink = async (req, res, next) => {
  try {
    const { itemId, type, expiresAt, password } = req.body;
    const userId = req.user.id;

    if (!itemId || !['file', 'folder'].includes(type)) {
      throw ErrorTypes.BadRequest("Type ou ID invalide.");
    }

    // Vérification de propriété
    if (type === 'file') {
      const file = await prisma.file.findUnique({ where: { id: itemId } });
      if (!file || file.ownerId !== userId) throw ErrorTypes.NotFound("Fichier introuvable.");
    } else {
      const folder = await prisma.folder.findUnique({ where: { id: itemId } });
      if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable.");
    }

    const token = nanoid(10);
    let passwordHash = null;

    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const shareData = {
      token,
      ownerId: userId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      password: passwordHash,
    };

    if (type === 'file') shareData.fileId = itemId;
    else shareData.folderId = itemId;

    const share = await prisma.publicShare.create({ data: shareData });

    // Générer le lien de partage
    // - link       : URL backend (API + page HTML auto-servie)  -- comportement MOBILE existant
    // - frontendLink : URL frontend SPA si FRONTEND_URL défini  -- apport WEB
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const link = `${backendUrl}/share/public/${token}`;
    const frontendLink = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/share/${token}`
      : null;

    res.status(201).json({
      success: true,
      data: { link, frontendLink, token, expiresAt: share.expiresAt }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PUBLIC LINKS (Suppression / Révocation)
// ============================================
export const deletePublicLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    const share = await prisma.publicShare.findUnique({ where: { token } });

    if (!share) throw ErrorTypes.NotFound("Lien introuvable.");
    if (share.ownerId !== userId) throw ErrorTypes.Forbidden("Vous n'êtes pas propriétaire de ce lien.");

    await prisma.publicShare.delete({ where: { token } });

    res.status(200).json({ success: true, message: "Lien public révoqué avec succès." });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PUBLIC LINKS (Liste des liens d'un utilisateur)
// ============================================
export const getMyPublicLinks = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const shares = await prisma.publicShare.findMany({
      where: { ownerId: userId },
      include: {
        file: { select: { id: true, name: true, mimeType: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = shares.map(s => ({
      id: s.id,
      token: s.token,
      link: `${process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`}/share/public/${s.token}`,
      frontendLink: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/share/${s.token}` : null,
      type: s.fileId ? 'file' : 'folder',
      item: s.fileId ? s.file : s.folder,
      isPasswordProtected: !!s.password,
      expiresAt: s.expiresAt,
      views: s.views,
      createdAt: s.createdAt
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PUBLIC LINKS (Accès & Info)
// ============================================
export const getPublicShareInfo = async (req, res, next) => {
  try {
    const { token } = req.params;
    const share = await prisma.publicShare.findUnique({
      where: { token },
      include: { file: true, folder: true, owner: { select: { fullName: true } } }
    });

    if (!share) throw ErrorTypes.NotFound("Lien invalide ou expiré.");

    // Vérification expiration AVANT tout retour de données
    if (share.expiresAt && new Date() > share.expiresAt) {
      throw ErrorTypes.Forbidden("Ce lien de partage a expiré.");
    }

    const isPasswordProtected = !!share.password;

    // Si c'est un navigateur (Accept: text/html), servir une page HTML
    const acceptHeader = req.headers.accept || '';
    if (acceptHeader.includes('text/html')) {
      const itemName = share.fileId ? share.file.name : share.folder.name;
      const itemType = share.fileId ? 'Fichier' : 'Dossier';
      const itemSize = share.fileId ? formatBytes(Number(share.file.size)) : '';
      const downloadUrl = `/share/public/${token}/download`;
      
      const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SupFile - ${itemName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 40px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    .icon { font-size: 64px; margin-bottom: 20px; }
    h1 { font-size: 20px; color: #1f2937; margin-bottom: 8px; word-break: break-word; }
    .meta { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    .owner { color: #9ca3af; font-size: 12px; margin-bottom: 24px; }
    ${isPasswordProtected ? `
    .password-form { margin-bottom: 20px; }
    .password-input { width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; margin-bottom: 12px; }
    .password-input:focus { outline: none; border-color: #667eea; }
    ` : ''}
    .download-btn { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; border: none; cursor: pointer; width: 100%; }
    .download-btn:hover { opacity: 0.9; }
    .error { color: #ef4444; font-size: 14px; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${share.fileId ? '📄' : '📁'}</div>
    <h1>${itemName}</h1>
    <p class="meta">${itemType}${itemSize ? ' • ' + itemSize : ''}</p>
    <p class="owner">Partagé par ${share.owner.fullName}</p>
    ${isPasswordProtected ? `
    <form class="password-form" onsubmit="download(event)">
      <input type="password" id="password" class="password-input" placeholder="Mot de passe requis" required>
      <button type="submit" class="download-btn">Télécharger</button>
      <p class="error" id="error"></p>
    </form>
    <script>
      async function download(e) {
        e.preventDefault();
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('error');
        errorEl.style.display = 'none';
        try {
          const res = await fetch('${downloadUrl}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.message || 'Erreur');
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = '${itemName}';
          a.click();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.style.display = 'block';
        }
      }
    </script>
    ` : `
    <button class="download-btn" onclick="downloadFile()">Télécharger</button>
    <p class="error" id="error"></p>
    <script>
      async function downloadFile() {
        const errorEl = document.getElementById('error');
        errorEl.style.display = 'none';
        try {
          const res = await fetch('${downloadUrl}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.message || 'Erreur');
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = '${itemName}';
          a.click();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.style.display = 'block';
        }
      }
    </script>
    `}
  </div>
</body>
</html>`;
      return res.type('html').send(html);
    }

    // Sinon, retourner du JSON pour l'API
    if (isPasswordProtected) {
      return res.status(200).json({
        success: true,
        data: {
          isPasswordProtected: true,
          owner: share.owner.fullName
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        isPasswordProtected: false,
        type: share.fileId ? 'file' : 'folder',
        item: share.fileId
          ? { ...share.file, size: share.file.size.toString() }
          : share.folder,
        owner: share.owner.fullName
      }
    });
  } catch (error) {
    next(error);
  }
};

// Helper pour formater les bytes
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// ============================================
// PUBLIC LINKS (Téléchargement avec mot de passe)
// ============================================
export const accessPublicShare = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const share = await prisma.publicShare.findUnique({
      where: { token },
      include: { file: true, folder: true }
    });

    if (!share) throw ErrorTypes.NotFound("Lien introuvable.");
    if (share.expiresAt && new Date() > share.expiresAt) throw ErrorTypes.Forbidden("Lien expiré.");

    // Vérification mot de passe
    if (share.password) {
      if (!password) throw ErrorTypes.Unauthorized("Mot de passe requis.");
      const match = await bcrypt.compare(password, share.password);
      if (!match) throw ErrorTypes.Unauthorized("Mot de passe incorrect.");
    }

    // Incrémenter les vues
    await prisma.publicShare.update({ where: { id: share.id }, data: { views: { increment: 1 } } });

    if (share.fileId) {
      const filePath = path.join(process.cwd(), 'uploads', share.file.storageName);
      if (!fs.existsSync(filePath)) throw ErrorTypes.NotFound("Fichier physique introuvable.");
      res.download(filePath, share.file.name);

    } else if (share.folderId) {
      const folder = share.folder;

      // CORRECTION : Récupération récursive par ID (plus sûre que startsWith sur le path)
      const folderIds = await getSubFolderIds(folder.id, share.ownerId);
      const subFolders = await prisma.folder.findMany({
        where: { id: { in: folderIds }, isDeleted: false }
      });

      const files = await prisma.file.findMany({
        where: { folderId: { in: folderIds }, isDeleted: false }
      });

      const archive = archiver('zip', { zlib: { level: 9 } });
      res.attachment(`${folder.name}.zip`);
      archive.pipe(res);

      for (const f of files) {
        const pPath = path.join(process.cwd(), 'uploads', f.storageName);
        if (fs.existsSync(pPath)) {
          const parentF = subFolders.find(sf => sf.id === f.folderId);
          let relativePath = f.name;
          if (parentF && parentF.id !== folder.id) {
            relativePath = path.join(parentF.path.substring(folder.path.length + 1), f.name);
          }
          archive.file(pPath, { name: relativePath });
        }
      }
      await archive.finalize();
    }

  } catch (error) {
    next(error);
  }
};

// ============================================
// INTERNAL SHARING (Partager un fichier)
// ============================================
export const shareFileInternal = async (req, res, next) => {
  try {
    const { fileId, email, permission = 'READ' } = req.body;
    const userId = req.user.id;

    if (!email || !fileId) throw ErrorTypes.BadRequest("Email et fichier requis.");

    // Validation de la valeur de permission
    if (!['READ', 'WRITE'].includes(permission)) {
      throw ErrorTypes.BadRequest("Permission invalide. Valeurs acceptées : READ, WRITE.");
    }

    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.ownerId !== userId) throw ErrorTypes.NotFound("Fichier introuvable.");

    const recipient = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!recipient) throw ErrorTypes.NotFound("Utilisateur destinataire introuvable.");

    if (recipient.id === userId) throw ErrorTypes.BadRequest("Vous ne pouvez pas partager avec vous-même.");

    // Vérifier si déjà partagé
    const existingShare = await prisma.internalShare.findUnique({
      where: { fileId_sharedWithId: { fileId, sharedWithId: recipient.id } }
    });

    if (existingShare) {
      if (existingShare.permission !== permission) {
        await prisma.internalShare.update({
          where: { id: existingShare.id },
          data: { permission }
        });
        return res.status(200).json({
          success: true,
          message: `Permission mise à jour en ${permission} pour ${recipient.fullName || recipient.email}.`
        });
      }
      return res.status(200).json({ success: true, message: "Déjà partagé avec cet utilisateur avec la même permission." });
    }

    await prisma.internalShare.create({
      data: {
        fileId,
        sharedById: userId,
        sharedWithId: recipient.id,
        permission
      }
    });

    res.status(201).json({
      success: true,
      message: `Fichier partagé avec ${recipient.fullName || recipient.email} (${permission})`
    });

  } catch (error) {
    next(error);
  }
};

// ============================================
// INTERNAL SHARING (Partager un dossier)
// ============================================
// Polymorphe : accepte
//   - {folderId, email, permission}                  (signature MOBILE / legacy)
//   - {itemId, type:'file'|'folder', email, permission} (signature WEB unifiée)
// Si type === 'file' on délègue à shareFileInternal pour ne pas dupliquer la logique.
export const shareFolderInternal = async (req, res, next) => {
  try {
    const { folderId: legacyFolderId, itemId, type, email, permission = 'READ' } = req.body;
    const userId = req.user.id;

    // Délégation au handler fichier si la signature web indique un fichier
    if (type === 'file' && itemId) {
      req.body.fileId = itemId;
      return shareFileInternal(req, res, next);
    }

    const folderId = legacyFolderId || (type === 'folder' ? itemId : null) || itemId;

    if (!email || !folderId) throw ErrorTypes.BadRequest("Email et dossier requis.");

    if (!['READ', 'WRITE'].includes(permission)) {
      throw ErrorTypes.BadRequest("Permission invalide. Valeurs acceptées : READ, WRITE.");
    }

    const folder = await prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable.");

    const recipient = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!recipient) throw ErrorTypes.NotFound("Utilisateur destinataire introuvable.");

    if (recipient.id === userId) throw ErrorTypes.BadRequest("Vous ne pouvez pas partager avec vous-même.");

    const existingShare = await prisma.internalShare.findUnique({
      where: { folderId_sharedWithId: { folderId, sharedWithId: recipient.id } }
    });

    if (existingShare) {
      if (existingShare.permission !== permission) {
        await prisma.internalShare.update({
          where: { id: existingShare.id },
          data: { permission }
        });
        return res.status(200).json({
          success: true,
          message: `Permission mise à jour en ${permission} pour ${recipient.fullName || recipient.email}.`
        });
      }
      return res.status(200).json({ success: true, message: "Déjà partagé avec cet utilisateur avec la même permission." });
    }

    await prisma.internalShare.create({
      data: {
        folderId,
        sharedById: userId,
        sharedWithId: recipient.id,
        permission
      }
    });

    res.status(201).json({
      success: true,
      message: `Dossier partagé avec ${recipient.fullName || recipient.email} (${permission})`
    });

  } catch (error) {
    next(error);
  }
};

// ============================================
// INTERNAL SHARING (Liste des collaborateurs d'un dossier)
// ============================================
// Le param :folderId est conservé pour back-compat MOBILE.
// Query optionnelle ?type=file (apport WEB) → liste les partages d'un fichier au lieu d'un dossier.
export const getFolderShares = async (req, res, next) => {
  try {
    const { folderId: itemId } = req.params; // peut être en réalité un fileId si ?type=file
    const { type = 'folder' } = req.query;
    const userId = req.user.id;

    if (type === 'file') {
      const file = await prisma.file.findUnique({ where: { id: itemId } });
      if (!file || file.ownerId !== userId) throw ErrorTypes.NotFound("Fichier introuvable.");
    } else {
      const folder = await prisma.folder.findUnique({ where: { id: itemId } });
      if (!folder || folder.ownerId !== userId) throw ErrorTypes.NotFound("Dossier introuvable.");
    }

    const shares = await prisma.internalShare.findMany({
      where: type === 'file' ? { fileId: itemId } : { folderId: itemId },
      include: {
        sharedWith: { select: { id: true, email: true, fullName: true, avatarUrl: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    const formatted = shares.map(s => ({
      shareId: s.id,
      user: s.sharedWith,
      permission: s.permission,
      sharedAt: s.createdAt
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

// ============================================
// REMOVE INTERNAL SHARE (Arrêter le partage)
// ============================================
// Polymorphe : accepte
//   - {folderId, email}                       (signature MOBILE / legacy)
//   - {itemId, type:'file'|'folder', email}   (signature WEB unifiée)
export const removeInternalShare = async (req, res, next) => {
  try {
    const { folderId: legacyFolderId, itemId, type, email } = req.body;
    const userId = req.user.id;

    if (!email) throw ErrorTypes.BadRequest("Email de l'utilisateur requis.");

    // Déterminer la cible (file ou folder)
    let targetFileId = null;
    let targetFolderId = null;
    if (type === 'file') {
      targetFileId = itemId;
    } else if (type === 'folder') {
      targetFolderId = itemId;
    } else {
      targetFolderId = legacyFolderId || itemId;
    }

    if (!targetFileId && !targetFolderId) {
      throw ErrorTypes.BadRequest("ID de l'élément requis.");
    }

    const recipient = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!recipient) throw ErrorTypes.NotFound("Utilisateur introuvable.");

    const share = await prisma.internalShare.findFirst({
      where: {
        sharedWithId: recipient.id,
        ...(targetFileId ? { fileId: targetFileId } : { folderId: targetFolderId })
      }
    });

    if (!share) throw ErrorTypes.NotFound("Ce partage n'existe pas.");
    if (share.sharedById !== userId) throw ErrorTypes.Forbidden("Vous n'êtes pas l'auteur de ce partage.");

    await prisma.internalShare.delete({ where: { id: share.id } });

    res.status(200).json({ success: true, message: `Accès révoqué pour ${recipient.email}` });
  } catch (error) {
    next(error);
  }
};

// ============================================
// LIST SHARED WITH ME
// ============================================
export const getSharedWithMe = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Récupérer les dossiers partagés
    const folderShares = await prisma.internalShare.findMany({
      where: {
        sharedWithId: userId,
        folderId: { not: null },
        folder: { isDeleted: false }
      },
      include: {
        folder: true,
        sharedBy: { select: { fullName: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Récupérer les fichiers partagés
    const fileShares = await prisma.internalShare.findMany({
      where: {
        sharedWithId: userId,
        fileId: { not: null },
        file: { isDeleted: false }
      },
      include: {
        file: true,
        sharedBy: { select: { fullName: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedFolders = folderShares.map(share => ({
      id: share.id,
      itemId: share.folder.id,
      type: 'folder',
      item: share.folder,
      sharedBy: share.sharedBy,
      sharedAt: share.createdAt,
      isShared: true,
      permission: share.permission
    }));

    const formattedFiles = fileShares.map(share => ({
      id: share.id,
      itemId: share.file.id,
      type: 'file',
      item: { ...share.file, size: share.file.size.toString() },
      sharedBy: share.sharedBy,
      sharedAt: share.createdAt,
      isShared: true,
      permission: share.permission
    }));

    res.status(200).json({ success: true, data: [...formattedFolders, ...formattedFiles] });
  } catch (error) {
    next(error);
  }
};