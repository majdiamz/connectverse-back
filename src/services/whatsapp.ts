import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import pino from 'pino';

const logger = pino({ level: 'silent' });

interface WhatsAppSession {
  socket: WASocket | null;
  qrCode: string | null;
  status: 'connecting' | 'connected' | 'disconnected';
  retryCount: number;
  integrationId: string;
  customerId: string;
  userId: string;
}

const sessions = new Map<string, WhatsAppSession>();
const MAX_RETRIES = 5;

function getAuthPath(integrationId: string): string {
  return path.join(process.cwd(), 'auth_sessions', integrationId);
}

export async function startSession(
  integrationId: string,
  customerId: string,
  userId: string,
  prisma: PrismaClient
): Promise<void> {
  // If session already exists, disconnect first
  if (sessions.has(integrationId)) {
    await disconnectSession(integrationId, prisma);
  }

  const authPath = getAuthPath(integrationId);
  mkdirSync(authPath, { recursive: true });

  const session: WhatsAppSession = {
    socket: null,
    qrCode: null,
    status: 'connecting',
    retryCount: 0,
    integrationId,
    customerId,
    userId,
  };
  sessions.set(integrationId, session);

  await connectSocket(session, prisma);
}

async function connectSocket(
  session: WhatsAppSession,
  prisma: PrismaClient
): Promise<void> {
  const authPath = getAuthPath(session.integrationId);
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const socket = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
  });

  session.socket = socket;

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        session.qrCode = await QRCode.toDataURL(qr);
        session.status = 'connecting';
      } catch (err) {
        console.error(`Failed to generate QR code for ${session.integrationId}:`, err);
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect && session.retryCount < MAX_RETRIES) {
        session.retryCount++;
        const delay = Math.min(1000 * Math.pow(2, session.retryCount), 30000);
        console.log(
          `WhatsApp session ${session.integrationId} reconnecting (attempt ${session.retryCount}/${MAX_RETRIES}) in ${delay}ms`
        );
        setTimeout(() => connectSocket(session, prisma), delay);
      } else {
        session.status = 'disconnected';
        session.qrCode = null;
        session.socket = null;

        await prisma.integration.update({
          where: { id: session.integrationId },
          data: { status: 'disconnected' },
        }).catch((e) => console.error('Failed to update integration status:', e));

        if (statusCode === DisconnectReason.loggedOut) {
          // Clean auth files on explicit logout
          const authPath = getAuthPath(session.integrationId);
          if (existsSync(authPath)) {
            rmSync(authPath, { recursive: true, force: true });
          }
        }
      }
    }

    if (connection === 'open') {
      session.status = 'connected';
      session.qrCode = null;
      session.retryCount = 0;

      // Extract phone number from socket
      const phoneNumber = socket.user?.id?.split(':')[0] || null;

      await prisma.integration.update({
        where: { id: session.integrationId },
        data: {
          status: 'connected',
          whatsappPhoneNumber: phoneNumber,
        },
      }).catch((e) => console.error('Failed to update integration status:', e));

      console.log(`WhatsApp session ${session.integrationId} connected (phone: ${phoneNumber})`);
    }
  });

  socket.ev.on('messages.upsert', async ({ messages: newMessages, type }) => {
    if (type !== 'notify') return;

    for (const msg of newMessages) {
      // Skip messages sent by us
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (!jid || jid === 'status@broadcast') continue;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '';

      if (!text) continue;

      const externalMessageId = msg.key.id;
      if (!externalMessageId) continue;

      try {
        // Deduplicate
        const existing = await prisma.message.findFirst({
          where: { externalMessageId },
        });
        if (existing) continue;

        // Extract phone from JID
        const phone = jid.split('@')[0];
        const contactName = msg.pushName || phone;

        // Find or create contact
        let contact = await prisma.contact.findFirst({
          where: {
            customerId: session.customerId,
            externalId: jid,
            channel: 'whatsapp',
          },
        });

        let isNewContact = false;
        if (!contact) {
          isNewContact = true;
          contact = await prisma.contact.create({
            data: {
              name: contactName,
              email: `${phone}@whatsapp.placeholder`,
              phone: `+${phone}`,
              externalId: jid,
              channel: 'whatsapp',
              status: 'new',
              customerId: session.customerId,
            },
          });
        }

        // Find or create conversation linked to this integration
        let conversation = await prisma.conversation.findFirst({
          where: {
            contactId: contact.id,
            customerId: session.customerId,
            integrationId: session.integrationId,
          },
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              channel: 'whatsapp',
              contactId: contact.id,
              customerId: session.customerId,
              integrationId: session.integrationId,
            },
          });
        }

        // Create message
        await prisma.message.create({
          data: {
            text,
            sender: 'contact',
            externalMessageId,
            conversationId: conversation.id,
          },
        });

        // Increment unread count
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            unreadCount: { increment: 1 },
            updatedAt: new Date(),
          },
        });

        // Auto-create deal for new contacts
        if (isNewContact) {
          await prisma.deal.create({
            data: {
              name: `WhatsApp Lead - ${contactName}`,
              status: 'InProgress',
              amount: 0,
              contactId: contact.id,
            },
          });
          console.log(`Auto-created deal for new WhatsApp contact: ${contactName}`);
        }
      } catch (err) {
        console.error(`Error processing WhatsApp message for ${session.integrationId}:`, err);
      }
    }
  });
}

export function getSession(integrationId: string): WhatsAppSession | undefined {
  return sessions.get(integrationId);
}

export function getQRCode(integrationId: string): { qrCode: string | null; status: string } {
  const session = sessions.get(integrationId);
  if (!session) {
    return { qrCode: null, status: 'disconnected' };
  }
  return { qrCode: session.qrCode, status: session.status };
}

export async function disconnectSession(
  integrationId: string,
  prisma: PrismaClient
): Promise<void> {
  const session = sessions.get(integrationId);
  if (session?.socket) {
    try {
      session.socket.end(undefined);
    } catch (e) {
      // Ignore close errors
    }
  }

  // Clean auth files
  const authPath = getAuthPath(integrationId);
  if (existsSync(authPath)) {
    rmSync(authPath, { recursive: true, force: true });
  }

  sessions.delete(integrationId);

  await prisma.integration.update({
    where: { id: integrationId },
    data: {
      status: 'disconnected',
      whatsappPhoneNumber: null,
    },
  }).catch((e) => console.error('Failed to update integration status:', e));
}

export async function sendWhatsAppMessage(
  integrationId: string,
  jid: string,
  text: string
): Promise<{ messageId: string | null }> {
  const session = sessions.get(integrationId);
  if (!session?.socket || session.status !== 'connected') {
    throw new Error('WhatsApp session not connected');
  }

  const result = await session.socket.sendMessage(jid, { text });
  return { messageId: result?.key?.id || null };
}

export async function reconnectAllSessions(prisma: PrismaClient): Promise<void> {
  const connectedIntegrations = await prisma.integration.findMany({
    where: {
      channel: 'whatsapp',
      status: 'connected',
      userId: { not: null },
    },
  });

  console.log(`Reconnecting ${connectedIntegrations.length} WhatsApp sessions...`);

  for (const integration of connectedIntegrations) {
    if (integration.userId) {
      try {
        await startSession(integration.id, integration.customerId, integration.userId, prisma);
      } catch (err) {
        console.error(`Failed to reconnect WhatsApp session ${integration.id}:`, err);
      }
    }
  }
}

export async function disconnectAllSessions(): Promise<void> {
  for (const [, session] of sessions) {
    if (session.socket) {
      try {
        session.socket.end(undefined);
      } catch (e) {
        // Ignore
      }
    }
  }
  sessions.clear();
}
