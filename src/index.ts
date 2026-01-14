import dotenv from 'dotenv';
dotenv.config();
import express, { Request, Response, NextFunction } from "express";
import http from "http";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";

import routes from './routes'

const app = express()

app.use(cors({
    credentials: true,
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(compression())
app.use(cookieParser())
app.use(bodyParser.json({ limit: '10mb' }))

app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use('/api', routes)
app.use((req: Request, res: Response) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.url,
        method: req.method
    })
})

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.log('Error:', err.stack);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : "Something went wrong",
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    })
})


const PORT = Number(process.env.PORT) || 8080;
const server = http.createServer(app);
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, () => {
    console.log(`Server running on http://${HOST}:${PORT}/`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
})

export default app