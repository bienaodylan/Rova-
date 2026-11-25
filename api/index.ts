import { createApiApp } from '../server/apiApp';

// Vercel Serverless Function entry point for all /api/* routes
const app = createApiApp();

export default app;
