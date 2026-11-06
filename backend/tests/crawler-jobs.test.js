import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createCrawlerJobs,validateSchedule} from '../server/crawler-jobs.js';

test('schedule validates bounds and does not silently coerce booleans',()=>{
 const good={enabled:true,interval_minutes:60,max_posts:10,max_comments:100,max_scrolls:12};
 assert.equal(validateSchedule(good).max_posts,10);
 for(const delta of [{enabled:'true'},{interval_minutes:1},{max_comments:201},{max_posts:0},{max_scrolls:1.5}])assert.throws(()=>validateSchedule({...good,...delta}));
});
test('scheduler persists settings, runs due brand once, records partial coverage and handles errors',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE brands(id INTEGER PRIMARY KEY,name TEXT,keywords TEXT);INSERT INTO brands VALUES(1,'Brand','a,b');CREATE TABLE jobs(id INTEGER PRIMARY KEY,brand_id INTEGER,status TEXT,message TEXT,created_at TEXT,report TEXT,finished_at TEXT);`);
 let time=Date.parse('2026-10-27T00:00:00Z'),calls=[],child;
 const queue=await createCrawlerJobs(db,{now:()=>time,env:{PORT:'13001'},spawnProcess:(exe,args,options)=>{calls.push({exe,args,options});child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',1);return child;}});
 try {
  await queue.save(1,{enabled:true,interval_minutes:15,max_posts:3,max_comments:20,max_scrolls:6});
  await queue.tick();assert.equal(calls.length,0);
  time+=15*60000;await queue.tick();await queue.tick();assert.equal(calls.length,1);
  assert.ok(calls[0].args.includes('a,b'));assert.equal(calls[0].options.env.BACKEND_URL,'http://127.0.0.1:13001');
  assert.equal(calls[0].options.env.CRAWL_JOB_ID,'1');
  await assert.rejects(()=>queue.start({id:1,keywords:'a'}));
  child.stdout.emit('data',Buffer.from('REPORT {"status":"partial","saved_'));
  child.stdout.emit('data',Buffer.from('posts":3,"saved_comments":0}\n'));child.emit('close',0);await new Promise(resolve=>setImmediate(resolve));
  const job=db.prepare('SELECT * FROM jobs').get();assert.equal(job.status,'partial');assert.equal(JSON.parse(job.report).saved_posts,3);
  await queue.tick();assert.equal(calls.length,1);
  await queue.save(1,{enabled:false,interval_minutes:15,max_posts:3,max_comments:20,max_scrolls:6});time+=30*60000;await queue.tick();assert.equal(calls.length,1);
  const starts=await Promise.allSettled([queue.start({id:1,keywords:'a,b'}),queue.start({id:1,keywords:'a,b'})]);
  assert.equal(starts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(starts.filter(r=>r.status==='rejected').length,1);
  assert.ok(calls[1].args.includes('b,a'));child.emit('error',new Error('Cannot launch Python'));child.emit('close',1);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(db.prepare('SELECT status FROM jobs ORDER BY id DESC LIMIT 1').get().status,'failed');
 } finally {queue.stop();db.close();}
});
