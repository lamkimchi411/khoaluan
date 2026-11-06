import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCrawlData } from '../server/crawl-data.js';

test('deleting a run is atomic, preserves shared/legacy data, and cannot overlap a running scan',async()=>{
  const db=new DatabaseSync(':memory:');
  db.kind='sqlite';
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE jobs(id INTEGER PRIMARY KEY,brand_id INTEGER,status TEXT);
    CREATE TABLE posts(id INTEGER PRIMARY KEY);
    CREATE TABLE comments(id TEXT,post_id INTEGER REFERENCES posts(id),PRIMARY KEY(id,post_id));
    INSERT INTO jobs VALUES(1,1,'completed'),(2,1,'completed'),(3,1,'completed'),(4,1,'completed');
    INSERT INTO posts VALUES(1),(2);
    INSERT INTO comments VALUES('shared',1),('only-first',1),('legacy',2);`);
  db.transaction=async work=>{db.exec('BEGIN');try{const result=await work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  try {
    const data=await createCrawlData(db);
    for(const id of [1,2,3])await data.register(id);
    await data.recordPost(1,1,false);await data.recordPost(2,1,true);
    await data.recordComment(1,1,'shared',false);await data.recordComment(2,1,'shared',true);
    await data.recordComment(1,1,'only-first',false);
    await data.recordPost(3,2,true);await data.recordComment(3,2,'legacy',true);
    assert.equal((await data.preview(4)).tracked,false);
    await assert.rejects(data.remove(4),/Lượt quét cũ/);
    db.prepare("UPDATE jobs SET status='running' WHERE id=2").run();
    await assert.rejects(data.remove(1),/đang chạy/);
    db.prepare("UPDATE jobs SET status='completed' WHERE id=2").run();
    const originalPrepare=db.prepare.bind(db);
    db.prepare=sql=>{if(sql.startsWith('UPDATE crawl_data_runs'))throw Error('injected failure');return originalPrepare(sql);};
    await assert.rejects(data.remove(1),/injected failure/);
    db.prepare=originalPrepare;
    assert.ok(db.prepare("SELECT id FROM comments WHERE id='only-first'").get());
    assert.equal((await data.preview(1)).comments,1);
    const [first,duplicate]=await Promise.all([data.remove(1),data.remove(1)]);
    assert.equal(first.posts,0);assert.equal(first.comments,1);assert.equal(duplicate.already_deleted,true);
    assert.ok(db.prepare("SELECT id FROM comments WHERE id='shared'").get());
    assert.equal((await data.remove(2)).posts,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,1);
    assert.equal((await data.remove(3)).comments,0);
    assert.ok(db.prepare("SELECT id FROM comments WHERE id='legacy'").get());
    assert.equal((await data.preview(3)).can_delete,false);
  } finally{db.close();}
});
