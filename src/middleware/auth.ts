import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    customerId: string;
  };
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // Also check for token in cookies
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      userId: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, customerId: true },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // Also check for token in cookies
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      userId: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, customerId: true },
    });

    if (user) {
      req.user = user;
    }
  } catch (error) {
    // Token invalid, but continue without auth
  }

  next();
};
