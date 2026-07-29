import { Router } from "express";
import {
  meController,
  signinController,
  signupController,
} from "../controller/authController";
import { authMiddleware } from "../middleware/authMiddleware";
import { rateLimit } from "../middleware/rateLimit";

export const userRouter = Router();

// brute-force protection on credential endpoints
const authLimiter = rateLimit({ windowMs: 60_000, max: 20 });

userRouter.route("/signup").post(authLimiter, signupController);
userRouter.route("/signin").post(authLimiter, signinController);
userRouter.route("/me").get(authMiddleware, meController);
