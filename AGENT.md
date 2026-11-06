# BrandPulse — hướng dẫn ngắn cho AI

## Mục tiêu

Hệ thống Social Listening TikTok: tìm theo từ khóa thương hiệu, lấy video/bình luận công khai, phân tích cảm xúc, cảnh báo và dashboard tiếng Việt.

## Cấu trúc

```text
frontend/  React 19 + Tailwind 4 + Vite, cổng 5173
backend/   Express API, Python NLP/Playwright, kiểm thử, cổng 3001
backend/data/  SQLite cũ và evidence JSON
backend/sql/schema.mysql.sql  schema MySQL nguồn cũ / dự phòng
backend/sql/schema.postgres.sql  schema Neon PostgreSQL runtime
```

## Lệnh chính

```powershell
npm run dev
npm test
python -m unittest discover -s backend/python -p "test_*.py"
npm run test:integration
npm run build
npm --prefix backend run check:mysql
npm --prefix backend run test:mysql
```

## Runtime hiện tại

- Frontend gọi `/api` qua Vite proxy tới backend.
- `backend/server/index.js` hiện chạy Neon PostgreSQL với `DB_DRIVER=postgres`, đọc `NEON_DATABASE_URL` từ `.env`; MySQL và SQLite chỉ dùng khi chọn driver rõ ràng.
- `backend/python/collector.py` dùng Playwright, tìm theo keyword, không đăng nhập, không vượt CAPTCHA.
- `backend/python/service.py` là NLP baseline tiếng Việt.
- Scheduler/crawler hiện nằm ở `backend/server/crawler-jobs.js`.

## Neon PostgreSQL

- Schema và dữ liệu SQLite đã được chuyển lên Supabase bằng `backend/scripts/migrate-sqlite-to-postgres.mjs`.
- Không đọc, in, commit hoặc đưa `backend/.env`/`DATABASE_URL` vào frontend.
- Đã chuyển MySQL lên Neon project brandpulse (rough-pine-87171955), branch production, database neondb. Migration đối chiếu từng trường đạt: 5 brands, 197 posts, 2996 comments, 51 jobs, 4 schedules. Bản sao ở backend/data/backups/before-neon-1793245185873.json; MySQL giữ nguyên. Kiểm thử Neon và API/dashboard đã đạt. Crawler thật job 52 đã ghi/cập nhật ít nhất 3 bài trên Neon sau cutover; lượt quét còn tiếp tục tại thời điểm bàn giao. Không chạy lại migration vào database đang có dữ liệu.
- Chỉ báo "PostgreSQL runtime hoàn tất" sau khi API health, dashboard và một lượt crawler thật đã đọc/ghi trực tiếp PostgreSQL thành công.
- Các lượt crawler mới có dấu vết nguồn bài/bình luận để người dùng xem trước và xoá dữ liệu theo đúng từng lượt. Không bật xoá riêng cho lịch sử cũ chưa có dấu vết nguồn; dữ liệu được dùng chung giữa nhiều lượt luôn được giữ lại.

## Quy tắc dữ liệu

- `source=live` là TikTok thật; demo luôn tách riêng.
- Không gọi một lượt giới hạn là "toàn bộ TikTok" hoặc "toàn bộ bình luận".
- Lưu ID thật, số đã tải, tổng TikTok báo và lý do dừng.
- Tránh giả dữ liệu khi TikTok chặn, yêu cầu đăng nhập hoặc CAPTCHA.

## Kiểm tra trước khi bàn giao

Chạy unit tests, Python tests, integration test và build. Với thay đổi crawler/DB, kiểm tra `/api/health`, dashboard và báo cáo job.
