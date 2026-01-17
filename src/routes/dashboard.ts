import { Router, Response } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Get Dashboard Stats
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [totalConversations, newLeadsCount, openConversations] = await Promise.all([
      prisma.conversation.count(),
      prisma.customer.count({ where: { status: 'new' } }),
      prisma.conversation.count({ where: { unreadCount: { gt: 0 } } }),
    ]);

    // Calculate response rate (mock calculation based on messages)
    const totalMessages = await prisma.message.count();
    const userMessages = await prisma.message.count({ where: { sender: 'user' } });
    const responseRate = totalMessages > 0 ? Math.round((userMessages / totalMessages) * 100) : 0;

    res.json({
      totalConversations,
      newLeads: newLeadsCount,
      responseRate,
      openConversations,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

// Get Conversation Trends
router.get('/conversation-trends', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Get conversation data grouped by month for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const conversations = await prisma.conversation.findMany({
      where: {
        createdAt: { gte: sixMonthsAgo },
      },
      select: {
        createdAt: true,
        unreadCount: true,
      },
    });

    // Group by month
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trendData: { [key: string]: { new: number; resolved: number } } = {};

    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthKey = monthNames[d.getMonth()];
      trendData[monthKey] = { new: 0, resolved: 0 };
    }

    conversations.forEach((conv) => {
      const monthKey = monthNames[conv.createdAt.getMonth()];
      if (trendData[monthKey]) {
        trendData[monthKey].new++;
        if (conv.unreadCount === 0) {
          trendData[monthKey].resolved++;
        }
      }
    });

    const result = Object.entries(trendData).map(([month, data]) => ({
      month,
      new: data.new,
      resolved: data.resolved,
    }));

    res.json(result);
  } catch (error) {
    console.error('Get conversation trends error:', error);
    res.status(500).json({ error: 'Failed to get conversation trends' });
  }
});

// Get Deals by Stage
router.get('/deals-by-stage', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const deals = await prisma.deal.groupBy({
      by: ['status'],
      _sum: {
        amount: true,
      },
    });

    const result = deals.map((d) => ({
      stage: d.status === 'InProgress' ? 'In Progress' : d.status,
      amount: d._sum.amount || 0,
    }));

    res.json(result);
  } catch (error) {
    console.error('Get deals by stage error:', error);
    res.status(500).json({ error: 'Failed to get deals by stage' });
  }
});

// Get Platform Stats
router.get('/platform-stats', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const channels: ('whatsapp' | 'messenger' | 'instagram' | 'tiktok')[] = ['whatsapp', 'messenger', 'instagram', 'tiktok'];

    const stats = await Promise.all(
      channels.map(async (channel) => {
        const totalConversations = await prisma.conversation.count({
          where: { channel },
        });
        const newLeads = await prisma.customer.count({
          where: { channel, status: 'new' },
        });
        const wonCustomers = await prisma.customer.count({
          where: { channel, status: 'won' },
        });
        const totalCustomers = await prisma.customer.count({
          where: { channel },
        });

        return {
          platform: channel,
          totalConversations,
          newLeads,
          responseRate: Math.floor(Math.random() * 20) + 80, // Mock: 80-100%
          conversionRate: totalCustomers > 0 ? Math.round((wonCustomers / totalCustomers) * 100) : 0,
        };
      })
    );

    res.json(stats);
  } catch (error) {
    console.error('Get platform stats error:', error);
    res.status(500).json({ error: 'Failed to get platform stats' });
  }
});

export default router;
