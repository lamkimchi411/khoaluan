import { createPostgresPool } from '../server/postgres.js';
const pool = createPostgresPool();
try {
  const result = await pool.query(`SELECT
    (SELECT COUNT(*) FROM brands) AS brands,
    (SELECT COUNT(*) FROM posts) AS posts,
    (SELECT COUNT(*) FROM comments) AS comments,
    (SELECT COUNT(*) FROM jobs) AS jobs`);
  console.log(JSON.stringify(result.rows[0]));
} finally { await pool.end(); }
