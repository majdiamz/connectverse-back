import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';

const router = Router();

// List Contacts
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
      const where: Prisma.ContactWhereInput = {
        customerId: req.user!.customerId || undefined,
      };

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

      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            tags: true,
            deals: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.contact.count({ where }),
      ]);

      const formattedContacts = contacts.map((c) => ({
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
        price: c.price,
        dealHistory: c.deals.map((d) => ({
          id: d.id,
          name: d.name,
          status: d.status === 'InProgress' ? 'In Progress' : d.status,
          amount: d.amount,
          closeDate: d.closeDate?.toISOString().split('T')[0] || null,
        })),
      }));

      res.json({
        customers: formattedContacts,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      });
    } catch (error) {
      console.error('List contacts error:', error);
      res.status(500).json({ error: 'Failed to list contacts' });
    }
  }
);

// Create Contact
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
      const contact = await prisma.contact.create({
        data: {
          name,
          email,
          phone,
          channel,
          status,
          avatarUrl: `https://picsum.photos/seed/${Date.now()}/100/100`,
          customerId: req.user!.customerId || undefined,
        },
        include: {
          tags: true,
          deals: true,
        },
      });

      // Create a conversation for the new contact
      await prisma.conversation.create({
        data: {
          channel: contact.channel,
          contactId: contact.id,
          customerId: req.user!.customerId || undefined,
        },
      });

      res.status(201).json({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        avatarUrl: contact.avatarUrl,
        joined: contact.joined.toISOString().split('T')[0],
        tags: contact.tags.map((t) => t.name),
        channel: contact.channel,
        status: contact.status,
        dealName: contact.dealName,
        dealHistory: [],
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        res.status(400).json({ error: 'Email already exists' });
        return;
      }
      console.error('Create contact error:', error);
      res.status(500).json({ error: 'Failed to create contact' });
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

    const contactId = req.params.customerId as string;

    try {
      const contact = await prisma.contact.findFirst({
        where: {
          id: contactId,
          customerId: req.user!.customerId || undefined,
        },
        include: {
          tags: true,
          deals: true,
        },
      });

      if (!contact) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      res.json({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        avatarUrl: contact.avatarUrl,
        joined: contact.joined.toISOString().split('T')[0],
        tags: contact.tags.map((t: { name: string }) => t.name),
        channel: contact.channel,
        status: contact.status,
        dealName: contact.dealName,
        price: contact.price,
        dealHistory: contact.deals.map((d: { id: string; name: string; status: string; amount: number; closeDate: Date | null }) => ({
          id: d.id,
          name: d.name,
          status: d.status === 'InProgress' ? 'In Progress' : d.status,
          amount: d.amount,
          closeDate: d.closeDate?.toISOString().split('T')[0] || null,
        })),
      });
    } catch (error) {
      console.error('Get contact error:', error);
      res.status(500).json({ error: 'Failed to get contact' });
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
    body('price').optional().isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const contactId = req.params.customerId as string;
    const { name, email, phone, channel, status, price } = req.body;

    try {
      // First verify the contact belongs to this customer
      const existingContact = await prisma.contact.findFirst({
        where: { id: contactId, customerId: req.user!.customerId || undefined },
      });

      if (!existingContact) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      // If price is being updated, also update the most recent deal's amount
      if (price !== undefined) {
        const latestDeal = await prisma.deal.findFirst({
          where: { contactId },
          orderBy: { createdAt: 'desc' },
        });
        if (latestDeal) {
          await prisma.deal.update({
            where: { id: latestDeal.id },
            data: { amount: price !== null ? parseFloat(price) : 0 },
          });
        }
      }

      const contact = await prisma.contact.update({
        where: { id: contactId },
        data: {
          ...(name && { name }),
          ...(email && { email }),
          ...(phone !== undefined && { phone }),
          ...(channel && { channel }),
          ...(status && { status }),
          ...(price !== undefined && { price: price !== null ? parseFloat(price) : null }),
        },
        include: {
          tags: true,
          deals: true,
        },
      });

      res.json({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        avatarUrl: contact.avatarUrl,
        joined: contact.joined.toISOString().split('T')[0],
        tags: contact.tags.map((t: { name: string }) => t.name),
        channel: contact.channel,
        status: contact.status,
        dealName: contact.dealName,
        price: contact.price,
        dealHistory: contact.deals.map((d: { id: string; name: string; status: string; amount: number; closeDate: Date | null }) => ({
          id: d.id,
          name: d.name,
          status: d.status === 'InProgress' ? 'In Progress' : d.status,
          amount: d.amount,
          closeDate: d.closeDate?.toISOString().split('T')[0] || null,
        })),
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }
      console.error('Update contact error:', error);
      res.status(500).json({ error: 'Failed to update contact' });
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

    const contactId = req.params.customerId as string;

    try {
      // First verify the contact belongs to this customer
      const existingContact = await prisma.contact.findFirst({
        where: { id: contactId, customerId: req.user!.customerId || undefined },
      });

      if (!existingContact) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      const contact = await prisma.contact.update({
        where: { id: contactId },
        data: { status: req.body.status },
        include: {
          tags: true,
          deals: true,
        },
      });

      res.json({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        avatarUrl: contact.avatarUrl,
        joined: contact.joined.toISOString().split('T')[0],
        tags: contact.tags.map((t: { name: string }) => t.name),
        channel: contact.channel,
        status: contact.status,
        dealName: contact.dealName,
        dealHistory: contact.deals.map((d: { id: string; name: string; status: string; amount: number; closeDate: Date | null }) => ({
          id: d.id,
          name: d.name,
          status: d.status === 'InProgress' ? 'In Progress' : d.status,
          amount: d.amount,
          closeDate: d.closeDate?.toISOString().split('T')[0] || null,
        })),
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }
      console.error('Update contact status error:', error);
      res.status(500).json({ error: 'Failed to update contact status' });
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

    const contactId = req.params.customerId as string;
    const { name, amount } = req.body;

    try {
      // Check if contact exists and belongs to this customer
      const contact = await prisma.contact.findFirst({
        where: {
          id: contactId,
          customerId: req.user!.customerId || undefined,
        },
      });

      if (!contact) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      const deal = await prisma.deal.create({
        data: {
          name,
          amount,
          contactId,
          closeDate: new Date(),
        },
      });

      // Update contact's dealName
      await prisma.contact.update({
        where: { id: contactId },
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

// Bulk Export Contacts to CSV
router.post(
  '/export',
  authenticateToken,
  [body('contactIds').isArray({ min: 1 })],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { contactIds } = req.body;

    try {
      const contacts = await prisma.contact.findMany({
        where: {
          id: { in: contactIds },
          customerId: req.user!.customerId || undefined,
        },
        include: {
          tags: true,
          deals: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Generate CSV content
      const headers = ['Name', 'Email', 'Phone', 'Channel', 'Status', 'Joined', 'Tags', 'Total Deal Value'];
      const rows = contacts.map((c) => {
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
      res.setHeader('Content-Disposition', 'attachment; filename=contacts-export.csv');
      res.send(csvContent);
    } catch (error) {
      console.error('Export contacts error:', error);
      res.status(500).json({ error: 'Failed to export contacts' });
    }
  }
);

// Get Funnel Data (contacts grouped by status with totals)
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
      const where: Prisma.ContactWhereInput = {
        customerId: req.user!.customerId || undefined,
      };

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

      const contacts = await prisma.contact.findMany({
        where,
        include: {
          tags: true,
          deals: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Group contacts by status
      const stages = ['new', 'contacted', 'qualified', 'demo', 'won', 'unqualified'] as const;
      const funnel = stages.map((status) => {
        const stageContacts = contacts.filter((c) => c.status === status);
        const totalValue = stageContacts.reduce((sum, c) => {
          return sum + c.deals.reduce((dealSum, d) => dealSum + d.amount, 0);
        }, 0);

        return {
          status,
          count: stageContacts.length,
          totalValue,
          contacts: stageContacts.map((c) => ({
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
