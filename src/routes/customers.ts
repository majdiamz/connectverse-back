import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';

const router = Router();

// List Customers
router.get(
  '/',
  authenticateToken,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().isString(),
    query('source').optional().isIn(['whatsapp', 'messenger', 'instagram', 'tiktok']),
    query('status').optional().isIn(['new', 'contacted', 'qualified', 'unqualified', 'demo', 'won']),
    query('tag').optional().isString(),
    query('dateFrom').optional().isISO8601(),
    query('dateTo').optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const page = (req.query.page as unknown as number) || 1;
    const limit = (req.query.limit as unknown as number) || 10;
    const { search, source, status, tag, dateFrom, dateTo } = req.query;

    try {
      const where: Prisma.CustomerWhereInput = {};

      if (search) {
        where.OR = [
          { name: { contains: search as string } },
          { email: { contains: search as string } },
          { phone: { contains: search as string } },
        ];
      }
      if (source) where.channel = source as any;
      if (status) where.status = status as any;
      if (tag) {
        where.tags = {
          some: { name: tag as string },
        };
      }
      if (dateFrom || dateTo) {
        where.joined = {};
        if (dateFrom) where.joined.gte = new Date(dateFrom as string);
        if (dateTo) where.joined.lte = new Date(dateTo as string);
      }

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            tags: true,
            deals: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.customer.count({ where }),
      ]);

      const formattedCustomers = customers.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        avatarUrl: c.avatarUrl,
        joined: c.joined.toISOString().split('T')[0],
        tags: c.tags.map((t) => t.name),
        channel: c.channel,
        status: c.status,
        dealName: c.dealName,
        dealHistory: c.deals.map((d) => ({
          id: d.id,
          name: d.name,
          status: d.status === 'InProgress' ? 'In Progress' : d.status,
          amount: d.amount,
          closeDate: d.closeDate?.toISOString().split('T')[0] || null,
        })),
      }));

      res.json({
        customers: formattedCustomers,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      });
    } catch (error) {
      console.error('List customers error:', error);
      res.status(500).json({ error: 'Failed to list customers' });
    }
  }
);

// Create Customer
router.post(
  '/',
  authenticateToken,
  [
    body('name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('phone').optional().trim(),
    body('channel').isIn(['whatsapp', 'messenger', 'instagram', 'tiktok']),
    body('status').isIn(['new', 'contacted', 'qualified', 'unqualified', 'demo', 'won']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { name, email, phone, channel, status } = req.body;

    try {
      const customer = await prisma.customer.create({
        data: {
          name,
          email,
          phone,
          channel,
          status,
          avatarUrl: `https://picsum.photos/seed/${Date.now()}/100/100`,
        },
        include: {
          tags: true,
          deals: true,
        },
      });

      // Create a conversation for the new customer
      await prisma.conversation.create({
        data: {
          channel: customer.channel,
          customerId: customer.id,
        },
      });

      res.status(201).json({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        avatarUrl: customer.avatarUrl,
        joined: customer.joined.toISOString().split('T')[0],
        tags: customer.tags.map((t) => t.name),
        channel: customer.channel,
        status: customer.status,
        dealName: customer.dealName,
        dealHistory: [],
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        res.status(400).json({ error: 'Email already exists' });
        return;
      }
      console.error('Create customer error:', error);
      res.status(500).json({ error: 'Failed to create customer' });
    }
  }
);

// Get Customer by ID
router.get(
  '/:customerId',
  authenticateToken,
  [param('customerId').isUUID()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const customerId = req.params.customerId as string;

    try {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          tags: true,
          deals: true,
        },
      });

      if (!customer) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }

      res.json({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        avatarUrl: customer.avatarUrl,
        joined: customer.joined.toISOString().split('T')[0],
        tags: customer.tags.map((t: { name: string }) => t.name),
        channel: customer.channel,
        status: customer.status,
        dealName: customer.dealName,
        dealHistory: customer.deals.map((d: { id: string; name: string; status: string; amount: number; closeDate: Date | null }) => ({
          id: d.id,
          name: d.name,
          status: d.status === 'InProgress' ? 'In Progress' : d.status,
          amount: d.amount,
          closeDate: d.closeDate?.toISOString().split('T')[0] || null,
        })),
      });
    } catch (error) {
      console.error('Get customer error:', error);
      res.status(500).json({ error: 'Failed to get customer' });
    }
  }
);

// Update Customer
router.put(
  '/:customerId',
  authenticateToken,
  [
    param('customerId').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('email').optional().isEmail().normalizeEmail(),
    body('phone').optional().trim(),
    body('channel').optional().isIn(['whatsapp', 'messenger', 'instagram', 'tiktok']),
    body('status').optional().isIn(['new', 'contacted', 'qualified', 'unqualified', 'demo', 'won']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const customerId = req.params.customerId as string;
    const { name, email, phone, channel, status } = req.body;

    try {
      const customer = await prisma.customer.update({
        where: { id: customerId },
        data: {
          ...(name && { name }),
          ...(email && { email }),
          ...(phone !== undefined && { phone }),
          ...(channel && { channel }),
          ...(status && { status }),
        },
        include: {
          tags: true,
          deals: true,
        },
      });

      res.json({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        avatarUrl: customer.avatarUrl,
        joined: customer.joined.toISOString().split('T')[0],
        tags: customer.tags.map((t: { name: string }) => t.name),
        channel: customer.channel,
        status: customer.status,
        dealName: customer.dealName,
        dealHistory: customer.deals.map((d: { id: string; name: string; status: string; amount: number; closeDate: Date | null }) => ({
          id: d.id,
          name: d.name,
          status: d.status === 'InProgress' ? 'In Progress' : d.status,
          amount: d.amount,
          closeDate: d.closeDate?.toISOString().split('T')[0] || null,
        })),
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }
      console.error('Update customer error:', error);
      res.status(500).json({ error: 'Failed to update customer' });
    }
  }
);

// Update Customer Status
router.put(
  '/:customerId/status',
  authenticateToken,
  [
    param('customerId').isUUID(),
    body('status').isIn(['new', 'contacted', 'qualified', 'unqualified', 'demo', 'won']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const customerId = req.params.customerId as string;

    try {
      const customer = await prisma.customer.update({
        where: { id: customerId },
        data: { status: req.body.status },
        include: {
          tags: true,
          deals: true,
        },
      });

      res.json({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        avatarUrl: customer.avatarUrl,
        joined: customer.joined.toISOString().split('T')[0],
        tags: customer.tags.map((t: { name: string }) => t.name),
        channel: customer.channel,
        status: customer.status,
        dealName: customer.dealName,
        dealHistory: customer.deals.map((d: { id: string; name: string; status: string; amount: number; closeDate: Date | null }) => ({
          id: d.id,
          name: d.name,
          status: d.status === 'InProgress' ? 'In Progress' : d.status,
          amount: d.amount,
          closeDate: d.closeDate?.toISOString().split('T')[0] || null,
        })),
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }
      console.error('Update customer status error:', error);
      res.status(500).json({ error: 'Failed to update customer status' });
    }
  }
);

// Create Deal for Customer
router.post(
  '/:customerId/deals',
  authenticateToken,
  [
    param('customerId').isUUID(),
    body('name').trim().notEmpty(),
    body('amount').isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const customerId = req.params.customerId as string;
    const { name, amount } = req.body;

    try {
      // Check if customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }

      const deal = await prisma.deal.create({
        data: {
          name,
          amount,
          customerId,
          closeDate: new Date(),
        },
      });

      // Update customer's dealName
      await prisma.customer.update({
        where: { id: customerId },
        data: { dealName: name },
      });

      res.status(201).json({
        id: deal.id,
        name: deal.name,
        status: 'In Progress',
        amount: deal.amount,
        closeDate: deal.closeDate?.toISOString().split('T')[0] || null,
      });
    } catch (error) {
      console.error('Create deal error:', error);
      res.status(500).json({ error: 'Failed to create deal' });
    }
  }
);

// Bulk Export Customers to CSV
router.post(
  '/export',
  authenticateToken,
  [body('customerIds').isArray({ min: 1 })],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { customerIds } = req.body;

    try {
      const customers = await prisma.customer.findMany({
        where: {
          id: { in: customerIds },
        },
        include: {
          tags: true,
          deals: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Generate CSV content
      const headers = ['Name', 'Email', 'Phone', 'Channel', 'Status', 'Joined', 'Tags', 'Total Deal Value'];
      const rows = customers.map((c) => {
        const totalDealValue = c.deals.reduce((sum, d) => sum + d.amount, 0);
        return [
          c.name,
          c.email,
          c.phone || '',
          c.channel,
          c.status,
          c.joined.toISOString().split('T')[0],
          c.tags.map((t) => t.name).join('; '),
          totalDealValue.toFixed(2),
        ];
      });

      const csvContent = [
        headers.join(','),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=customers-export.csv');
      res.send(csvContent);
    } catch (error) {
      console.error('Export customers error:', error);
      res.status(500).json({ error: 'Failed to export customers' });
    }
  }
);

// Get Funnel Data (customers grouped by status with totals)
router.get(
  '/funnel',
  authenticateToken,
  [
    query('source').optional().isIn(['whatsapp', 'messenger', 'instagram', 'tiktok']),
    query('tag').optional().isString(),
    query('dateFrom').optional().isISO8601(),
    query('dateTo').optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { source, tag, dateFrom, dateTo } = req.query;

    try {
      const where: Prisma.CustomerWhereInput = {};

      if (source) where.channel = source as any;
      if (tag) {
        where.tags = {
          some: { name: tag as string },
        };
      }
      if (dateFrom || dateTo) {
        where.joined = {};
        if (dateFrom) where.joined.gte = new Date(dateFrom as string);
        if (dateTo) where.joined.lte = new Date(dateTo as string);
      }

      const customers = await prisma.customer.findMany({
        where,
        include: {
          tags: true,
          deals: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Group customers by status
      const stages = ['new', 'contacted', 'qualified', 'demo', 'won', 'unqualified'] as const;
      const funnel = stages.map((status) => {
        const stageCustomers = customers.filter((c) => c.status === status);
        const totalValue = stageCustomers.reduce((sum, c) => {
          return sum + c.deals.reduce((dealSum, d) => dealSum + d.amount, 0);
        }, 0);

        return {
          status,
          count: stageCustomers.length,
          totalValue,
          customers: stageCustomers.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            avatarUrl: c.avatarUrl,
            joined: c.joined.toISOString().split('T')[0],
            tags: c.tags.map((t) => t.name),
            channel: c.channel,
            status: c.status,
            dealName: c.dealName,
            dealHistory: c.deals.map((d) => ({
              id: d.id,
              name: d.name,
              status: d.status === 'InProgress' ? 'In Progress' : d.status,
              amount: d.amount,
              closeDate: d.closeDate?.toISOString().split('T')[0] || null,
            })),
          })),
        };
      });

      res.json(funnel);
    } catch (error) {
      console.error('Get funnel data error:', error);
      res.status(500).json({ error: 'Failed to get funnel data' });
    }
  }
);

export default router;
