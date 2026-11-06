# BrandPulse — Hệ thống Monitoring & Cảnh báo Thương hiệu

Ứng dụng đồ án gồm hai ứng dụng độc lập: **frontend React 19 + Tailwind CSS 4** và **backend Node.js 24 / Express + Python 3.12 / Playwright**. Dashboard tiếng Việt có biểu đồ, phân tích cảm xúc, quản lý thương hiệu, lịch sử thu thập, chi tiết bình luận, xuất CSV và cảnh báo trong ứng dụng.

```text
frontend/  React, Tailwind, Vite; chỉ gọi /api qua proxy
backend/   Express API, Python NLP, Playwright crawler, Neon PostgreSQL và kiểm thử
```

## Chạy trên Windows

Yêu cầu Node.js **24+**, Python **3.12+**.

```powershell
cd frontend; npm install
cd ../backend; npm install
python -m pip install -r python/requirements.txt
python -m playwright install chromium
cd ..; npm run dev
```

## Neon PostgreSQL (runtime hiện tại)

Dữ liệu đã chuyển lên project `brandpulse` (AWS Singapore), database `neondb`, schema `public`. Cấu hình local dùng `DB_DRIVER=postgres`. MySQL được giữ lại làm nguồn đối chiếu/dự phòng.

Quy trình chuyển dữ liệu cho một môi trường Neon mới: Cấu hình `NEON_DATABASE_URL` trong `backend/.env` bằng connection string của project Neon; không đưa mật khẩu vào frontend hoặc Git. Kết nối TLS xác minh chứng chỉ luôn bật.

1. Giữ `DB_DRIVER=mysql` trong khi chuẩn bị. Chờ crawler hoàn tất, dừng backend để ngăn ghi mới trong lúc chuyển.
2. Chạy `npm --prefix backend run migrate:neon`. Script sao lưu snapshot MySQL vào `backend/data/backups/`, giữ nguyên nguồn, từ chối đích có dữ liệu, nhập trong transaction và so sánh từng trường dữ liệu.
3. Chạy `npm --prefix backend run check:neon` và `npm --prefix backend run test:neon`. Kiểm thử tạo/xóa schema tạm riêng trên Neon, không sửa dữ liệu ứng dụng ở schema `public`.
4. Khi kiểm tra đạt, đổi `DB_DRIVER=postgres`, khởi động lại backend, kiểm tra `/api/health` trả `database: "postgres"`, dashboard và một lượt crawler thật.

Chỉ cấu hình lại driver không tự chuyển dữ liệu. Nếu đã có dữ liệu mới trên Neon, cần đồng bộ phần mới trước khi quay về MySQL. File evidence JSON vẫn nằm local, script chuyển các bảng database.

## MySQL local (nguồn cũ / dự phòng)

Đặt `DB_DRIVER=mysql` để chạy với MySQL. Workbench là giao diện quản lý cùng MySQL Server, không phải một database riêng. Kết nối local: `127.0.0.1:3306`, database `brandpulse`. Cấu hình `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` trong `backend/.env` theo `.env.example`. Backend tự đọc file này; mật khẩu không đưa vào frontend hoặc Git.

Chuyển dữ liệu SQLite hiện có sang database MySQL trống:

```powershell
npm --prefix backend run migrate:mysql
npm --prefix backend run check:mysql
npm run dev
```

Migration tạo bản sao lưu nhất quán trong `backend/data/backups/`, giữ nguyên SQLite gốc, sao chép trong transaction và đối chiếu số bản ghi. Lệnh dừng nếu database đích đã có dữ liệu để tránh ghi đè. Không chạy lại migration sau khi đã chuyển thành công. Trong Workbench mở **Local instance MySQL80**, refresh **Schemas**, chọn `brandpulse`.

`GET /api/health` trả `database: "mysql"` khi backend dùng MySQL. Có thể đặt `DB_DRIVER=sqlite` để dùng lại SQLite rõ ràng; backend không tự chuyển về SQLite nếu MySQL lỗi. Schema MySQL ở `backend/sql/schema.mysql.sql`. Timestamp được giữ dạng chuỗi ISO UTC để bảo toàn dữ liệu và định dạng API cũ. Script chuyển SQLite sang Supabase cũ chỉ còn để tham khảo; runtime PostgreSQL hiện dùng Neon.

Kiểm thử MySQL bằng database tạm riêng (tự tạo/xóa, không sửa `brandpulse`):

```powershell
npm --prefix backend run test:mysql
```

Mở http://localhost:5173. Vite proxy `/api` tới Node ở cổng 3001; Python NLP ở cổng 8001. Dashboard mặc định hiển thị dữ liệu TikTok thật. Muốn xem mẫu, nạp demo rồi chọn nguồn **Demo · minh họa**. Dữ liệu demo được gắn nhãn, không tạo URL TikTok giả và không kích hoạt cảnh báo thực.

Chọn **Thu thập ngay** để chạy Python Playwright với thương hiệu hiện tại. Nếu chưa cài browser/dependency, lỗi xuất hiện ở lịch sử tác vụ. Không cần Playwright để chạy dashboard, NLP hoặc demo.

## Docker

```powershell
docker compose up --build
```

Docker vẫn dùng `DB_DRIVER=sqlite` độc lập với MySQL local. Mở http://localhost:5173. API chạy nội bộ ở cổng 3001, SQLite được lưu trong volume `brandpulse-data`; Python NLP không được công khai ra host.

## Kiến trúc

```text
TikTok public web → Python Playwright → POST /api/ingest
                                           ↓
                             Node.js → Python /analyze
                                ↓
                    Neon PostgreSQL (brands/posts/comments/alerts/jobs)
                                ↓
                     React dashboard (poll mỗi 15 giây)
```

- Neon PostgreSQL cho runtime hiện tại; transaction dùng cùng một connection cho mỗi lần nhập bài. Unique constraints chống trùng `(video_id, brand_id)` và `(comment_id, post_id)`; nhập lại cập nhật chỉ số tương tác.
- Bình luận mới được tính theo **thời điểm thu thập**, không phải thời điểm đăng gốc. Cảnh báo khi > ngưỡng đã cấu hình, tối thiểu 5 bình luận, trong một giờ gần nhất. Tối đa một cảnh báo / thương hiệu / giờ.
- NLP là **baseline từ khóa tiếng Việt**: Unicode NFC, chuẩn hóa một số teen-code, từ cảm xúc và emoji. `score` là chỉ số heuristic tiêu cực, **không phải xác suất của mô hình đã huấn luyện**. Chưa triển khai PhoBERT, không bảo đảm hiểu mỉa mai, phủ định phức tạp hoặc ngữ cảnh. Dữ liệu demo có nhãn cảm xúc dựng sẵn.
- Crawler bắt JSON phản hồi tìm kiếm và bình luận từ trình duyệt công khai, fallback link DOM. Giới hạn cấu hình tối đa 30 bài/lượt và 200 bình luận/bài; không đăng nhập, không vượt CAPTCHA, không xoay proxy. Cấu trúc JSON/DOM TikTok có thể thay đổi; không cam kết thu thập được dữ liệu trong mọi mạng/khu vực. Mặc định chờ giữa thao tác, một job tại một thời điểm, timeout worker 30 phút. Có lịch quét theo thương hiệu, kiểm tra mỗi 15 giây khi backend đang bật.
- Mỗi lượt quét mới được ghi liên kết nguồn cho bài và bình luận. Trong lịch sử crawler, người dùng có thể xem trước rồi xoá riêng dữ liệu chỉ thuộc lượt đó. Bản ghi được dùng chung với lượt khác hoặc dữ liệu cũ được giữ lại; lượt lịch sử trước khi có liên kết nguồn không có nút xoá để tránh mất dữ liệu ngoài ý muốn.
- Dữ liệu công khai không bảo đảm endpoint luôn truy cập được. Hãy kiểm tra điều kiện sử dụng nguồn dữ liệu trước khi vận hành thật.

## Chức năng

- Tổng quan: lượt nhắc đến, lượt xem, cảm xúc tích cực, cảnh báo mở; biểu đồ ngày và phân bố cảm xúc.
- Lọc thương hiệu, khoảng 1/7/30 ngày, cảm xúc, nội dung/tác giả; xem chi tiết và bình luận; mở link bài thực.
- Thêm thương hiệu, sửa từ khóa/ngưỡng; lưu cấu hình và dữ liệu sau khi khởi động lại.
- Lịch sử crawler và lỗi thực tế; trung tâm cảnh báo, đánh dấu đã xử lý.
- Xuất dữ liệu đã lọc thành CSV UTF-8 có bảo vệ chuỗi công thức.

## API

| Method | Endpoint | Nội dung |
|---|---|---|
| GET | `/api/health` | Node và Python health |
| GET/POST | `/api/brands` | Danh sách / thêm thương hiệu |
| PATCH | `/api/brands/:id` | `keywords`, `threshold` |
| GET | `/api/dashboard?brand=1&days=7` | Posts, comments, alerts, jobs |
| GET | `/api/brands/:id/jobs` | Lịch sử lượt quét, phân trang bằng `before` |
| GET / DELETE | `/api/jobs/:id/data` | Xem trước / xoá dữ liệu của một lượt (`confirm_job_id` bắt buộc khi DELETE) |
| GET/PUT | `/api/brands/:id/schedule` | Lịch quét và giới hạn |
| POST | `/api/crawl` | `{ "brand_id": 1 }` |
| POST | `/api/demo` | Nạp demo một lần cho thương hiệu |
| POST | `/api/ingest` | Nhận tối đa 30 bài + bình luận |
| PATCH | `/api/alerts/:id` | Đánh dấu đã xử lý |
| GET | `/api/tickets?brand=1` | Danh sách ticket rủi ro, người phụ trách và trạng thái SLA |
| GET/PATCH | `/api/tickets/:id` | Chi tiết/audit log và cập nhật Open, Monitoring hoặc Resolved |
| POST | `/api/tickets/:id/ai-drafts` | Sinh 3 bản nháp phản hồi để nhân sự duyệt |
| POST | `/api/tickets/:id/responses` | Duyệt nội dung phản hồi đã chỉnh sửa |
| POST | `/api/tickets/:id/responses/:responseId/publish` | Ghi nhận phát hành thủ công hoặc đẩy qua webhook API |
| GET | `/api/analytics/sla?brand=1` | Chỉ số SLA và xếp hạng nhân sự |

## Điều phối rủi ro & ticket

Mỗi bình luận tiêu cực được chấm điểm minh bạch từ 0–100: cường độ sentiment đóng góp tối đa 70 điểm và lượt thích công khai đóng góp tối đa 30 điểm. Điểm dưới 30 chỉ được theo dõi; 30–69 tạo ticket CSKH (SLA 60 phút); từ 70 tạo ticket khủng hoảng PR (SLA 15 phút). CSKH được chọn theo số ticket đang mở ít nhất, còn ticket PR được gán cho PR Manager. Ticket quá SLA tự ghi audit trail, đổi trạng thái hiển thị quá hạn và gửi cảnh báo cấp 2.

Nút **Gợi ý AI** hiện tạo ba phương án theo tone lịch sự, xin lỗi trước và chuyển sang inbox riêng. Đây là bản nháp có người duyệt, không tự động đăng phản hồi lên mạng xã hội.

Ticket áp dụng luồng bắt buộc: **Open → Review/Edit → Approved → Published → Closed**. API từ chối đóng ticket nếu chưa có `ticket_response` ở trạng thái `published`. Chế độ `manual` lưu việc nhân sự đã phát hành (có thể đính kèm HTTPS URL minh chứng); chế độ `api` gọi `PUBLISH_WEBHOOK_URL` phía server để một connector được cấp quyền đăng phản hồi thực hiện thao tác. Không lưu token mạng xã hội trong frontend.

Ticket quá SLA được chuyển từ CSKH lên PR, rồi Admin nếu cần và gửi cảnh báo cấp 2. Một ticket đã resolved/closed sẽ tự mở lại khi cùng bình luận tái bùng phát: lượt thích mới ít nhất gấp đôi mốc trước, đạt 50, và tăng tối thiểu 20 lượt.

Để dùng OpenAI thay cho bộ bản nháp dự phòng, chỉ đặt biến môi trường ở backend (không đưa vào frontend/Git):

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
```

Nếu thiếu khóa hoặc dịch vụ AI lỗi, API trả bộ bản nháp cục bộ với trường `provider` là `template`/`template_fallback` và ghi audit log. Tích hợp này dùng OpenAI Responses API ở phía server.

### Phạm vi nguồn dữ liệu

Crawler đã triển khai là TikTok Web công khai. Facebook/Meta **chưa được kết nối**: để làm đúng chính sách cần quyền, access token và nguồn API/đối tượng dữ liệu do doanh nghiệp cấp; không dùng scraping để vượt đăng nhập hay quyền riêng tư. API ingest và risk/ticket engine dùng chung, nên có thể kết nối một Meta adapter được cấp quyền mà không thay đổi quy trình xử lý.

Ví dụ payload ingest (URL và ID cần thay bằng bài thực):

```json
{
  "brand_id": 1,
  "posts": [{
    "video_id": "1234567890123456789",
    "caption": "Trải nghiệm thương hiệu",
    "author": "username",
    "views": 100,
    "likes": 10,
    "comment_count": 1,
    "video_url": "https://www.tiktok.com/@username/video/1234567890123456789",
    "comments": [{ "id": "comment-123", "text": "Chất lượng tốt", "author": "reader" }]
  }]
}
```

Đặt `INGEST_TOKEN` trong môi trường để yêu cầu `Authorization: Bearer ...` cho ingest. File `backend/.env.example` chỉ là mẫu; backend tự đọc `backend/.env`, biến môi trường từ shell được ưu tiên. Ví dụ PowerShell: `$env:INGEST_TOKEN='your-token'` trước khi chạy.

## Kiểm tra và build

```powershell
npm test
python -m unittest discover -s python -p "test_*.py"
npm run build
```

`npm run build` tạo frontend ở `frontend/dist`. Chạy `npm --prefix backend run dev:nlp`, `npm --prefix backend start` và `npm --prefix frontend run dev` ở ba terminal, hoặc dùng `npm run dev` tại thư mục gốc.

## Giới hạn triển khai

Đây là phiên bản nghiên cứu chạy local, chưa có đăng nhập / phân quyền / TLS. Không mở trực tiếp ra Internet trước khi thêm xác thực, rate limit và bảo vệ API quản trị. Đã tích hợp email SMTP STARTTLS và Telegram; cần cấu hình thông tin nhận trong dashboard, thông tin máy chủ qua biến môi trường. Chưa kiểm thử gửi thực tế khi chưa có thông tin tài khoản. Chưa có Slack hoặc mô hình PhoBERT. Scheduler hiện hỗ trợ một tiến trình backend; cần queue khi triển khai nhiều worker.

## Kênh thông báo

Trong **Cấu hình cảnh báo**, lưu email và Telegram Chat ID của người nhận. Để trống để tắt. Cấu hình các biến môi trường trên **Node backend** (tiến trình Python gửi thông báo kế thừa):

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_FROM=alerts@example.com
SMTP_USER=alerts@example.com
SMTP_PASSWORD=your-app-password
TELEGRAM_BOT_TOKEN=your-bot-token
```

SMTP sử dụng STARTTLS và xác minh chứng chỉ. Không lưu mật khẩu/token trong giao diện hoặc cơ sở dữ liệu. Trạng thái gửi lưu ở trường `delivery` của cảnh báo và hiển thị trong trung tâm cảnh báo. Gửi một lần, chưa có retry queue. Không cần cấu hình kênh ngoài để dùng cảnh báo trong ứng dụng.

Kiểm thử tích hợp độc lập: `npm run test:integration`. Script tạo database tạm và dùng cổng 13001/18001; không sửa dữ liệu dashboard đang chạy.

Detector virality: bài tiêu cực có tổng likes + comment_count tăng ít nhất 2 lần và ít nhất 100 tương tác giữa hai lần thu thập cách nhau tối đa 1 giờ; mốc trước cần >=10 tương tác. Dùng chung giới hạn một cảnh báo / thương hiệu / giờ.

Hướng dẫn crawler, dữ liệu thật và giới hạn độ phủ: [docs/CRAWLER.md](docs/CRAWLER.md).
