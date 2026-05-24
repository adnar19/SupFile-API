import dotenv from 'dotenv';
dotenv.config({ path: new URL('.env', import.meta.url).pathname, override: true });

import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import setupSwagger from './utils/swagger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cors from 'cors';
import prisma, { disconnectPrisma } from './lib/prisma.js';
import AuthRouter from './routes/auth.route.js';
import FileRouter from './routes/files.route.js';
import FolderRouter from './routes/folder.route.js';
import UserRouter from './routes/user.route.js';
import DashboardRouter from './routes/dashboard.route.js';
import SharingRouter from './routes/sharing.route.js';
import FavoriteRouter from './routes/favorite.route.js';
import { apiLimiter } from './middlewares/rateLimit.middleware.js';
import { startCronJobs } from './utils/cron.js';

BigInt.prototype.toJSON = function () {
  return this.toString();
};

const app = express();


app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
if (process.env.NODE_ENV === 'production' && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    console.error(`❌ CRITICAL: Firebase Service Account file not found at ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
  } else {
    console.log('✅ Firebase Service Account file verified');
  }
}

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://localhost:8081',
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    const isAllowed = !origin ||
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin.endsWith('.onrender.com');
    callback(null, isAllowed ? origin : false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

// Preflight explicite pour toutes les routes
app.options(/(.*)/,  cors(corsOptions));
app.use(cors(corsOptions));

app.use(apiLimiter);

// MIDDLEWARES
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

app.use('/public', express.static(path.join(__dirname, 'public')));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
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

// SWAGGER - doit être avant le 404 handler
setupSwagger(app, PORT);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    statusCode: 404,
    message: `Route introuvable: ${req.method} ${req.originalUrl}`
  });
});

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
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
  }
});

// 404 handler - retourne du JSON au lieu de HTML
app.use((req, res) => {
  res.status(404).json({
    success: false,
    statusCode: 404,
    message: `Route introuvable: ${req.method} ${req.originalUrl}`
  });
});

// ERROR HANDLING
app.use((err, req, res, next) => {
  // Log détaillé pour voir la cause exacte des crash 500  -- apport WEB
  if (process.env.NODE_ENV !== 'test') {
    console.error('--- EXCEPTION DETECTED ---');
    console.error(err.stack || err);
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  return res.status(statusCode).json({
    success: false,
    statusCode: statusCode,
    message: message,
  });
});

const gracefulShutdown = async () => {
  console.log('\n📛 Received shutdown signal...');
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
