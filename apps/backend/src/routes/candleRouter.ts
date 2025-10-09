import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware";
import { getCandles } from "../controller/candleController";

export const candleRouter = Router();

candleRouter.route('/').post(authMiddleware, getCandles);