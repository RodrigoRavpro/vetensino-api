/**
 * Erros de aplicação carregam status HTTP e um código estável para o cliente.
 * `expose` distingue mensagens seguras para o usuário de detalhes internos.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
    readonly code: string = 'BAD_REQUEST',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Dados inválidos', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Não autenticado') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado', details?: unknown) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflito de estado') {
    super(message, 409, 'CONFLICT');
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Muitas requisições. Tente novamente em instantes.') {
    super(message, 429, 'TOO_MANY_REQUESTS');
  }
}
