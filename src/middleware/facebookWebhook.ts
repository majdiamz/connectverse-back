import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Middleware to preserve the raw body for signature validation.
 * Must be used before express.json() for webhook routes.
 */
export function preserveRawBody(
  req: RawBodyRequest,
  res: Response,
  buf: Buffer
): void {
  req.rawBody = buf;
}

/**
 * Middleware to validate the Facebook webhook signature.
 * Uses HMAC-SHA256 with the App Secret to verify the X-Hub-Signature-256 header.
 */
export function validateFacebookSignature(
  req: RawBodyRequest,
  res: Response,
  next: NextFunction
): void {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appSecret) {
    console.error('FACEBOOK_APP_SECRET is not configured');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  if (!signature) {
    console.warn('Missing X-Hub-Signature-256 header');
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  if (!req.rawBody) {
    console.error('Raw body not available for signature validation');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    console.warn('Invalid Facebook webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}
