import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../index.js';
import { AuthRequest, authenticateToken, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

// All routes require super admin
router.use(authenticateToken, requireSuperAdmin);

// ==================== Organization Management ====================

// GET /organizations — List all organizations with user count
router.get('/organizations', async (req: AuthRequest, res: Response) => {
  try {
    const organizations = await prisma.customer.findMany({
      include: {
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = organizations.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      userCount: org._count.users,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// POST /organizations — Create a new organization
router.post('/organizations', async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ error: 'Organization name is required (min 2 characters)' });
      return;
    }

    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Check for slug uniqueness
    const existing = await prisma.customer.findUnique({ where: { slug } });
    if (existing) {
      res.status(409).json({ error: 'An organization with a similar name already exists' });
      return;
    }

    const org = await prisma.customer.create({
      data: { name: name.trim(), slug },
    });

    res.status(201).json({ ...org, userCount: 0 });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

// PUT /organizations/:id — Update organization name
router.put('/organizations/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ error: 'Organization name is required (min 2 characters)' });
      return;
    }

    const org = await prisma.customer.update({
      where: { id },
      data: { name: name.trim() },
    });

    res.json(org);
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// DELETE /organizations/:id — Delete organization
router.delete('/organizations/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.customer.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

// ==================== User Management ====================

// GET /organizations/:orgId/users — List users in an organization
router.get('/organizations/:orgId/users', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.params.orgId as string;
    const users = await prisma.user.findMany({
      where: { customerId: orgId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /organizations/:orgId/users — Create user in organization
router.post('/organizations/:orgId/users', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.params.orgId as string;
    const { name, email, role } = req.body;

    if (!name || !email) {
      res.status(400).json({ error: 'Name and email are required' });
      return;
    }

    if (role && !['admin', 'commercial'].includes(role)) {
      res.status(400).json({ error: 'Role must be admin or commercial' });
      return;
    }

    // Verify org exists
    const org = await prisma.customer.findUnique({ where: { id: orgId } });
    if (!org) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    // Check email uniqueness
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash('password123', 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || 'admin',
        customerId: orgId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /users/:id — Update user
router.put('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, email, role } = req.body;

    if (role && !['admin', 'commercial'].includes(role)) {
      res.status(400).json({ error: 'Role must be admin or commercial' });
      return;
    }

    const data: Record<string, string> = {};
    if (name) data.name = name;
    if (email) data.email = email;
    if (role) data.role = role;

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /users/:id — Delete user
router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    // Prevent deleting super admins
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (user.role === 'super_admin') {
      res.status(403).json({ error: 'Cannot delete a super admin user' });
      return;
    }

    await prisma.user.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
