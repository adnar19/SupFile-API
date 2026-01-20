import { PrismaClient } from '../generated/prisma/index.js';

// PrismaClient Singleton pour éviter les connexions multiples
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? ['query', 'error', 'warn'] 
      : ['error'],
  });
};

// Empêcher les instances multiples en développement (hot reload)
const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Déconnexion gracieuse de Prisma
 */
export const disconnectPrisma = async () => {
  await prisma.$disconnect();
  console.log('✅ Prisma client disconnected');
};

export default prisma;