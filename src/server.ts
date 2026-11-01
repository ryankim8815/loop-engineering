import { buildApp } from './app.ts';

// Entry point (`npm start`). Binds to 127.0.0.1 by default so the single-user
// service is not exposed on the network unless HOST is set explicitly.
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const app = buildApp({ logger: true });

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
