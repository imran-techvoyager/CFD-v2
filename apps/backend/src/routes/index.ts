import { Router } from "express";
import { userRouter } from "./userRouter";
import { tradeRouter } from "./tradeRouter";
import { candleRouter } from "./candleRouter";

export const router = Router();

router.use('/auth', userRouter);
router.use('/trade', tradeRouter);
router.use('/candles', candleRouter);