# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Development server (with hot reload)
npm run dev

# Production build
npm run build

# Start production server
npm start

# Linting
npm run lint

# Type checking
npm run typecheck

# Database commands
npm run db:generate   # Generate Prisma client
npm run db:migrate    # Run migrations
npm run db:push       # Push schema to database
npm run db:seed       # Seed with sample data
npm run db:studio     # Open Prisma Studio GUI
```

## Architecture Overview

ConnectVerse Backend is an Express.js REST API with TypeScript, using Prisma ORM for MySQL database access and JWT for authentication.

### Key Directories

- `src/` - Source code
- `src/routes/` - Express route handlers (one file per API domain)
- `src/middleware/` - Express middleware (auth, etc.)
- `src/index.ts` - Application entry point
- `prisma/` - Prisma schema and seed script

### API Structure

Routes are organized by domain and mounted at `/api`:
- `/api/auth` - Authentication (register, login, profile)
- `/api/dashboard` - Dashboard statistics and trends
- `/api/customers` - Customer CRUD and status management
- `/api/conversations` - Messaging and conversations
- `/api/emails` - Email management
- `/api/integrations` - Channel integrations (WhatsApp, Messenger, etc.)
- `/api/settings` - Business settings
- `/api/status` - Service status and update logs
- `/api/support` - Support chat
- `/api/faq` - FAQ content

### Database Schema

Key models in `prisma/schema.prisma`:
- `User` - Application users with JWT auth
- `Customer` - Customer profiles with status funnel
- `Conversation` / `Message` - Messaging system
- `Deal` - Sales deals linked to customers
- `Integration` - Channel connection status
- `Email` - Email management

### Authentication

JWT-based authentication via `src/middleware/auth.ts`:
- `authenticateToken` - Required auth middleware
- `optionalAuth` - Optional auth middleware
- Tokens expire based on `JWT_EXPIRES_IN` env var

### Environment Variables

Required in `.env`:
- `DATABASE_URL` - MySQL connection string
- `JWT_SECRET` - Secret for JWT signing
- `PORT` - Server port (default: 3001)
- `CORS_ORIGIN` - Frontend URL for CORS
