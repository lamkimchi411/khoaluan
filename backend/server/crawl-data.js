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
  async function inspect(jobId) {
    const job = await db.prepare('SELECT j.*,r.job_id AS tracked_job_id,r.deleted_at FROM jobs j LEFT JOIN crawl_data_runs r ON r.job_id=j.id WHERE j.id=?').get(jobId);
    if (!job) fail('Không tìm thấy lượt quét',404);
    if (!job.tracked_job_id) return { job_id: jobId, tracked: false, can_delete: false, reason: 'Lượt quét cũ chưa có liên kết dữ liệu; không thể xoá riêng an toàn.' };
    const posts = await db.prepare('SELECT s.post_id FROM crawl_post_sources s WHERE s.job_id=? AND NOT EXISTS (SELECT 1 FROM crawl_post_sources other WHERE other.post_id=s.post_id AND other.job_id<>?)').all(jobId,jobId);
    const comments = await db.prepare('SELECT s.comment_id,s.post_id FROM crawl_comment_sources s WHERE s.job_id=? AND NOT EXISTS (SELECT 1 FROM crawl_comment_sources other WHERE other.comment_id=s.comment_id AND other.post_id=s.post_id AND other.job_id<>?)').all(jobId,jobId);
    const totalPosts = Number((await db.prepare('SELECT COUNT(*) AS total FROM crawl_post_sources WHERE job_id=?').get(jobId)).total);
    const totalComments = Number((await db.prepare('SELECT COUNT(*) AS total FROM crawl_comment_sources WHERE job_id=?').get(jobId)).total);
    // Keep a post if any comment is not exclusive to this run (including legacy).
    const deletablePosts = [];
    for (const post of posts) {
      const retained = await db.prepare('SELECT c.id FROM comments c WHERE c.post_id=? AND (NOT EXISTS (SELECT 1 FROM crawl_comment_sources s WHERE s.post_id=c.post_id AND s.comment_id=c.id AND s.job_id=?) OR EXISTS (SELECT 1 FROM crawl_comment_sources s WHERE s.post_id=c.post_id AND s.comment_id=c.id AND s.job_id<>?)) LIMIT 1').get(post.post_id,jobId,jobId);
      if (!retained) deletablePosts.push(post);
    }
    const running = await db.prepare("SELECT id FROM jobs WHERE brand_id=? AND status='running' LIMIT 1").get(job.brand_id);
    return { job_id: jobId, tracked: true, deleted_at: job.deleted_at,
      can_delete: !job.deleted_at && !running,
      reason: job.deleted_at ? 'Dữ liệu lượt này đã được xoá.' : running ? 'Chờ lượt quét đang chạy của thương hiệu kết thúc.' : '',
      posts: deletablePosts.length, comments: comments.length,
      retained_posts: totalPosts-deletablePosts.length, retained_comments: totalComments-comments.length,
      postRows: deletablePosts, commentRows: comments };
  }
  async function preview(jobId) {
    const { postRows, commentRows, ...summary } = await inspect(jobId);
    return summary;
  }
  async function remove(jobId) {
    return exclusive(() => db.transaction(async () => {
      const summary = await inspect(jobId);
      if (summary.deleted_at) return { already_deleted: true, posts: 0, comments: 0 };
      if (!summary.can_delete) fail(summary.reason);
      // Delete only rows selected by provenance, never by date ranges/video report.
      await db.prepare('DELETE FROM comments WHERE EXISTS (SELECT 1 FROM crawl_comment_sources s WHERE s.comment_id=comments.id AND s.post_id=comments.post_id AND s.job_id=?) AND NOT EXISTS (SELECT 1 FROM crawl_comment_sources s WHERE s.comment_id=comments.id AND s.post_id=comments.post_id AND s.job_id<>?)').run(jobId,jobId);
      await db.prepare('DELETE FROM posts WHERE EXISTS (SELECT 1 FROM crawl_post_sources s WHERE s.post_id=posts.id AND s.job_id=?) AND NOT EXISTS (SELECT 1 FROM crawl_post_sources s WHERE s.post_id=posts.id AND s.job_id<>?) AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id=posts.id)').run(jobId,jobId);
      await db.prepare('DELETE FROM crawl_comment_sources WHERE job_id=?').run(jobId);
      await db.prepare('DELETE FROM crawl_post_sources WHERE job_id=?').run(jobId);
      await db.prepare('UPDATE crawl_data_runs SET deleted_at=? WHERE job_id=?').run(new Date().toISOString(),jobId);
      return { posts: summary.posts, comments: summary.comments, retained_posts: summary.retained_posts, retained_comments: summary.retained_comments };
    }));
  }
  return { exclusive, register, validateIngest, recordPost, recordComment, preview, remove };
}
