import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { jwtPassword } from "../config";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

interface MyJwtPayload extends jwt.JwtPayload {
  id: string;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ msg: "authentication required" });
  }

  const token = header.startsWith("Bearer ") ? header.slice(7) : header;

  try {
    const decoded = jwt.verify(token, jwtPassword) as MyJwtPayload;
    req.userId = decoded.id;
    next();
  } catch (error) {
    res.status(401).json({ msg: "invalid or expired token" });
  }
}
