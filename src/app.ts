import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import type { Container } from './container';
import { requireCustomHeader } from './shared/http/csrf';
import { errorHandler, notFoundHandler } from './shared/http/errorHandler';
import { corsOptions, globalRateLimiter, helmetOptions } from './shared/http/security';
import { buildHealthRouter } from './modules/health/presentation/health.routes';
import { buildStorageRoutes } from './modules/storage/presentation/storage.routes';
import { buildAuthRoutes } from './modules/auth/presentation/auth.routes';
import { buildAdminCourseRoutes } from './modules/courses/presentation/admin-course.routes';
import { buildInstructorCourseRoutes } from './modules/courses/presentation/instructor-course.routes';
import { buildAdminUserRoutes } from './modules/users/presentation/admin-user.routes';
import { buildPublicCourseRoutes } from './modules/courses/presentation/public-course.routes';
import { buildCheckoutRoutes, buildCheckoutWebhookRoutes } from './modules/checkout/presentation/checkout.routes';

export const createApp = (container: Container): Express => {
  const app = express();

  // Atrás do Nginx Proxy Manager: sem isso req.ip devolve o IP do proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet(helmetOptions));
  app.use(cors(corsOptions));
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(globalRateLimiter);

  app.use('/health', buildHealthRouter(container.useCases.getHealthStatus));

  const api = express.Router();
  api.use('/checkout/webhook', buildCheckoutWebhookRoutes());
  api.use(requireCustomHeader);
  api.use('/auth', buildAuthRoutes());
  api.use('/courses', buildPublicCourseRoutes());
  api.use('/checkout', buildCheckoutRoutes());
  api.use('/admin/courses', buildAdminCourseRoutes());
  api.use('/instructor/courses', buildInstructorCourseRoutes());
  api.use('/admin/users', buildAdminUserRoutes());
  api.use('/storage', buildStorageRoutes());
  app.use('/api/rest', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export const appConfig = { port: env.port };
