// Extends Express's Request interface to include the userId property
// added by authMiddleware after verifying the Supabase JWT.
declare namespace Express {
  interface Request {
    userId?: string;
  }
}
