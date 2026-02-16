import express from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import customerRoutes from './routes/customers.js';
import conversationRoutes from './routes/conversations.js';
import emailRoutes from './routes/emails.js';
import integrationRoutes from './routes/integrations.js';
import settingsRoutes from './routes/settings.js';
import statusRoutes from './routes/status.js';
import supportRoutes from './routes/support.js';
import faqRoutes from './routes/faq.js';
import adminRoutes from './routes/admin.js';
import messengerWebhookRoutes from './routes/webhooks/messenger.js';

// Import middleware
import { preserveRawBody } from './middleware/facebookWebhook.js';

// Import seed function
import { seedDatabase } from './seed.js';

// Import WhatsApp service
import { reconnectAllSessions, disconnectAllSessions } from './services/whatsapp.js';

// Initialize Prisma client
export const prisma = new PrismaClient();

// Create Express app
const app = express();

// Enable gzip compression for all responses
app.use(compression());

// CORS configuration - allow all origins
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(cookieParser());

// Webhook routes need raw body for signature validation - must be before express.json()
app.use('/webhooks/messenger', express.json({ verify: preserveRawBody }), messengerWebhookRoutes);

// JSON parsing for all other routes
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/faq', faqRoutes);
app.use('/api/admin', adminRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Start server
const PORT = process.env.PORT || 3001;

async function main() {
  try {
    // Auto-setup database if AUTO_SEED environment variable is set
    if (process.env.AUTO_SEED === 'true') {
      console.log('AUTO_SEED enabled, pushing database schema...');
      execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
      console.log('Database schema pushed successfully');
    }

    await prisma.$connect();
    console.log('Connected to database');

    // Seed database after schema is ready
    if (process.env.AUTO_SEED === 'true') {
      console.log('Seeding database...');
      await seedDatabase(prisma);
    }

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`API available at http://localhost:${PORT}/api`);

      // Reconnect WhatsApp sessions after server starts
      reconnectAllSessions(prisma).catch((err) =>
        console.error('Failed to reconnect WhatsApp sessions:', err)
      );
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await disconnectAllSessions();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await disconnectAllSessions();
  await prisma.$disconnect();
  process.exit(0);
});

main();
