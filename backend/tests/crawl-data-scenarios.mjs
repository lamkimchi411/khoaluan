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
  const remove=(id,body={confirm_job_id:id})=>request(`/jobs/${id}/data`,body,'DELETE');
  const first=await job();
  const shared={...legacyPost,video_id:'1234567890000000091',video_url:'https://www.tiktok.com/@test/video/1234567890000000091',comments:[{id:'shared',text:'Tốt'},{id:'first-only',text:'Bình luận'}]};
  assert.equal((await send(first,[shared],brandId+999)).status,400);
  assert.equal((await send(first,[shared])).status,200);
  assert.equal((await remove(first)).status,409);
  await finish(first);
  const second=await job();
  const unique={...shared,video_id:'1234567890000000092',video_url:'https://www.tiktok.com/@test/video/1234567890000000092',comments:[{id:'second-only',text:'Tốt'}]};
  assert.equal((await send(second,[{...shared,comments:shared.comments.slice(0,1)},unique])).status,200);
  assert.equal((await remove(first)).status,409);
  await finish(second);
  const preview=(await request(`/jobs/${first}/data`)).data;
  assert.equal(preview.posts,0);assert.equal(preview.comments,1);assert.equal(preview.retained_comments,1);
  assert.equal((await remove(first,{})).status,400);
  assert.equal((await remove(first)).data.comments,1);
  assert.equal((await remove(first)).data.already_deleted,true);
  assert.equal((await send(first,[shared])).status,400);
  const remaining=(await request(`/dashboard?brand=${brandId}&days=1`)).data;
  assert.ok(remaining.posts.some(p=>p.video_id===shared.video_id));
  assert.ok(!remaining.comments.some(c=>c.id==='first-only'));
  assert.equal((await remove(second)).data.posts,2);
  const legacyRun=await job();
  assert.equal((await send(legacyRun,[legacyPost])).status,200);
  await finish(legacyRun);
  assert.equal((await remove(legacyRun)).data.posts,0);
  assert.equal((await request(`/dashboard?brand=${brandId}&days=1`)).data.comments.length,legacyPost.comments.length);
  const oldRun=await job(false);await finish(oldRun);
  assert.equal((await request(`/jobs/${oldRun}/data`)).data.tracked,false);
  assert.equal((await remove(oldRun)).status,409);
  const history=(await request(`/brands/${brandId}/jobs`)).data;
  assert.ok(history.jobs.some(j=>j.id===first&&j.deleted_at));
  const older=(await request(`/brands/${brandId}/jobs?before=${second}`)).data;
  assert.ok(older.jobs.every(j=>j.id<second));
  console.log('PASS: per-run deletion, shared/legacy protection, confirmation, duplicate deletion, running-job guard and history.');
}
