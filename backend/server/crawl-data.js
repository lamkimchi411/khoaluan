// Track provenance separately from deduplicated posts/comments. Source 0 means
// legacy data or an import outside the crawler and must never be deleted here.
export async function createCrawlData(db) {
  const commentId = db.kind === 'mysql' ? 'VARCHAR(191) COLLATE utf8mb4_bin' : 'TEXT';
  const suffix = db.kind === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS crawl_data_runs(job_id BIGINT PRIMARY KEY, deleted_at VARCHAR(40))',
    'CREATE TABLE IF NOT EXISTS crawl_post_sources(post_id BIGINT NOT NULL, job_id BIGINT NOT NULL, PRIMARY KEY(post_id,job_id), FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE, FOREIGN KEY(job_id) REFERENCES crawl_data_runs(job_id))',
    `CREATE TABLE IF NOT EXISTS crawl_comment_sources(comment_id ${commentId} NOT NULL, post_id BIGINT NOT NULL, job_id BIGINT NOT NULL, PRIMARY KEY(comment_id,post_id,job_id), FOREIGN KEY(comment_id,post_id) REFERENCES comments(id,post_id) ON DELETE CASCADE, FOREIGN KEY(job_id) REFERENCES crawl_data_runs(job_id))`,
  ]) await db.exec(sql + suffix);
  await db.prepare('INSERT INTO crawl_data_runs(job_id) VALUES(0) ON CONFLICT(job_id) DO UPDATE SET job_id=excluded.job_id').run();
  // App currently supports one backend/worker. Serialize destructive operations
  // with ingestion and worker startup, including SQLite's single connection.
  let pending = Promise.resolve();
  function exclusive(work) {
    const result = pending.then(work);
    pending = result.catch(() => {});
    return result;
  }
  const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
  async function register(jobId) {
    await db.prepare('INSERT INTO crawl_data_runs(job_id) VALUES(?)').run(jobId);
  }
  async function validateIngest(jobId, brandId) {
    if (jobId == null) return 0;
    if (!Number.isSafeInteger(jobId) || jobId <= 0) fail('job_id không hợp lệ', 400);
    const job = await db.prepare('SELECT j.*,r.deleted_at FROM jobs j JOIN crawl_data_runs r ON r.job_id=j.id WHERE j.id=?').get(jobId);
    if (!job || Number(job.brand_id) !== Number(brandId) || job.status !== 'running' || job.deleted_at) fail('Lượt quét không hợp lệ, đã kết thúc hoặc đã xoá', 400);
    return jobId;
  }
  async function recordPost(jobId, postId, existed) {
    if (existed && !(await db.prepare('SELECT job_id FROM crawl_post_sources WHERE post_id=? LIMIT 1').get(postId))) {
      await db.prepare('INSERT INTO crawl_post_sources(post_id,job_id) VALUES(?,0)').run(postId);
    }
    await db.prepare('INSERT INTO crawl_post_sources(post_id,job_id) VALUES(?,?) ON CONFLICT(post_id,job_id) DO UPDATE SET job_id=excluded.job_id').run(postId,jobId);
  }
  async function recordComment(jobId, postId, commentId, existed) {
    if (existed && !(await db.prepare('SELECT job_id FROM crawl_comment_sources WHERE post_id=? AND comment_id=? LIMIT 1').get(postId,commentId))) {
      await db.prepare('INSERT INTO crawl_comment_sources(comment_id,post_id,job_id) VALUES(?,?,0)').run(commentId,postId);
    }
    await db.prepare('INSERT INTO crawl_comment_sources(comment_id,post_id,job_id) VALUES(?,?,?) ON CONFLICT(comment_id,post_id,job_id) DO UPDATE SET job_id=excluded.job_id').run(commentId,postId,jobId);
  }
  async function removeHistories(jobIds) {
    return exclusive(() => db.transaction(async () => {
      const jobs=[];
      for (const jobId of jobIds) {
        const job=await db.prepare('SELECT j.*,r.job_id AS tracked_job_id FROM jobs j LEFT JOIN crawl_data_runs r ON r.job_id=j.id WHERE j.id=?').get(jobId);
        if (!job) fail('Không tìm thấy lượt quét', 404);
        if (job.status === 'running') fail('Không thể xoá lịch sử của lượt quét đang chạy.');
        jobs.push(job);
      }
      for (const job of jobs) {
        // Only provenance is removed. Posts and comments remain available in the dashboard.
        if (job.tracked_job_id) {
          await db.prepare('DELETE FROM crawl_comment_sources WHERE job_id=?').run(job.id);
          await db.prepare('DELETE FROM crawl_post_sources WHERE job_id=?').run(job.id);
          await db.prepare('DELETE FROM crawl_data_runs WHERE job_id=?').run(job.id);
        }
        await db.prepare('DELETE FROM jobs WHERE id=?').run(job.id);
      }
      return { deleted_job_ids: jobs.map(job=>job.id) };
    }));
  }
  return { exclusive, register, validateIngest, recordPost, recordComment, removeHistories };
}
