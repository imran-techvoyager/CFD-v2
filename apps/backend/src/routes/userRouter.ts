import { Router } from "express";
import { signinController, signupController } from "../controller/authController";

export const userRouter = Router();

console.log("in userRouter room")

userRouter.route('/signup').post(signupController);
userRouter.route('/signin').post(signinController);