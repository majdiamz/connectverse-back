import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';

const router = Router();

// List Emails
router.get(
  '/',
  authenticateToken,
  [
    query('folder').isIn(['inbox', 'sent', 'drafts', 'trash']),
    query('search').optional().isString(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const folder = req.query.folder as string;
    const search = req.query.search as string | undefined;

    try {
      const where: Prisma.EmailWhereInput = {
        customerId: req.user!.customerId,
        folder: folder as any,
      };

      if (search) {
        where.OR = [
          { subject: { contains: search } },
          { body: { contains: search } },
          { fromName: { contains: search } },
          { fromEmail: { contains: search } },
        ];
      }

      const emails = await prisma.email.findMany({
        where,
        orderBy: { timestamp: 'desc' },
      });

      const formattedEmails = emails.map((email) => ({
        id: email.id,
        from: {
          name: email.fromName,
          email: email.fromEmail,
          avatar: email.fromAvatar,
        },
        subject: email.subject,
        body: email.body,
        timestamp: email.timestamp.toISOString(),
        isRead: email.isRead,
        folder: email.folder,
      }));

      res.json(formattedEmails);
    } catch (error) {
      console.error('List emails error:', error);
      res.status(500).json({ error: 'Failed to list emails' });
    }
  }
);

// Send Email
router.post(
  '/',
  authenticateToken,
  [
    body('subject').trim().notEmpty(),
    body('body').trim().notEmpty(),
    body('to').optional().isEmail(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { subject, body: emailBody } = req.body;

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
      });

      const email = await prisma.email.create({
        data: {
          fromName: user!.name,
          fromEmail: user!.email,
          fromAvatar: user!.avatarUrl,
          subject,
          body: emailBody,
          folder: 'sent',
          isRead: true,
          userId: req.user!.id,
          customerId: req.user!.customerId,
        },
      });

      res.status(201).json({
        id: email.id,
        from: {
          name: email.fromName,
          email: email.fromEmail,
          avatar: email.fromAvatar,
        },
        subject: email.subject,
        body: email.body,
        timestamp: email.timestamp.toISOString(),
        isRead: email.isRead,
        folder: email.folder,
      });
    } catch (error) {
      console.error('Send email error:', error);
      res.status(500).json({ error: 'Failed to send email' });
    }
  }
);

// Update Email
router.put(
  '/:emailId',
  authenticateToken,
  [
    param('emailId').isUUID(),
    body('isRead').optional().isBoolean(),
    body('folder').optional().isIn(['inbox', 'sent', 'drafts', 'trash']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const emailId = req.params.emailId as string;
    const { isRead, folder } = req.body;

    try {
      // First verify the email belongs to this customer
      const existingEmail = await prisma.email.findFirst({
        where: { id: emailId, customerId: req.user!.customerId },
      });

      if (!existingEmail) {
        res.status(404).json({ error: 'Email not found' });
        return;
      }

      const email = await prisma.email.update({
        where: { id: emailId },
        data: {
          ...(isRead !== undefined && { isRead }),
          ...(folder && { folder }),
        },
      });

      res.json({
        id: email.id,
        from: {
          name: email.fromName,
          email: email.fromEmail,
          avatar: email.fromAvatar,
        },
        subject: email.subject,
        body: email.body,
        timestamp: email.timestamp.toISOString(),
        isRead: email.isRead,
        folder: email.folder,
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Email not found' });
        return;
      }
      console.error('Update email error:', error);
      res.status(500).json({ error: 'Failed to update email' });
    }
  }
);

export default router;
