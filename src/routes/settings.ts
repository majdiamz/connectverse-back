import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '../index.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// Get Business Info
router.get('/business-info', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    let businessInfo = await prisma.businessInfo.findUnique({
      where: { customerId: req.user!.customerId || undefined },
    });

    // Create default if doesn't exist
    if (!businessInfo) {
      businessInfo = await prisma.businessInfo.create({
        data: {
          customerId: req.user!.customerId || undefined,
          companyName: 'ConnectVerse Inc.',
          address: '123 Main Street, Anytown, USA 12345',
          phone: '+1 (555) 123-4567',
          email: 'contact@connectverse.com',
        },
      });
    }

    res.json({
      companyName: businessInfo.companyName,
      address: businessInfo.address,
      phone: businessInfo.phone,
      email: businessInfo.email,
    });
  } catch (error) {
    console.error('Get business info error:', error);
    res.status(500).json({ error: 'Failed to get business info' });
  }
});

// Update Business Info
router.put(
  '/business-info',
  authenticateToken,
  [
    body('companyName').optional().trim().notEmpty(),
    body('address').optional().trim(),
    body('phone').optional().trim(),
    body('email').optional().isEmail().normalizeEmail(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { companyName, address, phone, email } = req.body;

    try {
      const businessInfo = await prisma.businessInfo.upsert({
        where: { customerId: req.user!.customerId || undefined },
        update: {
          ...(companyName && { companyName }),
          ...(address !== undefined && { address }),
          ...(phone !== undefined && { phone }),
          ...(email && { email }),
        },
        create: {
          customerId: req.user!.customerId || undefined,
          companyName: companyName || 'ConnectVerse Inc.',
          address: address || null,
          phone: phone || null,
          email: email || null,
        },
      });

      res.json({
        companyName: businessInfo.companyName,
        address: businessInfo.address,
        phone: businessInfo.phone,
        email: businessInfo.email,
      });
    } catch (error) {
      console.error('Update business info error:', error);
      res.status(500).json({ error: 'Failed to update business info' });
    }
  }
);

export default router;
