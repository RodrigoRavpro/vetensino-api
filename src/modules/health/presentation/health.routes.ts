import { Router } from 'express';
import type { GetHealthStatusUseCase } from '../application/GetHealthStatusUseCase';
import { asyncHandler } from '../../../shared/http/asyncHandler';

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Estado do serviço e das dependências
 *     tags: [Health]
 *     responses:
 *       200: { description: Serviço saudável }
 *       503: { description: Alguma dependência indisponível }
 */
export const buildHealthRouter = (useCase: GetHealthStatusUseCase): Router => {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const result = await useCase.execute();
      res.status(result.status === 'ok' ? 200 : 503).json(result);
    }),
  );

  return router;
};
