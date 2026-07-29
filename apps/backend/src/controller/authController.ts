import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { authSchema, type FinalSchema } from "../types/types";
import prismaClient from "@repo/db/client";
import { jwtPassword } from "../config";
import { fromInternalUsd, toInternalUsd } from "@repo/shared";

const STARTING_BALANCE_USD = 5000;

export async function signupController(req: Request, res: Response) {
  try {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ msg: "invalid input format" });
    }

    const body: FinalSchema = parsed.data;

    const existingUser = await prismaClient.user.findUnique({
      where: { email: body.email },
    });

    if (existingUser) {
      return res.status(400).json({ msg: "user already exists" });
    }

    const hashPassword = await bcrypt.hash(body.password, 10);

    const user = await prismaClient.user.create({
      data: {
        email: body.email,
        password: hashPassword,
        balance: toInternalUsd(STARTING_BALANCE_USD),
      },
    });

    const token = jwt.sign({ id: user.id }, jwtPassword, { expiresIn: "7d" });

    return res.status(200).json({
      msg: "signup successful!",
      token,
      user: {
        email: user.email,
        balance: fromInternalUsd(user.balance),
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ msg: "internal server error" });
  }
}

export async function signinController(req: Request, res: Response) {
  try {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ msg: "invalid input format" });
    }

    const body: FinalSchema = parsed.data;

    const user = await prismaClient.user.findUnique({
      where: { email: body.email },
    });

    if (!user) {
      return res.status(400).json({ msg: "please signup" });
    }

    const passwordOk = await bcrypt.compare(body.password, user.password);
    if (!passwordOk) {
      return res.status(400).json({ msg: "incorrect credentials" });
    }

    const token = jwt.sign({ id: user.id }, jwtPassword, { expiresIn: "7d" });

    return res.status(200).json({
      msg: "signin successful",
      token,
      user: {
        email: user.email,
        balance: fromInternalUsd(user.balance),
      },
    });
  } catch (e) {
    console.error("error", e);
    return res.status(500).json({ msg: "internal server error" });
  }
}

export async function meController(req: Request, res: Response) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ msg: "user not authenticated" });
    }

    const user = await prismaClient.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ msg: "user not found" });
    }

    return res.status(200).json({
      user: {
        email: user.email,
        balance: fromInternalUsd(user.balance),
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ msg: "internal server error" });
  }
}
