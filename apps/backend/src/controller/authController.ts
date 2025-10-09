import type { Request, Response } from "express";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { authSchema, type FinalSchema } from "../types/types";
import prismaClient from "@repo/db/client";
import { jwtPassword } from "../config";
import { toInternalUsd } from "../utils";

export async function signupController(req: Request, res: Response){

    console.log("inside the signup controler");

        const {success} = authSchema.safeParse(req.body);

        if(!success){
            return res.status(400).json({
                msg: "invalid input format"
            })
        }

        const body: FinalSchema = req.body;

        const existingUser = await prismaClient.user.findUnique({
            where: {
                email: body.email
            }
        });

        if(existingUser){
            return res.status(400).json({
                msg: "user already exists"
            });
        }

        const hashPassword = await bcrypt.hash(body.password, 10);

        try {
            await prismaClient.user.create({
                data: {
                    email: body.email,
                    password: hashPassword,
                    balance: toInternalUsd(5000),
                }
            });

            res.status(200).json({
                msg: "signup successful!"
            });

        } catch (e) {
            console.log(e);
            res.status(500).json({
                msg: "internal server error"
            });
        }
}

export async function signinController(req: Request, res: Response){
       try {const {success} = authSchema.safeParse(req.body);

        if(!success){
            return res.status(400).json({
                msg: "invalid input format"
            });
        }

        const body: FinalSchema = req.body;

        const user = await prismaClient.user.findUnique({
            where: {
                email: body.email
            }
        });

        console.log(user);

        if(!user){
            return res.status(400).json({
                msg: "please signup"
            });
        }

        const hashedPassword = await bcrypt.compare(body.password, user.password);

        console.log(hashedPassword);

        if(!jwtPassword){
            throw new Error('required jwt password');
        }

        if(hashedPassword){
            const token = jwt.sign({id: user.id}, jwtPassword);

            res.status(200).json({
                msg: "signin successful",
                token
            });
        }else{
            res.status(400).json({
                msg: "incorrect credentials"
            });
        }} catch (e){
            console.log("error", e);
            res.status(500).json({
                msg: "internal server error"
            })
        }
}