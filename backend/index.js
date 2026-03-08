import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import setupSwagger from './utils/swagger.js';
import cors from 'cors';
import prisma ,{ disconnectPrisma} from './lib/prisma.js';
import AuthRouter from './routes/auth.route.js';
import FileRouter from './routes/files.route.js'; 
import FolderRouter from './routes/folder.route.js';
import { startCronJobs } from './utils/cron.js';

const app = express();
const PORT = 3000;
const server = http.createServer(app);

// MIDDLEWARES
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use(cors({
  origin: true, 
  credentials: true, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Security Headers for Google Auth for the login popup 
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});

// ROUTES
app.use('/auth', AuthRouter);
app.use('/folders', FolderRouter);
app.use('/files', FileRouter); 

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