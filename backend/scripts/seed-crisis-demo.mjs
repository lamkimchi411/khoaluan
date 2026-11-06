// Explicit opt-in demonstration; no external notifications or social posts.
import { loadEnvFile } from 'node:process';
import { createPostgresDatabase } from '../server/postgres.js';
const explicit = { ...process.env };
loadEnvFile(new URL('../.env', import.meta.url));
Object.assign(process.env, explicit);
const db = await createPostgresDatabase();
try {
  const name = 'KIỂM THỬ KHỦNG HOẢNG';
  let brand = await db.prepare('SELECT * FROM brands WHERE name=?').get(name);
  if (brand) {
    console.log(JSON.stringify({brand_id:brand.id,already_seeded:true}));
  } else {
    await db.transaction(async () => {
      const result = await db.prepare('INSERT INTO brands(name,keywords,threshold) VALUES(?,?,?)').run(name,'DEMO, kiểm thử',40);
      const id = result.lastInsertRowid;
      const created = new Date().toISOString();
      let staff = await db.prepare("SELECT * FROM staff WHERE role='pr' AND active=TRUE LIMIT 1").get();
      if (!staff) {
        const s = await db.prepare('INSERT INTO staff(name,role) VALUES(?,?)').run('PR kiểm thử','pr');
        staff = {id:s.lastInsertRowid};
      }
      for (let i=0;i<5;i++) {
        const p = await db.prepare('INSERT INTO posts(video_id,brand_id,caption,author,views,likes,comment_count,video_url,sentiment,score,created_at,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(`demo-crisis-${id}-${i}`,id,`[DEMO] Phản ánh dịch vụ chậm, chất lượng kém — tình huống ${i+1}`,'demo.customer',10000+i*5000,500+i*100,10,'','negative',0.95,created,'demo');
        for (let j=0;j<10;j++) await db.prepare('INSERT INTO comments(id,post_id,text,author,sentiment,score,created_at,like_count) VALUES(?,?,?,?,?,?,?,?)').run(`demo-crisis-${i}-${j}`,p.lastInsertRowid,j<8?'[DEMO] Dịch vụ quá tệ, rất thất vọng, yêu cầu giải thích và xử lý ngay.':'[DEMO] Tôi đang chờ thông tin xác minh.','demo.customer',j<8?'negative':'neutral',j<8?0.95:0.1,created,j<8?200+j*50:0);
        const t = await db.prepare('INSERT INTO tickets(brand_id,post_id,comment_id,risk_score,severity,queue,status,assignee_id,created_at,due_at,resolution_note) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,p.lastInsertRowid,`demo-crisis-${i}-0`,97,'critical','pr','open',staff.id,created,new Date(Date.now()+15*60000).toISOString(),'[DEMO] Kịch bản kiểm thử, không phải sự cố thực tế');
        await db.prepare('INSERT INTO ticket_actions(ticket_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)').run(t.lastInsertRowid,'Trình nạp demo','created','[DEMO] Ticket khủng hoảng giả lập, phân công PR, SLA 15 phút',created);
      }
      await db.prepare('INSERT INTO alerts(brand_id,reason,level,created_at,delivery) VALUES(?,?,?,?,?)').run(id,'[KIỂM THỬ] 80% bình luận tiêu cực (40/50); 5 ticket PR nghiêm trọng, điểm rủi ro 97/100. Dữ liệu giả lập, không phải sự cố thực tế.','high',created,'Chỉ thông báo trong ứng dụng — theo yêu cầu người dùng');
      console.log(JSON.stringify({brand_id:id,posts:5,comments:50,negative:40,tickets:5,alerts:1,source:'demo'}));
    });
  }
} finally { await db.close(); }
