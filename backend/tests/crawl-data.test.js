import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCrawlData } from '../server/crawl-data.js';

test('deleting histories in bulk preserves collected data and rejects running scans',async()=>{
  const db=new DatabaseSync(':memory:');
  db.kind='sqlite';
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE jobs(id INTEGER PRIMARY KEY,brand_id INTEGER,status TEXT);
    CREATE TABLE posts(id INTEGER PRIMARY KEY);
    CREATE TABLE comments(id TEXT,post_id INTEGER REFERENCES posts(id),PRIMARY KEY(id,post_id));
    INSERT INTO jobs VALUES(1,1,'completed'),(2,1,'completed'),(3,1,'running');
    INSERT INTO posts VALUES(1);
    INSERT INTO comments VALUES('comment',1);`);
  db.transaction=async work=>{db.exec('BEGIN');try{const result=await work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  try {
    const data=await createCrawlData(db);
    for(const id of [1,2,3])await data.register(id);
    await data.recordPost(1,1,false);await data.recordPost(2,1,true);
    await data.recordComment(1,1,'comment',false);await data.recordComment(2,1,'comment',true);
    await assert.rejects(data.removeHistories([1,3]),/đang chạy/);
    assert.ok(db.prepare('SELECT id FROM jobs WHERE id=1').get());
    assert.deepEqual((await data.removeHistories([1,2])).deleted_job_ids,[1,2]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,1);
    assert.ok(db.prepare('SELECT id FROM posts WHERE id=1').get());
    assert.ok(db.prepare("SELECT id FROM comments WHERE id='comment'").get());
  } finally{db.close();}
});
