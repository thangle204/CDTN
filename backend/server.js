import './config/env.js';
import mongoose from 'mongoose';
import { connectDB, hasMongoConfiguration } from './config/db.js';
import { createApp } from './app.js';
import { startDatabaseConnection } from './utils/databaseStartup.js';

if (!process.env.JWT_SECRET) {
  console.error('Cần cấu hình JWT_SECRET trong backend/.env trước khi khởi động');
  process.exitCode = 1;
} else {
  const port = Number(process.env.PORT || 5000);
  let databaseStartup;
  let shuttingDown = false;
  const server = createApp().listen(port, () => {
    if (shuttingDown) return;
    console.log('SHOE STORE API: http://localhost:' + port + '/api');
    // Keep the API responsive and retry an initial DNS/network failure without
    // overlapping connection attempts or requiring a manual process restart.
    databaseStartup = startDatabaseConnection({
      connect: connectDB,
      shouldRetry: hasMongoConfiguration,
      onRetry: (delay) => console.warn('Sẽ thử kết nối lại MongoDB sau ' + delay / 1000 + ' giây'),
    });
  });
  const shutdown = (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    databaseStartup?.stop();
    server.close(async () => {
      try {
        await mongoose.disconnect();
      } catch {
        console.error('Không đóng được kết nối MongoDB');
        exitCode = 1;
      }
      process.exit(exitCode);
    });
  };
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE'
      ? 'Không khởi động được API: cổng ' + port + ' đang được sử dụng'
      : 'Không khởi động được API');
    shutdown(1);
  });
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
}
