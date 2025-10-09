import { Router } from "express";
import { userRouter } from "./userRouter";
import { tradeRouter } from "./tradeRouter";

export const router = Router();

router.use('/auth', userRouter);
router.use('/trade', tradeRouter);