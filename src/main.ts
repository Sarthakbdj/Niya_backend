import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend communication
  app.enableCors({
    origin: [
      'http://localhost:8080',
      'http://localhost:8081',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:5173',
      'https://gurukul-v1-frontend.vercel.app',
      'https://niya-frontend.onrender.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cache-Control',
      'Pragma',
    ],
    credentials: true,
  });

  const port = process.env.PORT || 3002;
  console.log(`🚀 Application starting on port ${port}`);
  console.log(`🔌 WebSocket server on port 3001`);
  await app.listen(port);
}
void bootstrap();
