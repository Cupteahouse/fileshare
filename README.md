# FileShare — GitHub Pages + Supabase Auth

Frontend tĩnh chạy trên GitHub Pages; Supabase cung cấp Auth, Database và Storage. Thiết lập quyền:

- Bất kỳ ai cũng có thể tự đăng ký bằng email/mật khẩu.
- Bất kỳ ai cũng xem danh sách và tải file công khai, không cần đăng nhập.
- Chỉ tài khoản đã đăng nhập mới được upload.
- Người dùng chỉ được xóa file do chính họ upload; quyền này được kiểm tra lại bằng RLS ở Supabase.
- Mỗi file tối đa 50 MiB. Bucket công khai: bất kỳ ai có URL của object đều có thể truy cập file.

## 1. Tạo project Supabase

1. Tạo project tại https://supabase.com/dashboard.
2. Mở **SQL Editor**.
3. Dán toàn bộ `supabase_setup.sql` và chạy. Script này tạo/cập nhật bucket và policies. Nếu đã chạy bản SQL cũ, script sẽ thu hồi chính sách upload ẩn danh cũ.
4. Trong **Authentication → Providers → Email**, bật Email provider và cho phép sign-up.
5. Trong **Authentication → URL Configuration**, thêm URL GitHub Pages của bạn vào **Site URL** và **Redirect URLs**. Ví dụ `https://USERNAME.github.io/REPOSITORY/`. Nếu thử local, thêm `http://localhost:8000/**` vào Redirect URLs.
6. Email confirmation thường được bật trên project hosted. Người đăng ký cần xác nhận email trước khi đăng nhập nếu tùy chọn này đang bật. Để gửi email đáng tin cậy khi có nhiều người dùng, cấu hình SMTP riêng.

## 2. Cấu hình frontend

Mở `app.js`, thay hai dòng:

- `PASTE_YOUR_SUPABASE_PROJECT_URL` bằng Project URL.
- `PASTE_YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY` bằng publishable key (hoặc anon key legacy) trong Project Settings → API.

Chỉ dùng publishable/anon key ở trình duyệt. **Không bao giờ đưa `service_role` hoặc secret key vào GitHub.** RLS và Storage policies là lớp bảo vệ quyền truy cập.

## 3. Đưa lên GitHub Pages

1. Tạo repository GitHub và tải các file `index.html`, `404.html`, `style.css`, `app.js`, `supabase_setup.sql`, `README.md` lên nhánh `main`. `404.html` là file bắt buộc để hỗ trợ URL ngắn theo path.
2. Repository → Settings → Pages.
3. Chọn Deploy from a branch → `main` → `/ (root)` → Save.
4. Chờ URL GitHub Pages được cấp. Đảm bảo URL đó đã được thêm vào Supabase Auth URL Configuration.

Máy tính cá nhân không cần bật sau khi GitHub Pages và Supabase đã triển khai.

## 4. Chạy thử trên máy

Không mở bằng `file://`. Trong thư mục dự án chạy:

```bash
python -m http.server 8000
```

Mở `http://localhost:8000`, và thêm URL này vào Redirect URLs trong Supabase nếu cần.

## 5. Cách hoạt động và quyền

- Đăng ký: `supabase.auth.signUp`; đăng nhập: `signInWithPassword`; đăng xuất: `signOut`.
- TUS resumable upload dùng access token của phiên đăng nhập; thư mục object bắt đầu bằng user UUID.
- SQL RLS chỉ cho `authenticated` thêm metadata với `owner_id = auth.uid()` và chỉ cho chủ sở hữu xóa metadata.
- Storage policy chỉ cho user đăng nhập upload/xóa object trong thư mục UUID của chính họ.
- Public bucket cho phép đọc/tải object công khai; bảng metadata có policy SELECT công khai.
- Danh sách hiển thị tối đa 200 tệp mới nhất. Mỗi tệp có `share_slug` riêng; link chia sẻ ngắn dạng `https://cupteahouse.github.io/fileshare/ten-file`.
- `404.html` là fallback cho GitHub Pages để đường dẫn `/fileshare/ten-file` vẫn mở được khi truy cập trực tiếp hoặc tải lại trang.
- Thống kê Storage đọc tổng kích thước object trực tiếp từ `storage.objects` qua RPC `get_project_storage_usage`, không cộng từ bảng metadata `files`.
- Hạn mức mặc định trong giao diện là 1 GB (Supabase Free). Nếu tổ chức dùng Pro/Team, đổi `STORAGE_QUOTA_BYTES` trong `app.js` thành `100 * 1024 * 1024 * 1024` (100 GB).

## 6. Storage và hạn mức

- Số đã dùng là tổng kích thước metadata của tất cả object trong mọi bucket thuộc **project Supabase này**. Đây là số liệu object thực tế, không phải tổng `size_bytes` trong bảng `files`, nên vẫn tính cả object chưa có metadata tương ứng.
- Supabase áp dụng quota Storage ở cấp tổ chức và cộng usage giữa các project. RPC trên chỉ đọc được project hiện tại; nếu tổ chức có nhiều project, số “còn lại” hiển thị là ước tính theo project này, không thay thế Usage/Billing trong Supabase Dashboard.
- Hạn mức giao diện mặc định 1 GB cho Free. Supabase hiện công bố 100 GB cho Pro/Team; hãy chỉnh `STORAGE_QUOTA_BYTES` trong `app.js` nếu gói của bạn khác. Xem https://supabase.com/docs/guides/platform/manage-your-usage/storage-size.

## 7. Giới hạn và lưu ý an toàn

- Giới hạn giao diện và bucket: 50 MiB/file. Hạn mức tổng Storage, băng thông/egress và giới hạn Free có thể thay đổi; kiểm tra https://supabase.com/pricing.
- File public không phù hợp để lưu tài liệu riêng tư, thông tin cá nhân hoặc nội dung nhạy cảm. Ai có URL object có thể tải file.
- Bản này chưa có CAPTCHA, quét mã độc, kiểm duyệt nội dung, quota theo tài khoản hoặc chống spam. Tài khoản đăng ký tự do vẫn có thể bị lạm dụng và làm cạn quota Free.
- Cần kiểm tra quota Supabase thường xuyên và xóa nội dung vi phạm trong Dashboard.
- SQL giữ metadata của file cũ (nếu có), nhưng các file cũ không có `owner_id` sẽ không hiện nút xóa cho người dùng.
- Đây là starter project; cần kiểm thử trên project Supabase riêng trước khi công khai rộng rãi.

## Tài liệu chính thức

- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- https://supabase.com/pricing
