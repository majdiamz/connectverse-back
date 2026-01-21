import { PrismaClient } from '@prisma/client';
import { seedDatabase } from '../src/seed.js';

const prisma = new PrismaClient();

// Run seed when executed directly (npm run db:seed)
seedDatabase(prisma)
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
