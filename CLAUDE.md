# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## QUY TẮC BẮT BUỘC

- **KHÔNG tự ý thao tác trên git** (add/commit/push/pull/reset/branch...) khi chưa có sự cho phép rõ ràng của chủ dự án trong lần đó. Làm xong code thì dừng ở mức file đã sửa, báo cáo thay đổi, và chờ chủ dự án tự commit hoặc ra lệnh. Lưu ý thêm: push lên `master` sẽ **tự động deploy lên Render** (production), nên càng không được push tuỳ tiện.

## Dự án

Web nội bộ xếp hạng ELO cá nhân cho CLB cầu lông, tính từ kết quả các trận **đôi**. Spec gốc (nguồn chân lý về công thức ELO và yêu cầu chức năng): `badminton-elo-ranking-spec.md`. Tài liệu, comment code và UI đều bằng tiếng Việt — giữ nguyên quy ước này.

## Lệnh

```bash
npm start   # chạy server → http://localhost:3000
npm test    # unit test logic ELO (node server/elo.test.js — plain Node assert, không có framework)
```

Node ≥ 20, CommonJS. Không có build step, lint, hay bundler — frontend là file tĩnh serve thẳng từ `public/`.

Biến môi trường (đều tuỳ chọn):
- `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` → dùng Turso cloud; không đặt → file SQLite local `data/club.db` (tự tạo). Cùng một code path qua `@libsql/client`.
- `ADMIN_PASSWORD` → bật chế độ đăng nhập: `POST /api/login` {username, password} (username mặc định `admin`, đổi qua env `ADMIN_USERNAME`) → trả token (= SHA-256(salt + mật khẩu), stateless, sống qua restart); request ghi phải kèm header `X-Auth-Token`; GET vẫn mở cho Guest xem. `GET /api/auth` trả `{required, logged_in}` để frontend dựng UI. Sai mật khẩu 5 lần/IP → khoá 5 phút. Không đặt = chế độ mở, không cần đăng nhập.

Xoá sạch dữ liệu local: tắt server, xoá thư mục `data/`. Deploy (Turso + Render) và script chuyển dữ liệu local lên cloud (`scripts/migrate-to-turso.js`): xem `DEPLOY.md`.

## Kiến trúc

**Backend** — Express (`server/index.js`) = middleware admin-password → 3 router (`routes/players|matches|settings.js`) → serve static `public/`.

**Nguyên tắc trung tâm: replay toàn bộ.** ELO là tích luỹ tuần tự, nên **mọi** thay đổi dữ liệu — thêm/sửa/xoá trận (kể cả thêm, vì trận có thể backdate) và đổi settings — đều gọi `replayAllElo()` (`server/elo.js`): xoá `elo_history`, tính lại từ đầu toàn bộ lịch sử theo thứ tự `(date, id)`, đồng bộ ELO cuối về `players`. Không bao giờ cập nhật ELO tăng dần từng trận.

**Thiết kế cho DB remote.** Vì DB có thể là Turso (mỗi statement = 1 round-trip mạng), pattern xuyên suốt là: số query cố định mỗi endpoint (không N+1 — ví dụ `GET /api/matches` chỉ 2 query rồi join trong bộ nhớ), và replay đọc 2 query → tính toàn bộ trong bộ nhớ → ghi 1 `db.batch(..., 'write')` duy nhất (1 transaction, lỗi là rollback hết). Giữ pattern này khi thêm endpoint mới.

**Tuần tự hoá ghi.** Handler là async nên 2 request ghi có thể xen kẽ giữa lúc ghi match và lúc replay → mọi thao tác ghi phải bọc trong `withWriteLock()` (`server/db.js` — promise chain đơn giản).

**Logic ELO** (`server/elo.js`):
- `computeMatchElo(elos, winner, ks, minElo)` — hàm thuần, không đụng DB, được test trong `elo.test.js` (khớp ví dụ mục 3.3 của spec).
- ELO đội = trung bình 2 thành viên; Δ mỗi người = K riêng của người đó × (S − E của đội).
- K riêng từng người: VĐV đấu < `new_threshold` trận dùng `k_new` (mặc định bằng `k_base` = tắt). Khi K hai bên khác nhau, hệ thống không còn zero-sum — đánh đổi có chủ đích.
- ELO lưu **float** trong DB, chỉ làm tròn khi hiển thị. ELO sàn `min_elo`: chạm sàn thì delta thực tế bị cắt.
- Settings (`k_base`, `k_new`, `new_threshold`, `initial_elo`, `min_elo`) lưu trong bảng key-value `settings`, seed mặc định ở `DEFAULT_SETTINGS` (`server/db.js`).

**Frontend** — `public/js/app.js` là SPA vanilla JS một file (hash router, render bằng template string + hàm `esc()` để escape, chart SVG tự vẽ, không dependency). Phân quyền UI: object `AUTH` nạp từ `GET /api/auth` lúc mở trang; `canEdit()` quyết định ẩn/hiện nav (class `.need-auth`/`.guest-only` trong index.html), form, nút Sửa/Xoá; trang `#/login` lưu token vào `localStorage.auth_token`; 401 giữa chừng → xoá token, đá về `#/login`. Guest chỉ xem BXH, VĐV, lịch sử. Ưu tiên trải nghiệm mobile (nhập kết quả ngay tại sân).

## Ràng buộc nghiệp vụ

- Không cho xoá VĐV đã có trận đấu (phải xoá các trận liên quan trước).
- 4 VĐV trong 1 trận phải khác nhau; tỷ số dạng `21-15, 18-21, 21-19` (tuỳ chọn).
- `data/club.db` hiện chứa dữ liệu demo (8 VĐV, 14 trận).
