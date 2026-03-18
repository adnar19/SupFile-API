import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { createRequire } from 'module';


const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const options = {
  definition: {
    openapi: '3.0.0',
  info: {
    title: 'SupFile API Documentation',
    version: packageJson.version,
    description: 'API documentation for SupFile service',
  },
  components:{
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ BearerAuth: [],}],
  },
  apis: ['./routes/*.js', './models/*.js'],
};



const swaggerSpec = swaggerJSDoc(options);

const setupSwagger = (app) => {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

};

export default setupSwagger;