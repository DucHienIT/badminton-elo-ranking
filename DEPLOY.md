# 🚀 Deploy miễn phí: Turso (database) + Render (hosting)

Kiến trúc: code Express giữ nguyên, database chuyển từ file local sang **Turso** (SQLite trên cloud, free 5GB) qua 2 biến môi trường. Không đặt biến → app vẫn chạy file local như cũ (dev không đổi gì).

```
Local dev :  Express ── file:data/club.db
Production:  Express (Render, free) ── libsql ──> Turso (free)
```

## Bước 1 — Tạo database trên Turso (~5 phút)

1. Vào [app.turso.tech](https://app.turso.tech) → đăng nhập bằng GitHub (free, không cần thẻ)
2. **Create Database** → đặt tên `bxh-badminton`, chọn region gần (Singapore)
3. Lấy 2 thứ (trong trang database vừa tạo):
   - **URL**: dạng `libsql://bxh-badminton-<user>.turso.io`
   - **Token**: bấm *Create Token* (chọn không hết hạn) → chuỗi `eyJ...`

## Bước 2 — Thử chạy local nối vào Turso (khuyến nghị, để chắc chắn trước khi deploy)

```powershell
cd d:\BXH_Badminton
$env:TURSO_DATABASE_URL = "libsql://bxh-badminton-<user>.turso.io"
$env:TURSO_AUTH_TOKEN   = "eyJ..."
npm start
# Console phải in: "→ Database: Turso (remote)"
```

Muốn chuyển dữ liệu đã nhập ở local lên Turso (giữ nguyên env như trên):

```powershell
node scripts/migrate-to-turso.js
```

## Bước 3 — Đưa code lên GitHub

```powershell
cd d:\BXH_Badminton
git add -A
git commit -m "BXH ELO cau long"
# Tạo repo trên github.com (private cũng được) rồi:
git remote add origin https://github.com/<user>/bxh-badminton.git
git push -u origin master
```

## Bước 4 — Deploy lên Render (~10 phút)

1. Vào [render.com](https://render.com) → đăng ký bằng GitHub (free, không cần thẻ)
2. **New → Web Service** → chọn repo `bxh-badminton`
3. Cấu hình:
   - Runtime: **Node** · Build: `npm install` · Start: `npm start`
   - Instance type: **Free**
4. **Environment Variables** — thêm 3 biến:
   | Key | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | `libsql://bxh-badminton-<user>.turso.io` |
   | `TURSO_AUTH_TOKEN` | `eyJ...` |
   | `ADMIN_PASSWORD` | mật khẩu tuỳ chọn — **nên đặt** khi web công khai |
5. **Create Web Service** → chờ build xong → web sống tại `https://bxh-badminton.onrender.com`

Gửi link cho cả CLB. Ai cũng **xem** được; thao tác **ghi** (thêm trận, sửa, xoá) sẽ được hỏi mật khẩu admin 1 lần trên mỗi thiết bị (lưu lại, không hỏi lại).

## Lưu ý free tier

- **Render Free ngủ sau ~15 phút không ai truy cập** → lượt mở đầu tiên chậm ~30–60 giây (các lượt sau nhanh bình thường). Với CLB dùng vài buổi/tuần thì chấp nhận được.
- **Dữ liệu an toàn** vì nằm ở Turso, không nằm trên Render — redeploy/restart thoải mái không mất gì.
- Free tier Turso (2025): 5GB, 500 DB — quy mô CLB dùng không bao giờ chạm trần.
- Backup: trang Turso có nút export; hoặc thỉnh thoảng chạy `turso db shell bxh-badminton .dump > backup.sql` nếu cài Turso CLI.

## Deploy chỗ khác (cùng cách)

Koyeb / Railway / Fly.io đều chạy được y hệt: deploy repo Node, đặt đúng 3 biến môi trường trên là xong. Chỉ cần tránh dựa vào ổ đĩa của hosting (DB đã ở Turso nên không sao).
