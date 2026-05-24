# SupFile-API

A modern TypeScript-based REST API built with Express.js, featuring robust middleware support, CORS configuration, and production-ready error handling.

## 📋 Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [API Routes](#api-routes)
- [Development](#development)
- [License](#license)

## ✨ Features

- **TypeScript Support**: Full TypeScript support with strict type checking
- **Express.js**: Modern web framework for building APIs
- **CORS Enabled**: Configured CORS support for cross-origin requests
- **Compression**: Gzip compression for response optimization
- **Cookie Parser**: Built-in cookie parsing functionality
- **Body Parser**: Efficient JSON request body parsing
- **Error Handling**: Centralized error handling middleware
- **Environment Configuration**: Flexible configuration via environment variables
- **Development Ready**: Nodemon for automatic server restart during development

## 📦 Prerequisites

- **Node.js** (v14 or higher)
- **npm** or **yarn** package manager

## 🚀 Installation

1. Clone the repository:
```bash
git clone https://github.com/adnar19/SupFile-API.git
cd SupFile-API
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```bash
cp .env.example .env
```

4. Configure your environment variables (see [Configuration](#configuration) section)

## ⚙️ Configuration

Create a `.env` file in the root directory with the following environment variables:

```env
# Server Configuration
PORT=8080
NODE_ENV=development

# Client Configuration
CLIENT_URL=http://localhost:3000
```

### Environment Variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port number | `8080` |
| `NODE_ENV` | Environment mode (development/production) | `development` |
| `CLIENT_URL` | Frontend URL for CORS | `http://localhost:3000` |

## 💻 Usage

### Development

Start the development server with automatic reload:

```bash
npm start
```

The server will run on `http://localhost:8080` (or your configured PORT)

### Production

Build the TypeScript files and run:

```bash
npm run build
npm run start:prod
```

## 📁 Project Structure

```
SupFile-API/
├── src/
│   ├── index.ts              # Application entry point
│   ├── controllers/          # Request handlers
│   ├── models/              # Data models
│   ├── routes/              # API route definitions
│   ├── services/            # Business logic
│   └── utils/               # Utility functions
├── .env                     # Environment variables (not in repo)
├── .gitignore              # Git ignore file
├── nodemon.json            # Nodemon configuration
├── package.json            # Project dependencies
├── tsconfig.json           # TypeScript configuration
└── README.md               # This file
```

### Directory Descriptions:

- **controllers/**: Handles incoming HTTP requests and sends responses
- **models/**: Defines data structures and database schemas
- **routes/**: Defines API endpoint routes
- **services/**: Contains business logic and data access operations
- **utils/**: Utility functions and helpers

## 🛣️ API Routes

All API routes are prefixed with `/api`. 

Example:
```
GET  /api/users
POST /api/users
GET  /api/users/:id
PUT  /api/users/:id
DELETE /api/users/:id
```

## 🔧 Development

### Available Scripts

```bash
# Start development server with auto-reload
npm start

# Run tests
npm test
```

### Middleware Stack

1. **CORS**: Enabled for cross-origin requests from `CLIENT_URL`
2. **Compression**: Gzip compression for responses
3. **Cookie Parser**: Parse incoming cookies
4. **Body Parser**: Parse JSON request bodies (max 10mb)
5. **Logging**: Request logging middleware
6. **Routes**: API route handlers

## 📝 Response Format

### Success Response

```json
{
  "success": true,
  "data": {},
  "message": "Operation successful"
}
```

### Error Response

```json
{
  "error": "Error message",
  "message": "Detailed error description",
  "path": "/api/endpoint",
  "method": "GET"
}
```

## 🔐 Security Features

- **CORS Protection**: Configured to accept requests only from specified origin
- **Request Size Limit**: Limited to 10MB to prevent abuse
- **Error Sanitization**: Detailed errors in development, generic in production
- **HTTP Method Filtering**: Only GET, POST, PUT, DELETE allowed

## 📚 Dependencies

### Production
- **express**: ^5.2.1 - Web framework
- **cors**: ^2.8.5 - CORS middleware
- **compression**: ^1.8.1 - Response compression
- **cookie-parser**: ^1.4.7 - Cookie parsing
- **body-parser**: ^2.2.1 - Request body parsing
- **dotenv**: ^17.2.3 - Environment variable management

### Development
- **typescript**: ^5.9.3 - TypeScript compiler
- **ts-node**: ^10.9.2 - TypeScript execution
- **nodemon**: ^3.1.11 - Auto-restart on changes
- **@types/***: Type definitions for dependencies

## 📄 License

ISC

## 👤 Author

- **Repository**: [adnar19/SupFile-API](https://github.com/adnar19/SupFile-API)


