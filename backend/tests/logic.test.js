import test from "node:test";
import assert from "node:assert/strict";
import { crisis, validatePost, viralSpike, riskScore, severityForRisk } from "../server/logic.js";
test("crisis needs minimum volume and strictly exceeds threshold", () => {
  assert.equal(crisis([{ sentiment: "negative" }], 40).triggered, false);
  assert.equal(
    crisis(
      Array.from({ length: 5 }, (_, i) => ({
        sentiment: i < 2 ? "negative" : "neutral",
      })),
      40,
    ).triggered,
    false,
  );
  assert.equal(
    crisis(
      Array.from({ length: 5 }, (_, i) => ({
        sentiment: i < 3 ? "negative" : "neutral",
      })),
      40,
    ).triggered,
    true,
  );
  assert.equal(crisis([], 40).ratio, 0);
});
test("reject malicious URLs and invalid counters", () => {
  const p = {
    video_id: "123456789",
    caption: "hello",
    video_url: "https://www.tiktok.com/@test/video/123456789",
    comments: [],
  };
  assert.doesNotThrow(() => validatePost(p));
  assert.throws(() =>
    validatePost({ ...p, video_url: "https://tiktok.com.evil.test/" }),
  );
  assert.throws(() => validatePost({ ...p, views: -1 }));
  assert.throws(() => validatePost({ ...p, comments: [{ id: "1", text: 5 }] }));
});
test("virality requires negative content, recent observation and material growth", () => {
  const old = {
    likes: 90,
    comment_count: 10,
    source: "live",
    observed_at: new Date().toISOString(),
  };
  const current = { likes: 190, comment_count: 10, sentiment: "negative" };
  assert.equal(viralSpike(old, current), true);
  assert.equal(viralSpike(old, { ...current, sentiment: "positive" }), false);
  assert.equal(viralSpike({ ...old, source: "demo" }, current), false);
  assert.equal(
    viralSpike(
      { ...old, observed_at: new Date(Date.now() - 7200000).toISOString() },
      current,
    ),
    false,
  );
  assert.equal(viralSpike(old, { ...current, likes: 100 }), false);
});
test("risk creates only medium and critical ticket severities", () => {
  assert.equal(riskScore({ sentiment: 'positive', score: 1, like_count: 100 }), 0);
  assert.equal(severityForRisk(29).level, 'low');
  assert.deepEqual(severityForRisk(30), { level: 'medium', queue: 'cskh', sla_minutes: 60 });
  assert.deepEqual(severityForRisk(70), { level: 'critical', queue: 'pr', sla_minutes: 15 });
  assert.equal(riskScore({ sentiment: 'negative', score: 1, like_count: 100 }), 100);
});
