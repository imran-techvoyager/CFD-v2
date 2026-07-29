import { Router } from "express";
import { getCandles } from "../controller/candleController";

export const candleRouter = Router();

// public market data — the chart needs it before/without auth
candleRouter.route("/").get(getCandles);
