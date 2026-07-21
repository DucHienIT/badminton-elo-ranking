# 🏸 BXH Cầu lông — Bảng xếp hạng ELO cho CLB

Trang web nội bộ xếp hạng cá nhân VĐV theo hệ thống ELO, tính từ kết quả các trận đấu **đôi**. Triển khai theo `badminton-elo-ranking-spec.md`.

## Chạy local

Yêu cầu: Node.js ≥ 20.

```bash
npm install
npm start        # → http://localhost:3000
npm test         # chạy unit test logic ELO
```

Database dùng `@libsql/client`, 2 chế độ qua biến môi trường:
- **Không cấu hình gì** → file SQLite local `data/club.db` (mặc định cho dev)
- **`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`** → Turso cloud (cho production)

Biến tuỳ chọn `ADMIN_PASSWORD`: nếu đặt, web có chế độ đăng nhập — Guest (chưa đăng nhập) chỉ xem được BXH, VĐV, lịch sử đấu; đăng nhập bằng tài khoản `admin` / mật khẩu này để ghi trận/quản lý VĐV/cài đặt (tên đăng nhập đổi được qua `ADMIN_USERNAME`). Không đặt = chế độ mở, không cần đăng nhập (phù hợp chạy local).

**Deploy miễn phí lên internet: xem [DEPLOY.md](DEPLOY.md)** (Turso + Render, kèm script chuyển dữ liệu local lên cloud `scripts/migrate-to-turso.js`).

Muốn xoá toàn bộ dữ liệu local làm lại từ đầu: tắt server và xoá thư mục `data/`.

> Hiện DB đang có sẵn **dữ liệu demo** (8 VĐV, 14 trận) để xem giao diện. Xoá `data/club.db` để bắt đầu với dữ liệu thật.

## Cấu trúc

```
server/
  index.js        # Express: API + serve frontend
  db.js           # Schema SQLite + settings mặc định
  elo.js          # ★ Logic ELO: công thức mục 3.2 + replay toàn bộ (mục 3.4)
  elo.test.js     # Unit test (khớp ví dụ mục 3.3 của spec)
  routes/         # players / matches / settings
public/           # Frontend SPA (vanilla JS, hash router, SVG chart)
data/club.db      # SQLite (tự tạo)
```

## Cách tính ELO (tóm tắt)

- ELO đội = trung bình ELO 2 thành viên; kỳ vọng thắng `E = 1/(1+10^((EloB-EloA)/400))`; mỗi người trong đội nhận cùng `Δ = K(S−E)`.
- ELO lưu **float** trong DB, chỉ làm tròn khi hiển thị. ELO sàn mặc định 100.
- **Mọi thay đổi trận đấu (thêm/sửa/xoá) và thay đổi cấu hình đều replay lại toàn bộ lịch sử** theo thứ tự `(date, id)` — kể cả trận nhập lùi ngày (backdate) cũng được xếp đúng dòng thời gian.

## Các giả định ngoài spec

1. **Thêm trận cũng replay toàn bộ** (không chỉ sửa/xoá) — vì trận có thể backdate.
2. **K động cho VĐV mới** (nice-to-have mục 3.2): VĐV đấu < `new_threshold` trận (mặc định 10) dùng `k_new`. Mặc định `k_new = k_base = 32` (tắt); bật bằng cách chỉnh trong trang Cài đặt. Khi K hai bên khác nhau, Δ mỗi người = K riêng × (S−E) — không còn zero-sum tuyệt đối (đánh đổi có chủ đích của tính năng này).
3. **Avatar** nhập bằng URL ảnh; không có thì hiển thị chữ cái đầu tên.
4. **Không cho xoá VĐV đã có trận đấu** (phải xoá các trận liên quan trước) để giữ toàn vẹn lịch sử.
5. **Lọc leaderboard theo khoảng thời gian**: spec đánh dấu "có thể làm sau" → chưa làm ở bản này.
6. Không có đăng nhập/mật khẩu admin (spec ghi không ưu tiên).

## API

| Method | Endpoint | Mô tả |
|---|---|---|
| GET/POST | `/api/players` | Danh sách (kèm thống kê) / thêm VĐV |
| GET/PUT/DELETE | `/api/players/:id` | Chi tiết (lịch sử ELO, thống kê) / sửa / xoá |
| GET/POST | `/api/matches` | Danh sách / ghi trận mới (→ replay ELO) |
| GET/PUT/DELETE | `/api/matches/:id` | Xem / sửa / xoá trận (→ replay ELO) |
| GET/PUT | `/api/settings` | Cấu hình K, ELO khởi điểm, ELO sàn… (PUT → replay) |
