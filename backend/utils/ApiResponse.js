/**
 * Classe pour standardiser les réponses API
 */
export class ApiResponse {
  constructor(statusCode, data, message = 'Success') {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
  }
}

/**
 * Réponses HTTP courantes
 */
export const ResponseTypes = {
  // 200 - OK
  Success: (data, message = 'Success') => new ApiResponse(200, data, message),
  
  // 201 - Created
  Created: (data, message = 'Resource created') => new ApiResponse(201, data, message),
  
  // 204 - No Content
  NoContent: (message = 'No content') => new ApiResponse(204, null, message),
};

export default ApiResponse;