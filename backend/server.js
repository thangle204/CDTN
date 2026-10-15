import './config/env.js';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';

if (!process.env.JWT_SECRET) {
  console.error('Cần cấu hình JWT_SECRET trong backend/.env trước khi khởi động');
  process.exitCode = 1;
} else {
  const port = Number(process.env.PORT || 5000);
  const server = createApp().listen(port, () => console.log('SHOE STORE API: http://localhost:' + port + '/api'));
  // Keep the API responsive while MongoDB DNS/connection attempts are pending.
  void connectDB();
  const shutdown = () => {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
