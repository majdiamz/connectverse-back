import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';

const router = Router();

// List all deals with pagination, search, and status filter
router.get(
  '/',
  authenticateToken,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().isString(),
    query('status').optional().isIn(['Won', 'Lost', 'InProgress']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const page = (req.query.page as unknown as number) || 1;
    const limit = (req.query.limit as unknown as number) || 10;
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;

    try {
      const where: Prisma.DealWhereInput = {};

      // Multi-tenancy: filter by contact's customerId (super admin sees all)
      if (req.user!.role !== 'super_admin' && req.user!.customerId) {
        where.contact = { customerId: req.user!.customerId };
      }

      if (search) {
        where.OR = [
          { name: { contains: search } },
          { contact: { name: { contains: search } } },
        ];
      }

      if (status) {
        where.status = status as any;
      }

      const [deals, total] = await Promise.all([
        prisma.deal.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            contact: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.deal.count({ where }),
      ]);

      const formattedDeals = deals.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status === 'InProgress' ? 'In Progress' : d.status,
        amount: d.amount,
        closeDate: d.closeDate?.toISOString().split('T')[0] || null,
        createdAt: d.createdAt.toISOString().split('T')[0],
        contact: d.contact,
      }));

      res.json({
        deals: formattedDeals,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total,
      });
    } catch (error) {
      console.error('List deals error:', error);
      res.status(500).json({ error: 'Failed to list deals' });
    }
  }
);

// Create a new deal
router.post(
  '/',
  authenticateToken,
  [
    body('contactId').isUUID(),
    body('name').trim().notEmpty(),
    body('amount').isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { contactId, name, amount } = req.body;

    try {
      // Validate contactId belongs to user's tenant
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
        },
        include: {
          contact: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      // Update contact's dealName and price
      await prisma.contact.update({
        where: { id: contactId },
        data: { dealName: name, price: amount },
      });

      res.status(201).json({
        id: deal.id,
        name: deal.name,
        status: 'In Progress',
        amount: deal.amount,
        closeDate: deal.closeDate?.toISOString().split('T')[0] || null,
        createdAt: deal.createdAt.toISOString().split('T')[0],
        contact: deal.contact,
      });
    } catch (error) {
      console.error('Create deal error:', error);
      res.status(500).json({ error: 'Failed to create deal' });
    }
  }
);

// Update a deal
router.put(
  '/:id',
  authenticateToken,
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('amount').optional().isFloat({ min: 0 }),
    body('status').optional().isIn(['Won', 'Lost', 'InProgress']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const dealId = req.params.id as string;
    const { name, amount, status } = req.body;

    try {
      // Verify deal exists and belongs to user's tenant
      const existingDeal = await prisma.deal.findFirst({
        where: {
          id: dealId,
          contact: {
            customerId: req.user!.customerId || undefined,
          },
        },
      });

      if (!existingDeal) {
        res.status(404).json({ error: 'Deal not found' });
        return;
      }

      const updateData: Prisma.DealUpdateInput = {};
      if (name !== undefined) updateData.name = name;
      if (amount !== undefined) updateData.amount = amount;
      if (status !== undefined) {
        updateData.status = status;
        // When status changes to Won, set closeDate to now
        if (status === 'Won') {
          updateData.closeDate = new Date();
        }
      }

      const deal = await prisma.deal.update({
        where: { id: dealId },
        data: updateData,
        include: {
          contact: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      // Update contact's price with latest deal amount
      if (amount !== undefined) {
        await prisma.contact.update({
          where: { id: deal.contact.id },
          data: { price: amount },
        });
      }

      res.json({
        id: deal.id,
        name: deal.name,
        status: deal.status === 'InProgress' ? 'In Progress' : deal.status,
        amount: deal.amount,
        closeDate: deal.closeDate?.toISOString().split('T')[0] || null,
        createdAt: deal.createdAt.toISOString().split('T')[0],
        contact: deal.contact,
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Deal not found' });
        return;
      }
      console.error('Update deal error:', error);
      res.status(500).json({ error: 'Failed to update deal' });
    }
  }
);

// Delete a deal
router.delete(
  '/:id',
  authenticateToken,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const dealId = req.params.id as string;

    try {
      // Verify deal exists and belongs to user's tenant
      const existingDeal = await prisma.deal.findFirst({
        where: {
          id: dealId,
          contact: {
            customerId: req.user!.customerId || undefined,
          },
        },
      });

      if (!existingDeal) {
        res.status(404).json({ error: 'Deal not found' });
        return;
      }

      await prisma.deal.delete({ where: { id: dealId } });

      res.json({ message: 'Deal deleted successfully' });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Deal not found' });
        return;
      }
      console.error('Delete deal error:', error);
      res.status(500).json({ error: 'Failed to delete deal' });
    }
  }
);

export default router;
