import { buildApp } from './app.ts';
import { resolveListenOptions } from './config.ts';

// Entry point (`npm start`). Binds to 127.0.0.1 by default so the single-user
// service is not exposed on the network unless HOST is set explicitly.
// An empty PORT or HOST counts as unset (R23).
const { port, host } = resolveListenOptions(process.env);

const app = buildApp({ logger: true });

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
