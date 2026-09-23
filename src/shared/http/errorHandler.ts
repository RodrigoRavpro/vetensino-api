import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../errors/AppError';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    code: 'ROUTE_NOT_FOUND',
    message: 'Rota não encontrada',
    path: req.originalUrl,
  });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(422).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos',
      details: error.flatten().fieldErrors,
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error(error.message, { code: error.code, stack: error.stack });
    } else {
      logger.warn(error.message, { code: error.code, path: req.originalUrl });
    }

    res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  logger.error('Erro não tratado', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    path: req.originalUrl,
  });

  // Detalhe interno nunca vaza para o cliente em produção.
  res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'Erro interno do servidor',
  });
};
