import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import {
  closeTrade,
  getClosedTrades,
  getOpenTrades,
  modifyTrade,
  placeTrade,
} from "../controller/tradeController";

export const tradeRouter = Router();

tradeRouter.route("/").post(authMiddleware, placeTrade);
tradeRouter.route("/close").post(authMiddleware, closeTrade);
tradeRouter.route("/modify").post(authMiddleware, modifyTrade);
tradeRouter.route("/open").get(authMiddleware, getOpenTrades);
tradeRouter.route("/").get(authMiddleware, getClosedTrades);
