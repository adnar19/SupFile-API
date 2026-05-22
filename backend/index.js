import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import setupSwagger from './utils/swagger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import prisma ,{ disconnectPrisma} from './lib/prisma.js';
import AuthRouter from './routes/auth.route.js';
import FileRouter from './routes/files.route.js'; 
import FolderRouter from './routes/folder.route.js';
import UserRouter from './routes/user.route.js'
import DashboardRouter from './routes/dashboard.route.js';
import SharingRouter from './routes/sharing.route.js';
import FavoriteRouter from './routes/favorite.route.js';
import { apiLimiter } from './middlewares/rateLimit.middleware.js';
import { startCronJobs } from './utils/cron.js';

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Pour utiliser __dirname avec les modules ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    // On vérifie si l'origine est autorisée ou si c'est une requête locale (origin undefined)
    const isAllowed = !origin || allowedOrigins.some(allowed => 
      allowed && origin.startsWith(allowed.replace(/\/$/, ''))
    );
    
    if (isAllowed) {
      callback(null, true);
    } else {
      // On renvoie false au lieu d'une Error pour éviter un crash 500 sur le Preflight
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
}));

// Rate Limiting - Après CORS
app.use(apiLimiter);

// MIDDLEWARES
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers statiques (avatars par défaut, etc.) depuis le dossier 'public'
app.use('/public', express.static(path.join(__dirname, 'public')));

// Security Headers for Google Auth for the login popup 
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});

// ROUTES
app.use('/auth', AuthRouter);
app.use('/folders', FolderRouter);
app.use('/files', FileRouter); 
app.use('/users', UserRouter);
app.use('/dashboard', DashboardRouter);
app.use('/share', SharingRouter);
app.use('/favorites', FavoriteRouter);

// DATABASE CONNECTION
startCronJobs();
const DatabaseConnection = async () => {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1); 
  }
};

// SERVER LISTEN
server.listen(PORT, async () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  try {
     await DatabaseConnection();
    setupSwagger(app, PORT);
    console.info(`ℹ️ Swagger documentation available at http://localhost:${PORT}/docs`);
  } catch(error) {
    console.error('❌ Unable to connect to the database:', error);
  }
});

// ERROR HANDLING
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  return res.status(statusCode).json({
    success: false,
    statusCode: statusCode,
    message: message,
  });
});

// GRACEFUL SHUTDOWN
const gracefulShutdown = async () => {
  console.log('\n📛 Received shutdown signal...');
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);