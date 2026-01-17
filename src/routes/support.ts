import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Get Support Messages
router.get('/messages', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const messages = await prisma.supportMessage.findMany({
      where: { userId: req.user!.id },
      orderBy: { timestamp: 'asc' },
    });

    const formattedMessages = messages.map((m, index) => ({
      id: index + 1,
      text: m.text,
      sender: m.sender,
      timestamp: m.timestamp.toISOString(),
    }));

    res.json(formattedMessages);
  } catch (error) {
    console.error('Get support messages error:', error);
    res.status(500).json({ error: 'Failed to get support messages' });
  }
});

// Send Support Message
router.post(
  '/messages',
  authenticateToken,
  [body('text').trim().notEmpty()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      // Create user message
      const userMessage = await prisma.supportMessage.create({
        data: {
          text: req.body.text,
          sender: 'user',
          userId: req.user!.id,
        },
      });

      // Create auto-reply from support (simulated)
      const supportReply = await prisma.supportMessage.create({
        data: {
          text: generateSupportReply(req.body.text),
          sender: 'support',
          userId: req.user!.id,
        },
      });

      const messageCount = await prisma.supportMessage.count({
        where: { userId: req.user!.id },
      });

      res.status(201).json({
        id: messageCount,
        text: userMessage.text,
        sender: userMessage.sender,
        timestamp: userMessage.timestamp.toISOString(),
      });
    } catch (error) {
      console.error('Send support message error:', error);
      res.status(500).json({ error: 'Failed to send support message' });
    }
  }
);

function generateSupportReply(userMessage: string): string {
  const replies = [
    "Thank you for reaching out! Our team will review your message and get back to you shortly.",
    "We appreciate your message. A support specialist will assist you soon.",
    "Thanks for contacting ConnectVerse support! We're here to help and will respond as quickly as possible.",
    "Your message has been received. Our support team typically responds within 24 hours.",
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

export default router;
