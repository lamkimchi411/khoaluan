import { Pool } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';

export function createPostgresPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('Thiếu DATABASE_URL trong backend/.env');
  const connection = new URL(url);
  // Explicit TLS settings must not be overwritten by connection-string options.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) connection.searchParams.delete(key);
  return new Pool({ connectionString: connection.toString(), ssl: { rejectUnauthorized: true },
    enableChannelBinding: true, max: 5, connectionTimeoutMillis: 20000 });
}

export function postgresSql(sql) {
  let parameter = 0;
  // Preserve quoted strings/identifiers while replacing application's placeholders.
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, token => token === '?' ? `$${++parameter}` : token)
    .replace(/\bs\.enabled=1\b/g, 's.enabled=true');
}

export function normalizePostgresRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value instanceof Date) return [key, value.toISOString()];
    if (['id','brand_id','post_id','views','likes','comment_count','shares','saves','like_count'].includes(key)
      && typeof value === 'string' && /^-?\d+$/.test(value)) {
      // Comment IDs remain exact strings; only relational/numeric fields convert.
      if (key === 'id' && 'post_id' in row) return [key, value];
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw Error(`Giá trị ${key} vượt giới hạn số nguyên an toàn`);
      return [key, number];
    }
    return [key, value];
  }));
}

export async function createPostgresDatabase({ url = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL, schema = 'public' } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw Error('Schema không hợp lệ');
  const pool = createPostgresPool(url);
  const context = new AsyncLocalStorage();
  async function withConnection(work) {
    const existing = context.getStore();
    if (existing) return work(existing);
    const client = await pool.connect();
    try { return await work(client); } finally { client.release(); }
  }
  async function query(sql, args = []) {
    if (/INSERT INTO crawl_schedules\(brand_id,enabled,/i.test(sql)) args = args.map((value, i) => i === 1 ? Boolean(value) : value);
    const result = await withConnection(async client => {
      if (context.getStore() || schema === 'public') return client.query(postgresSql(sql), args);
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL search_path TO "${schema}"`);
        const result = await client.query(postgresSql(sql), args);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
    const results = Array.isArray(result) ? result : [result];
    return { rows: results.flatMap(r => r.rows.map(normalizePostgresRow)), rowCount: results.reduce((n,r) => n + (r.rowCount || 0), 0) };
  }
  const db = {
    kind: 'postgres',
    prepare(sql) {
      return {
        async all(...args) { return (await query(sql, args)).rows; },
        async get(...args) { return (await query(sql, args)).rows[0]; },
        async run(...args) {
          const insert = /^\s*INSERT INTO (brands|posts|alerts|jobs|tickets|staff|ticket_actions|ticket_responses)\b/i.test(sql);
          const result = await query(insert && !/\bRETURNING\b/i.test(sql) ? `${sql} RETURNING id` : sql, args);
          return { lastInsertRowid: result.rows[0]?.id, changes: result.rowCount };
        },
      };
    },
    exec: sql => query(sql),
    async transaction(work) {
      return withConnection(async client => {
        await client.query('BEGIN');
        try {
          await client.query(`SET LOCAL search_path TO "${schema}"`);
          const result = await context.run(client, work);
          await client.query('COMMIT');
          return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
    },
    close: () => pool.end(),
  };
  try {
    await db.exec(readFileSync(new URL('../sql/schema.postgres.sql', import.meta.url), 'utf8'));
    return db;
  } catch (error) { await pool.end(); throw error; }
}
