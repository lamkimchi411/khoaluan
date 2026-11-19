const pageIdPattern = /^\d{5,30}$/;

export function validateFacebookPageId(value) {
  return value === '' || (typeof value === 'string' && pageIdPattern.test(value));
}

export function createFacebookCollector(db, { registerRun, env = process.env, now = () => Date.now() } = {}) {
  let active = false;
  return {
    async collect(brand) {
      if (active) throw Error('Đã có một tác vụ thu thập đang chạy');
      if (!brand.facebook_page_id || !pageIdPattern.test(brand.facebook_page_id)) throw Error('Hãy cấu hình Facebook Page ID hợp lệ cho thương hiệu.');
      if (!env.FACEBOOK_PAGE_ACCESS_TOKEN) throw Error('Máy chủ chưa có FACEBOOK_PAGE_ACCESS_TOKEN để đọc Facebook Page.');
      active = true;
      const started = new Date(now()).toISOString();
      const job = await db.prepare('INSERT INTO jobs(brand_id,status,message,created_at) VALUES(?,?,?,?)').run(brand.id, 'running', 'Đang đọc Facebook Page qua Meta Graph API', started);
      const jobId = Number(job.lastInsertRowid);
      await registerRun(jobId);
      try {
        const version = env.FACEBOOK_GRAPH_VERSION || 'v24.0';
        const fields = 'id,message,created_time,permalink_url,shares,reactions.summary(true),comments.limit(200).summary(true){id,message,from,created_time,like_count}';
        const url = new URL(`https://graph.facebook.com/${version}/${brand.facebook_page_id}/posts`);
        url.searchParams.set('fields', fields);
        url.searchParams.set('limit', String(Math.min(Number(env.FACEBOOK_MAX_POSTS) || 30, 30)));
        url.searchParams.set('access_token', env.FACEBOOK_PAGE_ACCESS_TOKEN);
        const response = await fetch(url);
        const payload = await response.json();
        if (!response.ok) throw Error(payload?.error?.message || 'Meta Graph API không thể đọc Facebook Page.');
        const posts = (payload.data || []).map(post => ({
          video_id: `facebook:${post.id}`, platform: 'facebook', caption: post.message || '', author: brand.name,
          author_nickname: brand.name, views: null, likes: post.reactions?.summary?.total_count ?? null,
          shares: post.shares?.count ?? null, saves: null, comment_count: post.comments?.summary?.total_count ?? post.comments?.data?.length ?? 0,
          video_url: post.permalink_url || `https://www.facebook.com/${post.id}`, published_at: post.created_time || null,
          collection_method: 'meta_graph_api', comments: (post.comments?.data || []).map(comment => ({
            id: String(comment.id), text: comment.message || '', author: comment.from?.name || '', author_nickname: comment.from?.name || '',
            like_count: comment.like_count ?? 0, published_at: comment.created_time || null
          }))
        }));
        const apiBase = env.BACKEND_URL || `http://127.0.0.1:${env.PORT || 3001}`;
        const ingest = await fetch(`${apiBase}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(env.INGEST_TOKEN ? { Authorization: `Bearer ${env.INGEST_TOKEN}` } : {}) }, body: JSON.stringify({ brand_id: brand.id, job_id: jobId, posts }) });
        const result = await ingest.json();
        if (!ingest.ok) throw Error(result.error || 'Không thể lưu dữ liệu Facebook.');
        await db.prepare('UPDATE jobs SET status=?,message=?,report=?,finished_at=? WHERE id=?').run('completed', `Đã lưu ${result.saved} bài từ Facebook Page`, JSON.stringify({ mode: 'facebook_page', discovered: posts.length, saved_posts: result.saved, saved_comments: posts.reduce((sum, post) => sum + post.comments.length, 0), posts_with_comments: posts.filter(post => post.comments.length).length }), new Date(now()).toISOString(), jobId);
        return { id: jobId, saved: result.saved };
      } catch (error) {
        await db.prepare('UPDATE jobs SET status=?,message=?,finished_at=? WHERE id=?').run('failed', error.message, new Date(now()).toISOString(), jobId);
        throw error;
      } finally { active = false; }
    }
  };
}
