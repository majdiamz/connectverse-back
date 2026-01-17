import { Router, Response } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Get Service Status
router.get('/services', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const services = await prisma.serviceStatus.findMany({
      orderBy: { name: 'asc' },
    });

    const formattedServices = services.map((s) => ({
      name: s.name,
      status: s.status,
      lastChecked: s.lastChecked.toISOString(),
    }));

    res.json(formattedServices);
  } catch (error) {
    console.error('Get service status error:', error);
    res.status(500).json({ error: 'Failed to get service status' });
  }
});

// Get Update Logs
router.get('/update-logs', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const logs = await prisma.updateLog.findMany({
      include: {
        changes: true,
      },
      orderBy: { date: 'desc' },
    });

    const formattedLogs = logs.map((log) => ({
      version: log.version,
      date: log.date.toISOString().split('T')[0],
      description: log.description,
      changes: log.changes.map((c) => c.change),
    }));

    res.json(formattedLogs);
  } catch (error) {
    console.error('Get update logs error:', error);
    res.status(500).json({ error: 'Failed to get update logs' });
  }
});

export default router;
