import { Router, Request, Response } from 'express';
import { prisma } from '../../index.js';
import { validateFacebookSignature, RawBodyRequest } from '../../middleware/facebookWebhook.js';
import { getUserProfile } from '../../services/facebook.js';

const router = Router();

interface MessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: { url?: string };
    }>;
  };
}

interface WebhookEntry {
  id: string;
  time: number;
  messaging: MessagingEvent[];
}

interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

/**
 * GET /webhooks/messenger - Webhook verification
 * Facebook sends a GET request to verify the webhook URL
 */
router.get('/', (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    console.error('FACEBOOK_VERIFY_TOKEN is not configured');
    res.status(500).send('Server configuration error');
    return;
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Facebook webhook verified successfully');
    res.status(200).send(challenge);
    return;
  }

  console.warn('Facebook webhook verification failed');
  res.status(403).send('Forbidden');
});

/**
 * POST /webhooks/messenger - Receive incoming messages
 * Facebook sends a POST request when messages are received
 */
router.post(
  '/',
  validateFacebookSignature,
  async (req: RawBodyRequest, res: Response): Promise<void> => {
    const payload = req.body as WebhookPayload;

    // Respond immediately with 200 OK
    // Facebook expects a quick response, so we process asynchronously
    res.status(200).send('EVENT_RECEIVED');

    if (payload.object !== 'page') {
      console.warn('Received non-page webhook event:', payload.object);
      return;
    }

    // Process each entry
    for (const entry of payload.entry) {
      const pageId = entry.id;

      // Find the integration for this page
      const integration = await prisma.integration.findFirst({
        where: {
          channel: 'messenger',
          pageId: pageId,
          status: 'connected',
        },
      });

      if (!integration) {
        console.warn(`No connected integration found for page ${pageId}`);
        continue;
      }

      // Process each messaging event
      for (const event of entry.messaging) {
        await processMessagingEvent(event, integration.apiKey!, integration.customerId);
      }
    }
  }
);

/**
 * Process a single messaging event from Facebook
 */
async function processMessagingEvent(
  event: MessagingEvent,
  pageAccessToken: string,
  customerId: string
): Promise<void> {
  const senderId = event.sender.id;
  const message = event.message;

  // Skip if no message (could be a delivery/read receipt)
  if (!message || !message.text) {
    return;
  }

  // Check for duplicate message
  const existingMessage = await prisma.message.findFirst({
    where: { externalMessageId: message.mid },
  });

  if (existingMessage) {
    console.log(`Skipping duplicate message: ${message.mid}`);
    return;
  }

  try {
    // Find or create contact by PSID for this customer
    let contact = await prisma.contact.findFirst({
      where: {
        externalId: senderId,
        channel: 'messenger',
        customerId,
      },
    });

    if (!contact) {
      // Fetch user profile from Facebook
      let userProfile = { name: 'Facebook User', profile_pic: undefined as string | undefined };
      try {
        const profile = await getUserProfile(senderId, pageAccessToken);
        userProfile = {
          name: profile.name || profile.first_name || 'Facebook User',
          profile_pic: profile.profile_pic,
        };
      } catch (profileError) {
        console.warn(`Failed to fetch user profile for ${senderId}:`, profileError);
      }

      // Create new contact
      contact = await prisma.contact.create({
        data: {
          name: userProfile.name,
          email: `messenger_${senderId}@facebook.placeholder`,
          externalId: senderId,
          channel: 'messenger',
          avatarUrl: userProfile.profile_pic,
          status: 'new',
          customerId,
        },
      });
      console.log(`Created new contact for PSID ${senderId}: ${contact.id}`);
    }

    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        channel: 'messenger',
        customerId,
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          contactId: contact.id,
          channel: 'messenger',
          unreadCount: 0,
          customerId,
        },
      });
      console.log(`Created new conversation for contact ${contact.id}: ${conversation.id}`);
    }

    // Create the message
    await prisma.message.create({
      data: {
        text: message.text,
        sender: 'contact',
        externalMessageId: message.mid,
        conversationId: conversation.id,
      },
    });

    // Increment unread count and update timestamp
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    console.log(`Processed message from ${senderId}: ${message.mid}`);
  } catch (error) {
    console.error(`Error processing message from ${senderId}:`, error);
  }
}

export default router;
