import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth.js';
import { validatePageAccessToken } from '../services/facebook.js';
import {
  startSession,
  getQRCode,
  disconnectSession,
  getSession,
} from '../services/whatsapp.js';

const router = Router();

// List Integrations (non-WhatsApp)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integrations = await prisma.integration.findMany({
      where: {
        customerId: req.user!.customerId!,
        channel: { not: 'whatsapp' },
      },
      orderBy: { name: 'asc' },
    });

    const formattedIntegrations = integrations.map((i) => ({
      name: i.name,
      channel: i.channel,
      description: i.description,
      status: i.status,
    }));

    res.json(formattedIntegrations);
  } catch (error) {
    console.error('List integrations error:', error);
    res.status(500).json({ error: 'Failed to list integrations' });
  }
});

// ==================== WhatsApp Endpoints (MUST be before /:channel routes) ====================

// List WhatsApp integrations
router.get('/whatsapp', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where: any = {
      customerId: req.user!.customerId!,
      channel: 'whatsapp',
    };

    // Commercial users only see their own integrations
    if (req.user!.role === 'commercial') {
      where.userId = req.user!.id;
    }

    const integrations = await prisma.integration.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = integrations.map((i) => {
      const session = getSession(i.id);
      return {
        id: i.id,
        name: i.name,
        status: session?.status || i.status,
        whatsappPhoneNumber: i.whatsappPhoneNumber,
        user: i.user,
        createdAt: i.createdAt,
      };
    });

    res.json(formatted);
  } catch (error) {
    console.error('List WhatsApp integrations error:', error);
    res.status(500).json({ error: 'Failed to list WhatsApp integrations' });
  }
});

// Connect WhatsApp (create or reuse integration + start session)
router.post('/whatsapp/connect', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Reuse existing disconnected integration for this user, or create a new one
    let integration = await prisma.integration.findFirst({
      where: {
        customerId: req.user!.customerId!,
        channel: 'whatsapp',
        userId: req.user!.id,
        status: 'disconnected',
      },
    });

    if (integration) {
      integration = await prisma.integration.update({
        where: { id: integration.id },
        data: { status: 'disconnected' },
      });
    } else {
      integration = await prisma.integration.create({
        data: {
          name: `WhatsApp - ${req.user!.name}`,
          channel: 'whatsapp',
          description: 'WhatsApp Business via QR code connection.',
          status: 'disconnected',
          customerId: req.user!.customerId!,
          userId: req.user!.id,
        },
      });
    }

    await startSession(integration.id, req.user!.customerId || '', req.user!.id, prisma);

    res.status(201).json({
      integrationId: integration.id,
      status: 'connecting',
    });
  } catch (error) {
    console.error('Connect WhatsApp error:', error);
    res.status(500).json({ error: 'Failed to start WhatsApp connection' });
  }
});

// Get WhatsApp QR code
router.get(
  '/whatsapp/:integrationId/qr',
  authenticateToken,
  [param('integrationId').isUUID()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const integrationId = req.params.integrationId as string;

    // Verify ownership
    const integration = await prisma.integration.findFirst({
      where: {
        id: integrationId,
        customerId: req.user!.customerId!,
      },
    });

    if (!integration) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    const result = getQRCode(integrationId);
    res.json(result);
  }
);

// Get WhatsApp status
router.get(
  '/whatsapp/:integrationId/status',
  authenticateToken,
  [param('integrationId').isUUID()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const integrationId = req.params.integrationId as string;

    const integration = await prisma.integration.findFirst({
      where: {
        id: integrationId,
        customerId: req.user!.customerId!,
      },
    });

    if (!integration) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    const session = getSession(integrationId);
    res.json({
      status: session?.status || integration.status,
      whatsappPhoneNumber: integration.whatsappPhoneNumber,
    });
  }
);

// Disconnect WhatsApp
router.post(
  '/whatsapp/:integrationId/disconnect',
  authenticateToken,
  [param('integrationId').isUUID()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const integrationId = req.params.integrationId as string;

    const integration = await prisma.integration.findFirst({
      where: {
        id: integrationId,
        customerId: req.user!.customerId!,
      },
    });

    if (!integration) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    // Only owner or admin can disconnect
    if (req.user!.role !== 'admin' && integration.userId !== req.user!.id) {
      res.status(403).json({ error: 'Only the owner or admin can disconnect this integration' });
      return;
    }

    await disconnectSession(integrationId, prisma);

    res.json({ success: true });
  }
);

// ==================== Non-WhatsApp Channel Endpoints ====================

// Connect Integration (non-WhatsApp)
router.post(
  '/:channel/connect',
  authenticateToken,
  [
    param('channel').isIn(['messenger', 'instagram', 'tiktok']),
    body('apiKey').trim().notEmpty(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const channel = req.params.channel as string;
    const { apiKey } = req.body;

    try {
      let pageId: string | null = null;

      // For messenger, validate the Page Access Token and get Page ID
      if (channel === 'messenger') {
        try {
          const pageInfo = await validatePageAccessToken(apiKey);
          pageId = pageInfo.id;
          console.log(`Validated Page Access Token for page: ${pageInfo.name} (${pageId})`);
        } catch (tokenError) {
          console.error('Page Access Token validation failed:', tokenError);
          res.status(400).json({ error: 'Invalid Page Access Token' });
          return;
        }
      }

      // Use findFirst + create/update instead of upsert on the old unique key
      const existing = await prisma.integration.findFirst({
        where: {
          customerId: req.user!.customerId!,
          channel: channel as any,
        },
      });

      let integration;
      if (existing) {
        integration = await prisma.integration.update({
          where: { id: existing.id },
          data: {
            apiKey,
            pageId,
            status: 'connected',
          },
        });
      } else {
        integration = await prisma.integration.create({
          data: {
            name: getIntegrationName(channel),
            channel: channel as any,
            description: getIntegrationDescription(channel),
            apiKey,
            pageId,
            status: 'connected',
            customerId: req.user!.customerId!,
          },
        });
      }

      res.json({
        name: integration.name,
        channel: integration.channel,
        description: integration.description,
        status: integration.status,
        pageId: integration.pageId,
      });
    } catch (error) {
      console.error('Connect integration error:', error);
      res.status(500).json({ error: 'Failed to connect integration' });
    }
  }
);

// Disconnect Integration (non-WhatsApp)
router.post(
  '/:channel/disconnect',
  authenticateToken,
  [param('channel').isIn(['messenger', 'instagram', 'tiktok'])],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const channel = req.params.channel as string;

    try {
      const existing = await prisma.integration.findFirst({
        where: {
          customerId: req.user!.customerId!,
          channel: channel as any,
        },
      });

      if (!existing) {
        res.status(404).json({ error: 'Integration not found' });
        return;
      }

      const integration = await prisma.integration.update({
        where: { id: existing.id },
        data: {
          status: 'disconnected',
          apiKey: null,
          pageId: null,
          webhookVerified: false,
        },
      });

      res.json({
        name: integration.name,
        channel: integration.channel,
        description: integration.description,
        status: integration.status,
      });
    } catch (error) {
      console.error('Disconnect integration error:', error);
      res.status(500).json({ error: 'Failed to disconnect integration' });
    }
  }
);

function getIntegrationName(channel: string): string {
  const names: { [key: string]: string } = {
    whatsapp: 'WhatsApp Business',
    messenger: 'Facebook Messenger',
    instagram: 'Instagram Direct',
    tiktok: 'TikTok Messages',
  };
  return names[channel] || channel;
}

function getIntegrationDescription(channel: string): string {
  const descriptions: { [key: string]: string } = {
    whatsapp: 'Connect your WhatsApp Business account to manage customer conversations.',
    messenger: 'Integrate Facebook Messenger to respond to customers from your Facebook page.',
    instagram: 'Connect Instagram Direct messages for seamless customer communication.',
    tiktok: 'Manage TikTok messages and engage with your audience.',
  };
  return descriptions[channel] || '';
}

export default router;
