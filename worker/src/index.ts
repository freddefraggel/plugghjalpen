import { DurableObject } from 'cloudflare:workers';
import { handle, type Env as HandlerEnv, type QuotaStore } from './handler';

interface Env extends HandlerEnv {
  QUOTA: DurableObjectNamespace<Quota>;
}

/** En enda Durable Object (SQLite) som räknar anrop per enhet och klasskod och dygn. */
export class Quota extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS counts (key TEXT PRIMARY KEY, n INTEGER NOT NULL, day TEXT NOT NULL)');
  }

  async take(entries: { key: string; limit: number }[]): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    const day = new Date().toISOString().slice(0, 10);
    // Städa bort gamla dygn då och då.
    sql.exec('DELETE FROM counts WHERE day < ?', day);
    for (const { key, limit } of entries) {
      const row = sql.exec<{ n: number }>('SELECT n FROM counts WHERE key = ?', key).toArray()[0];
      if (row && row.n >= limit) return false;
    }
    for (const { key } of entries) {
      sql.exec('INSERT INTO counts (key, n, day) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1', key, day);
    }
    return true;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const stub = env.QUOTA.get(env.QUOTA.idFromName('global'));
    const quota: QuotaStore = { take: (entries) => stub.take(entries) };
    return handle(req, env, quota);
  },
} satisfies ExportedHandler<Env>;
