import type { NextFunction, Request, Response } from "express";
import { supabase } from "./lib/client";


export async function authMiddleware(req: Request, res: Response, next: NextFunction) {

    const token = req.headers.authorization;

    if(!token) {
        res.status(403).json({
            message: "Unauthorized"
        })
    }

    const {data, error} = await supabase.auth.getClaims(token)

    if(error){
        res.status(403).json({
            message: "Unauthorized"
        })
        return;
    }

    const userId = data?.claims.sub
    req.userId = userId;

    next();

    
}