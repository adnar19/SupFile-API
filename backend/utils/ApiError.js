/**
 * Classe d'erreur personnalisée pour l'API
 */
export class ApiError extends Error {
  constructor(statusCode, message, isOperational = true, stack = '') {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Erreurs HTTP courantes
 */
export const ErrorTypes = {
  // 400 - Bad Request
  BadRequest: (message = 'Bad request') => new ApiError(400, message),
  
  // 401 - Unauthorized
  Unauthorized: (message = 'Authentication required') => new ApiError(401, message),
  
  // 403 - Forbidden
  Forbidden: (message = 'Access forbidden') => new ApiError(403, message),
  
  // 404 - Not Found
  NotFound: (message = 'Resource not found') => new ApiError(404, message),
  
  // 409 - Conflict
  Conflict: (message = 'Resource already exists') => new ApiError(409, message),
  
  // 422 - Unprocessable Entity
  ValidationError: (message = 'Validation failed') => new ApiError(422, message),
  
  // 500 - Internal Server Error
  InternalError: (message = 'Internal server error') => new ApiError(500, message),
};

export default ApiError;