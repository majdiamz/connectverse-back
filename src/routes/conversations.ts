import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';
import { sendMessage as sendFacebookMessage } from '../services/facebook.js';

const router = Router();

// List Conversations
router.get(
  '/',
  authenticateToken,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('search').optional().isString(),
    query('channel').optional().isIn(['whatsapp', 'messenger', 'instagram', 'tiktok']),
    query('status').optional().isIn(['read', 'unread']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const page = (req.query.page as unknown as number) || 1;
    const limit = (req.query.limit as unknown as number) || 10;
    const { search, channel, status } = req.query;

    try {
      const where: Prisma.ConversationWhereInput = {};

      if (channel) where.channel = channel as any;
      if (status === 'read') where.unreadCount = 0;
      if (status === 'unread') where.unreadCount = { gt: 0 };
      if (search) {
        where.customer = {
          OR: [
            { name: { contains: search as string } },
            { email: { contains: search as string } },
          ],
        };
      }

      const [conversations, total] = await Promise.all([
        prisma.conversation.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            customer: {
              include: {
                tags: true,
                deals: true,
              },
            },
            messages: {
              orderBy: { timestamp: 'asc' },
            },
          },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.conversation.count({ where }),
      ]);

      const formattedConversations = conversations.map((conv) => ({
        id: conv.id,
        channel: conv.channel,
        unreadCount: conv.unreadCount,
        customer: {
          id: conv.customer.id,
          name: conv.customer.name,
          email: conv.customer.email,
          phone: conv.customer.phone,
          avatarUrl: conv.customer.avatarUrl,
          joined: conv.customer.joined.toISOString().split('T')[0],
          tags: conv.customer.tags.map((t) => t.name),
          channel: conv.customer.channel,
          status: conv.customer.status,
          dealName: conv.customer.dealName,
          dealHistory: conv.customer.deals.map((d) => ({
            id: d.id,
            name: d.name,
            status: d.status === 'InProgress' ? 'In Progress' : d.status,
            amount: d.amount,
            closeDate: d.closeDate?.toISOString().split('T')[0] || null,
          })),
        },
        messages: conv.messages.map((m) => ({
          id: m.id,
          text: m.text,
          timestamp: m.timestamp.toISOString(),
          sender: m.sender,
        })),
      }));

      res.json({
        conversations: formattedConversations,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      });
    } catch (error) {
      console.error('List conversations error:', error);
      res.status(500).json({ error: 'Failed to list conversations' });
    }
  }
);

// Get Conversation Details
router.get(
  '/:conversationId',
  authenticateToken,
  [param('conversationId').isUUID()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const conversationId = req.params.conversationId as string;

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          customer: {
            include: {
              tags: true,
              deals: true,
            },
          },
          messages: {
            orderBy: { timestamp: 'asc' },
          },
        },
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const customer = conversation.customer;
      const messages = conversation.messages;

      res.json({
        id: conversation.id,
        channel: conversation.channel,
        unreadCount: conversation.unreadCount,
        customer: {
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
        },
        messages: messages.map((m: { id: string; text: string; timestamp: Date; sender: string }) => ({
          id: m.id,
          text: m.text,
          timestamp: m.timestamp.toISOString(),
          sender: m.sender,
        })),
      });
    } catch (error) {
      console.error('Get conversation error:', error);
      res.status(500).json({ error: 'Failed to get conversation' });
    }
  }
);

// Send Message
router.post(
  '/:conversationId/messages',
  authenticateToken,
  [
    param('conversationId').isUUID(),
    body('text').trim().notEmpty(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const conversationId = req.params.conversationId as string;

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          customer: true,
        },
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      let externalMessageId: string | null = null;

      // If this is a messenger conversation, send via Facebook Graph API
      if (conversation.channel === 'messenger' && conversation.customer.externalId) {
        const integration = await prisma.integration.findUnique({
          where: { channel: 'messenger' },
        });

        if (integration?.status === 'connected' && integration.apiKey) {
          try {
            const fbResponse = await sendFacebookMessage(
              conversation.customer.externalId,
              req.body.text,
              integration.apiKey
            );
            externalMessageId = fbResponse.message_id;
            console.log(`Sent message to Facebook: ${externalMessageId}`);
          } catch (fbError) {
            console.error('Failed to send message via Facebook:', fbError);
            res.status(502).json({ error: 'Failed to send message to Facebook Messenger' });
            return;
          }
        } else {
          console.warn('Messenger integration not connected, message will not be delivered');
        }
      }

      const message = await prisma.message.create({
        data: {
          text: req.body.text,
          sender: 'user',
          externalMessageId,
          conversationId,
          userId: req.user!.id,
        },
      });

      // Update conversation timestamp
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      res.status(201).json({
        id: message.id,
        text: message.text,
        timestamp: message.timestamp.toISOString(),
        sender: message.sender,
        externalMessageId: message.externalMessageId,
      });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

// Mark Conversation as Read
router.put(
  '/:conversationId/read',
  authenticateToken,
  [param('conversationId').isUUID()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const conversationId = req.params.conversationId as string;

    try {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { unreadCount: 0 },
      });

      res.json({ success: true });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      console.error('Mark as read error:', error);
      res.status(500).json({ error: 'Failed to mark conversation as read' });
    }
  }
);

// Get Messages with Pagination (for loading older messages)
router.get(
  '/:conversationId/messages',
  authenticateToken,
  [
    param('conversationId').isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('before').optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const conversationId = req.params.conversationId as string;
    const limit = (req.query.limit as unknown as number) || 20;
    const before = req.query.before as string | undefined;

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const where: Prisma.MessageWhereInput = {
        conversationId,
      };

      if (before) {
        where.timestamp = { lt: new Date(before) };
      }

      const messages = await prisma.message.findMany({
        where,
        take: limit,
        orderBy: { timestamp: 'desc' },
      });

      // Get total count to determine if there are more messages
      const totalCount = await prisma.message.count({
        where: { conversationId },
      });

      const oldestFetched = messages.length > 0 ? messages[messages.length - 1].timestamp : null;
      const olderMessagesCount = oldestFetched
        ? await prisma.message.count({
            where: {
              conversationId,
              timestamp: { lt: oldestFetched },
            },
          })
        : 0;

      res.json({
        messages: messages.reverse().map((m) => ({
          id: m.id,
          text: m.text,
          timestamp: m.timestamp.toISOString(),
          sender: m.sender,
        })),
        hasMore: olderMessagesCount > 0,
        totalCount,
      });
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Failed to get messages' });
    }
  }
);

export default router;
