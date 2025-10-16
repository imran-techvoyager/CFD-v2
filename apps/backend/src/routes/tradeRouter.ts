import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { closeTrade, getClosedTrades, placeTrade } from "../controller/tradeController";

export const tradeRouter = Router();

tradeRouter.route('/').post(authMiddleware, placeTrade);
tradeRouter.route('/close').post(authMiddleware, closeTrade);
tradeRouter.route('/').get(authMiddleware, getClosedTrades);