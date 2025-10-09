import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { closeTrade, placeTrade } from "../controller/tradeController";

export const tradeRouter = Router();

tradeRouter.route('/').post(authMiddleware, placeTrade);
tradeRouter.route('/close').post(authMiddleware, closeTrade);