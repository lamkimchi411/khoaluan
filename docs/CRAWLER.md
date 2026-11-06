# Crawler theo từ khóa và lịch quét

Luồng chính: từ khóa thương hiệu → TikTok Search → danh sách video → mở từng video → mở tab Comments → cuộn bình luận / thử mở phản hồi → Node ingest → Python NLP → Neon PostgreSQL → dashboard.

Trong **Trình thu thập**, lưu giới hạn và bật lịch quét. **Thu thập ngay** dùng danh sách từ khóa thương hiệu (phân tách dấu phẩy), không cần URL. Giới hạn số bài áp dụng chung cho cả lượt. Backend luân phiên từ khóa bắt đầu giữa các lượt, lưu vị trí trong database, tránh từ khóa đầu tiên luôn chiếm hết giới hạn. Ví dụ VinFast → VF 3 → VF 8 sẽ lần lượt được ưu tiên ở ba lượt liên tiếp. CLI trực tiếp dùng đúng thứ tự được truyền vào.

Lịch được lưu ở bảng `crawl_schedules`, kiểm tra mỗi 15 giây, một worker hoạt động tại một thời điểm. Mỗi thương hiệu có chu kỳ 15–1440 phút. Lần chạy tiếp theo được tính từ lúc bắt đầu tác vụ; lỗi không tạo vòng lặp retry liên tục. Lịch còn quá hạn sau khi khởi động lại chạy một lần thay vì chạy bù hàng loạt. Backend/máy phải đang bật.

Giới hạn cấu hình: 1–30 bài/lượt, 1–200 bình luận/bài, 1–30 lần cuộn/trang. Worker có timeout 30 phút. Dữ liệu từng bài được nhập ngay sau khi xử lý để giữ kết quả nếu bài sau bị lỗi.

## Xoá dữ liệu theo lượt

Mỗi lượt mới được tạo một dấu vết nguồn cho từng bài và bình luận đã nhập. Ở lịch sử crawler, nút **Xoá dữ liệu** luôn mở bước xem trước: số bản ghi sẽ xoá và số bản ghi phải giữ vì cũng thuộc một lượt khác. Xác nhận yêu cầu nhập/đối chiếu đúng ID lượt để tránh xoá nhầm.

Không thể xoá khi thương hiệu đó còn lượt đang chạy. Khi một bài hoặc bình luận được chia sẻ giữa các lượt, chỉ liên kết của lượt đang xoá bị bỏ; bản ghi thật chỉ bị xoá khi không còn nguồn nào khác. Lượt cũ từ trước khi tính năng này được triển khai không được đánh dấu để xoá riêng, nhằm bảo toàn dữ liệu cũ.

## Dữ liệu thực

- Bài: ID, URL TikTok gốc, username/nickname, caption, hashtag, ngày đăng, views/likes/comment_count/shares/saves khi TikTok cung cấp.
- Bình luận: ID thật, nội dung, username/nickname, likes, ngày đăng, parent_id cho phản hồi cấp 2 khi được tải. ID được dùng để chống trùng giữa các lượt.
- Metadata không lấy được giữ `null`, giao diện hiển thị `—`. Tổng bình luận TikTok báo không đồng nghĩa số bình luận thực tải được.
- Mỗi bài có `collection_method`, `discovery_keyword`, `observed_at`, `comment_status`. Bản chụp JSON chuẩn hóa lưu ở `backend/data/evidence/{video_id}.json`; hash HTML có khi metadata lấy từ HTML công khai.
- Mặc định dashboard chỉ hiển thị `source=live`. Demo cần được chọn riêng, không trộn vào chỉ số thật.

## Kết thúc và giới hạn

`completed` nghĩa là hoàn tất **lượt có giới hạn**, không phải toàn bộ TikTok. `partial` nghĩa là có bài đã lưu nhưng một phần gặp lỗi hoặc không tải được bình luận. `failed` khi chưa có bài hoặc worker không kết thúc với báo cáo.

Báo cáo từng bài có số bình luận tải, tổng TikTok công bố và lý do dừng: hết trang công khai, chạm giới hạn, không tải thêm hoặc lỗi. Bình luận bị ẩn, xóa, hạn chế khu vực hoặc yêu cầu đăng nhập không được suy đoán/tạo thay thế.

Trình duyệt dùng Chrome cài sẵn trên Windows (`CRAWLER_BROWSER=chrome`), Chromium của Playwright trên Linux. Crawler khởi tạo phiên công khai, dùng User-Agent tương ứng phiên bản Chrome; không lấy cookie/tài khoản cá nhân từ Chrome của người dùng. Dừng khi hiện CAPTCHA hoặc hộp thoại bắt buộc đăng nhập. Không giải CAPTCHA, không xoay proxy.

API cấu hình: `GET /api/brands/:id/schedule`, `PUT /api/brands/:id/schedule` với `enabled`, `interval_minutes`, `max_posts`, `max_comments`, `max_scrolls`. Lịch sử/xoá: `GET /api/brands/:id/jobs?before=`, `GET /api/jobs/:id/data`, `DELETE /api/jobs/:id/data` với JSON `{ "confirm_job_id": id }`.

Kiểm tra nhỏ không cần URL:

```powershell
cd backend
python python/crawler.py --brand 1 --keyword VinFast --max-posts 3 --max-comments 20 --max-scrolls 6
```

URL thủ công vẫn là tùy chọn bổ sung trong mục thu gọn, dùng chung bước đọc bài/bình luận. Không thay thế luồng tìm theo từ khóa.
