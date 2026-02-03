import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SupFile API Documentation',
      version: '1.0.0',
      description: 'API documentation for SupFile service',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  // Vérifie bien que ce chemin pointe vers tes fichiers de routes
  apis: ['./routes/*.js'], 
};

const specs = swaggerJsdoc(options);

// AJOUTE BIEN "export" DEVANT LA FONCTION
export const setupSwagger = (app, port) => {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs));
};