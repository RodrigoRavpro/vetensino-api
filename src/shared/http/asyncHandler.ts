import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Encaminha rejeições de handlers async para o middleware de erro do Express 4. */
export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };
