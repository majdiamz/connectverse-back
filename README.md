# ConnectVerse Backend

Backend API for ConnectVerse, a unified messaging platform for modern teams.

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js with TypeScript
- **Database**: MySQL with Prisma ORM
- **Authentication**: JWT

## Prerequisites

- Node.js 18 or higher
- MySQL 8.0 or higher
- npm or yarn

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example environment file and update with your settings:

```bash
cp .env.example .env
```

Update the `.env` file with your MySQL connection string:

```
DATABASE_URL="mysql://user:password@localhost:3306/connectverse"
JWT_SECRET="your-secret-key"
```

### 3. Set up the database

Generate Prisma client and push schema to database:

```bash
npm run db:generate
npm run db:push
```

### 4. Seed the database (optional)

Populate the database with sample data:

```bash
npm run db:seed
```

### 5. Start the development server

```bash
npm run dev
```

The API will be available at `http://localhost:3001/api`

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run database migrations |
| `npm run db:push` | Push schema to database |
| `npm run db:seed` | Seed database with sample data |
| `npm run db:studio` | Open Prisma Studio |

## API Documentation

The API follows the OpenAPI 3.0 specification. See `openapi.yaml` for the full API documentation.

### Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <token>
```

### Default User (after seeding)

- **Email**: alex.green@example.com
- **Password**: password123

## Project Structure

```
connectverse-back/
├── prisma/
│   ├── schema.prisma    # Database schema
│   └── seed.ts          # Seed script
├── src/
│   ├── middleware/      # Express middleware
│   │   └── auth.ts      # JWT authentication
│   ├── routes/          # API routes
│   │   ├── auth.ts
│   │   ├── customers.ts
│   │   ├── conversations.ts
│   │   ├── dashboard.ts
│   │   ├── emails.ts
│   │   ├── faq.ts
│   │   ├── integrations.ts
│   │   ├── settings.ts
│   │   ├── status.ts
│   │   └── support.ts
│   └── index.ts         # Express app entry point
├── .env.example
├── openapi.yaml
├── package.json
└── tsconfig.json
```

## License

MIT
