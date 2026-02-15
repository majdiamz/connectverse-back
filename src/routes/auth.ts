import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Generate a slug from company name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50) + '-' + Date.now().toString(36);
}

// Register
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('name').trim().notEmpty(),
    body('companyName').optional().trim().notEmpty(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, password, name, companyName } = req.body;

    try {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        res.status(400).json({ error: 'Email already registered' });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Create a new customer (tenant) for the user
      const customerName = companyName || `${name}'s Organization`;
      const customer = await prisma.customer.create({
        data: {
          name: customerName,
          slug: generateSlug(customerName),
        },
      });

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          avatarUrl: `https://picsum.photos/seed/${Date.now()}/100/100`,
          customerId: customer.id,
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          customerId: true,
          role: true,
        },
      });

      const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
      );

      res.status(201).json({ user, token });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Failed to register user' });
    }
  }
);

// Login
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, password } = req.body;

    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const token = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
      );

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          customerId: user.customerId,
          role: user.role,
        },
        token,
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Failed to login' });
    }
  }
);

// Get current user
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        customerId: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update profile
router.put(
  '/me',
  authenticateToken,
  [
    body('name').optional().trim().notEmpty(),
    body('avatarUrl').optional().isURL(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { name, avatarUrl } = req.body;

    try {
      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          ...(name && { name }),
          ...(avatarUrl && { avatarUrl }),
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          customerId: true,
          role: true,
        },
      });

      res.json(user);
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

export default router;
