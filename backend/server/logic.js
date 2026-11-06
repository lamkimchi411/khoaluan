export function crisis(comments, threshold, minimum = 5) {
  const total = comments.length;
  const negative = comments.filter((x) => x.sentiment === "negative").length;
  return {
    total,
    negative,
    ratio: total ? (negative / total) * 100 : 0,
    triggered: total >= minimum && (negative / total) * 100 > threshold,
  };
}
export function validatePost(p) {
  if (
    !p ||
    !/^\d{5,30}$/.test(p.video_id || "") ||
    typeof p.caption !== "string" ||
    p.caption.length > 10000
  )
    throw new Error("video_id hoặc caption không hợp lệ");
  const url = new URL(p.video_url);
  if (
    url.protocol !== "https:" ||
    !["www.tiktok.com", "tiktok.com"].includes(url.hostname)
  )
    throw new Error("Chỉ chấp nhận URL TikTok HTTPS");
  for (const key of ["views", "likes", "comment_count", "shares", "saves"])
    if (!Number.isSafeInteger(p[key] ?? 0) || (p[key] ?? 0) < 0)
      throw new Error("Chỉ số tương tác không hợp lệ");
  if (!Array.isArray(p.comments ?? []) || (p.comments?.length ?? 0) > 200)
    throw new Error("Tối đa 200 bình luận/bài");
  if(p.hashtags!=null&&(!Array.isArray(p.hashtags)||p.hashtags.length>100||p.hashtags.some(x=>typeof x!=='string'||x.length>200)))throw new Error('Hashtags không hợp lệ');
  for (const c of p.comments ?? []) {
    if (!c.id || typeof c.text !== "string" || c.text.length > 5000)
      throw new Error("Bình luận không hợp lệ");
    if(c.like_count!=null&&(!Number.isSafeInteger(c.like_count)||c.like_count<0))throw new Error('Lượt thích bình luận không hợp lệ');
    if(c.parent_id!=null&&(typeof c.parent_id!=='string'||c.parent_id.length>100))throw new Error('ID bình luận cha không hợp lệ');
  }
}
export function viralSpike(previous, current, now = Date.now()) {
  if ([previous?.likes,previous?.comment_count,current.likes,current.comment_count].some(v=>v==null))return false;
  if (
    !previous ||
    current.sentiment !== "negative" ||
    previous.source !== "live"
  )
    return false;
  const elapsed = now - Date.parse(previous.observed_at);
  const before = previous.likes + previous.comment_count;
  const after = (current.likes || 0) + (current.comment_count || 0);
  return (
    elapsed >= 0 &&
    elapsed <= 3600000 &&
    before >= 10 &&
    after >= before * 2 &&
    after - before >= 100
  );
}

// Explainable risk: negative sentiment contributes 70 points and public
// engagement contributes the remaining 30 points.
export function riskScore({ sentiment, score = 0, like_count = 0 }) {
  if (sentiment !== 'negative') return 0;
  const intensity = Math.max(0, Math.min(1, Number(score) || 0));
  const engagement = Math.max(0, Math.min(100, Number(like_count) || 0));
  return Math.round(intensity * 70 + (engagement / 100) * 30);
}

export function severityForRisk(score) {
  if (score >= 70) return { level: 'critical', queue: 'pr', sla_minutes: 15 };
  if (score >= 30) return { level: 'medium', queue: 'cskh', sla_minutes: 60 };
  return { level: 'low', queue: null, sla_minutes: null };
}
