import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Créer les dossiers d'upload s'ils n'existent pas
const uploadDirs = ['uploads', 'uploads/profiles', 'uploads/documents', 'uploads/images', 'uploads/videos', 'uploads/audio'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configuration du stockage pour les fichiers généraux
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Configuration du stockage pour les avatars
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/profiles/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Filtre pour tous les types de fichiers courants
const fileFilter = (req, file, cb) => {
  // Accepter tous les types de fichiers courants
  const allowedMimeTypes = [
    // Documents
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/json', 'application/xml',
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/heic', 'image/heif',
    // Vidéos
    'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska',
    // Audio
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm', 'audio/flac', 'audio/aac',
    // Archives
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/gzip'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    cb(null, true); // Accepter tous les fichiers pour le moment
  }
};

// Filtre pour les images uniquement (avatars)
const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Seules les images sont acceptées pour l\'avatar'), false);
  }
};

// Upload général (limite 100 Mo)
export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Upload avatar (limite 5 Mo)
export const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});