import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import setupSwagger from './utils/swagger.js';
import cors from 'cors';
import prisma ,{ disconnectPrisma} from './lib/prisma.js';
const app = express();
const PORT = 3000;
const server = http.createServer(app);

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
// CORS
// app.use(cors({
//   origin: process.env.FRONTEND_URL || 'http://localhost:3000',
//   credentials: true
// }));

// ============================================
// TEST DE CONNEXION DATABASE
// ============================================

const DatabaseConnection = async () => {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1); 
  }
};

// server listen
server.listen(PORT, async () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  try{
     await DatabaseConnection();
    setupSwagger(app, PORT);
    console.info(`ℹ️ Swagger documentation available at http://localhost:${PORT}/docs`);
  }catch(error){
    console.error('❌ Unable to connect to the database:', error);
  }
  
});

// Middleware handling  Errors
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  return res.status(statusCode).json({
    success: false,
    statusCode: statusCode,
    message: message,
  });
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('\n📛 Received shutdown signal, closing server gracefully...');
  
  // Fermer le serveur HTTP
  server.close(async () => {
    console.log('✅ HTTP server closed');
    
    // Déconnecter Prisma
    await disconnectPrisma();
    
    console.log('👋 Goodbye!');
    process.exit(0);
  });

  // Force shutdown après 10 secondes
  setTimeout(() => {
    console.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown();
});