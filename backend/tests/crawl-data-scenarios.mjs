import assert from 'node:assert/strict';
import { createCrawlData } from '../server/crawl-data.js';

export async function verifyCrawlDeletion(db, request, brandId, legacyPost) {
  const data=await createCrawlData(db);
  async function job(tracked=true){
    const result=await db.prepare('INSERT INTO jobs(brand_id,status,message,created_at) VALUES(?,?,?,?)').run(brandId,'running','Integration deletion test',new Date().toISOString());
    const id=Number(result.lastInsertRowid);if(tracked)await data.register(id);return id;
  }
  const finish=id=>db.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(id);
  const send=(id,posts,brand=brandId)=>request('/ingest',{brand_id:brand,job_id:id,posts});
  const removeHistories=(ids,body={job_ids:ids,confirm_job_ids:ids})=>request('/jobs/history',body,'DELETE');
  const first=await job();
  const shared={...legacyPost,video_id:'1234567890000000091',video_url:'https://www.tiktok.com/@test/video/1234567890000000091',comments:[{id:'shared',text:'Tốt'},{id:'first-only',text:'Bình luận'}]};
  assert.equal((await send(first,[shared],brandId+999)).status,400);
  assert.equal((await send(first,[shared])).status,200);
  assert.equal((await removeHistories([first])).status,409);
  await finish(first);
  const second=await job();
  const unique={...shared,video_id:'1234567890000000092',video_url:'https://www.tiktok.com/@test/video/1234567890000000092',comments:[{id:'second-only',text:'Tốt'}]};
  assert.equal((await send(second,[{...shared,comments:shared.comments.slice(0,1)},unique])).status,200);
  await finish(second);
  assert.equal((await removeHistories([first],{})).status,400);
  assert.deepEqual((await removeHistories([first,second])).data.deleted_job_ids,[first,second]);
  const remaining=(await request(`/dashboard?brand=${brandId}&days=1`)).data;
  assert.ok(remaining.posts.some(p=>p.video_id===shared.video_id));
  assert.ok(remaining.comments.some(c=>c.id==='first-only'));
  const legacyRun=await job();
  assert.equal((await send(legacyRun,[legacyPost])).status,200);
  await finish(legacyRun);
  assert.equal((await removeHistories([legacyRun])).status,200);
  assert.equal((await request(`/dashboard?brand=${brandId}&days=1`)).data.comments.length,legacyPost.comments.length+3);
  const oldRun=await job(false);await finish(oldRun);
  assert.equal((await removeHistories([oldRun])).status,200);
  const history=(await request(`/brands/${brandId}/jobs`)).data;
  assert.ok(!history.jobs.some(j=>[first,second,legacyRun,oldRun].includes(j.id)));
  console.log('PASS: bulk history deletion preserves collected data, rejects running scans, and supports legacy runs.');
}
