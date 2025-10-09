import z from 'zod';

export const authSchema = z.object({
    email: z.string().email().min(3).max(100),
    password: z.string().min(8).max(50)
});

export type FinalSchema = z.infer<typeof authSchema>;

export type CloseOrderReason = "take_profit" | "stop_loss" | "liquidation" | "manual";

export const tradeSchema = z.object({
    asset: z.enum(["BTC", "ETH", "SOL"]),
    type: z.enum(["buy", "sell"]),
    margin: z.number().positive(),
    leverage: z.union([
        z.literal(1),
        z.literal(5),
        z.literal(10),
        z.literal(20),
        z.literal(50),
        z.literal(100),
    ]),
    takeprofit: z.number().positive().optional(),
    stoploss: z.number().positive().optional(),
});