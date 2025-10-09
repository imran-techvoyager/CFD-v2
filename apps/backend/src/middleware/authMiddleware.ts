import type { Request, Response, NextFunction } from "express";
import jwt from 'jsonwebtoken';
import { jwtPassword } from "../config";

declare global{
    namespace Express{
        interface Request{
            userId?: string;
        }
    }
}

interface MyJwtPayload extends jwt.JwtPayload{
    id: string;
} 

export async function authMiddleware(req: Request, res: Response, next: NextFunction){
               const token = req.headers.authorization;

               if(!token){
                return res.status(400).json({
                    msg: "error authenticating"
                })
               }

               if(!jwtPassword){
                throw new Error('jwt password required');
               }

               try {
                const decoded = jwt.verify(token, jwtPassword) as MyJwtPayload
                req.userId = decoded.id;
                next();
               } catch (error) {
                res.status(500).json({
                    msg: "internal server error"
               })
               }
}