// Listen settings for the server entry point (spec 03). An empty or whitespace-only value
// counts as unset, so `PORT=` or `HOST=` in a .env file keeps the defaults (R23).
// Without this, PORT='' gave port 0 (a random port) and HOST='' reached listen() unchanged,
// which binds every interface.
export interface ListenOptions {
  port: number;
  host: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

export function resolveListenOptions(env: NodeJS.ProcessEnv): ListenOptions {
  const rawPort = nonEmpty(env.PORT);
  return {
    port: rawPort === undefined ? DEFAULT_PORT : Number(rawPort),
    host: nonEmpty(env.HOST) ?? DEFAULT_HOST,
  };
}
