import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { validatePageAccessToken } from '../services/facebook.js';

const router = Router();

// List Integrations
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integrations = await prisma.integration.findMany({
      where: { customerId: req.user!.customerId },
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

// Connect Integration
router.post(
  '/:channel/connect',
  authenticateToken,
  [
    param('channel').isIn(['whatsapp', 'messenger', 'instagram', 'tiktok']),
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

      const integration = await prisma.integration.upsert({
        where: {
          customerId_channel: {
            customerId: req.user!.customerId,
            channel: channel as any,
          },
        },
        update: {
          apiKey,
          pageId,
          status: 'connected',
        },
        create: {
          name: getIntegrationName(channel),
          channel: channel as any,
          description: getIntegrationDescription(channel),
          apiKey,
          pageId,
          status: 'connected',
          customerId: req.user!.customerId,
        },
      });

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

// Disconnect Integration
router.post(
  '/:channel/disconnect',
  authenticateToken,
  [param('channel').isIn(['whatsapp', 'messenger', 'instagram', 'tiktok'])],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const channel = req.params.channel as string;

    try {
      const integration = await prisma.integration.update({
        where: {
          customerId_channel: {
            customerId: req.user!.customerId,
            channel: channel as any,
          },
        },
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
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: 'Integration not found' });
        return;
      }
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
