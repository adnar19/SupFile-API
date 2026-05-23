const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUsers() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        emailVerified: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 3
    });
    console.log('Users in database:');
    console.log(JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
