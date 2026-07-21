# Đặc tả dự án: Bảng xếp hạng ELO cho CLB Cầu lông

## 1. Tổng quan

Xây dựng một trang web nội bộ cho CLB cầu lông để **xếp hạng cá nhân các VĐV** dựa trên hệ thống điểm **ELO**, được tính toán từ kết quả các **trận đấu đôi giao hữu** (CLB chủ yếu đánh đôi, không đánh đơn).

Vấn đề cốt lõi cần giải quyết: làm sao tính điểm ELO **cho từng cá nhân** trong khi trận đấu diễn ra theo **đội 2 người** — xem mục 3.

## 2. Yêu cầu chức năng

### 2.1 Quản lý VĐV
- Thêm / sửa / xoá VĐV (tên, có thể có ảnh đại diện, ghi chú)
- Mỗi VĐV có điểm ELO khởi điểm mặc định (ví dụ 1000), có thể cấu hình
- Xem danh sách toàn bộ VĐV

### 2.2 Ghi nhận trận đấu
- Form nhập 1 trận đấu đôi mới:
  - Chọn 2 người Đội A, 2 người Đội B (từ danh sách VĐV có sẵn)
  - Chọn đội thắng
  - (Tùy chọn) Nhập tỷ số từng ván, ví dụ: `21-15, 18-21, 21-19`
  - Ngày giờ thi đấu (mặc định = thời điểm nhập)
- Sau khi submit: hệ thống tự động tính lại ELO cho cả 4 người theo công thức ở mục 3, lưu lại lịch sử

### 2.3 Bảng xếp hạng (Leaderboard)
- Danh sách VĐV sắp xếp theo ELO giảm dần
- Hiển thị: hạng, tên, ELO hiện tại, số trận đã đấu, số thắng/thua, tỷ lệ thắng
- Cho phép lọc theo khoảng thời gian (tuỳ chọn, có thể làm sau nếu phức tạp)

### 2.4 Trang chi tiết từng VĐV
- ELO hiện tại + biểu đồ diễn biến ELO theo thời gian
- Lịch sử các trận đã đấu (đồng đội, đối thủ, thắng/thua, thay đổi ELO)
- Thống kê: tổng số trận, tỷ lệ thắng, đồng đội đấu cùng nhiều nhất, v.v. (nice-to-have)

### 2.5 Lịch sử trận đấu
- Danh sách toàn bộ trận đã ghi nhận, mới nhất lên đầu
- Cho phép sửa/xoá 1 trận đã nhập sai → khi sửa/xoá, hệ thống cần **tính toán lại ELO** cho các trận bị ảnh hưởng (xem lưu ý ở mục 3.4)

## 3. Thuật toán tính ELO cho đánh đôi (phần quan trọng nhất)

### 3.1 Nguyên tắc
Mỗi VĐV có 1 điểm ELO cá nhân duy nhất, dùng cho mọi trận (dù đánh đôi). Điểm ELO được cập nhật sau mỗi trận dựa trên **ELO trung bình của đội mình** so với **ELO trung bình của đội đối phương**.

### 3.2 Công thức

Với 1 trận đấu giữa Đội A (VĐV A1, A2) và Đội B (VĐV B1, B2):

```
EloA = (elo(A1) + elo(A2)) / 2
EloB = (elo(B1) + elo(B2)) / 2

Kỳ vọng thắng của đội A:
E_A = 1 / (1 + 10 ^ ((EloB - EloA) / 400))
E_B = 1 - E_A

Kết quả thực tế:
S_A = 1 nếu đội A thắng, 0 nếu thua
S_B = 1 - S_A

Thay đổi điểm cho cả đội:
Δ_A = K * (S_A - E_A)
Δ_B = K * (S_B - E_B)   (= -Δ_A)

Áp dụng cho từng cá nhân (mỗi người trong đội nhận cùng mức thay đổi):
elo(A1) += Δ_A
elo(A2) += Δ_A
elo(B1) += Δ_B
elo(B2) += Δ_B
```

- **K** là hệ số ảnh hưởng, mặc định `K = 32`. Nên để **cấu hình được** (config), và có thể cân nhắc (nice-to-have): K cao hơn cho VĐV mới (< 10 trận) để hội tụ nhanh hơn, K thấp hơn cho VĐV kỳ cựu.
- Làm tròn Δ đến số nguyên gần nhất khi hiển thị, nhưng nên **lưu ELO dạng số thực (float)** trong DB để tránh sai số cộng dồn.
- Đặt ELO sàn tối thiểu (ví dụ không cho xuống dưới 100) để tránh số âm bất hợp lý.

### 3.3 Ví dụ minh hoạ
- A1 = 1000, A2 = 1100 → EloA = 1050
- B1 = 950, B2 = 1050 → EloB = 1000
- E_A = 1 / (1 + 10^((1000-1050)/400)) ≈ 0.572
- Nếu Đội A thắng: Δ_A = 32 × (1 − 0.572) ≈ +13.7 → A1, A2 mỗi người +14 điểm
- Đội B thua: mỗi người trong B −14 điểm

### 3.4 Lưu ý khi sửa/xoá trận đấu
Vì ELO là tích luỹ tuần tự, sửa hoặc xoá 1 trận cũ về lý thuyết cần tính toán lại toàn bộ chuỗi ELO của các VĐV liên quan từ thời điểm đó trở đi. Cách đơn giản và an toàn nhất: khi có thay đổi dữ liệu trận đấu, **tính lại ELO từ đầu cho toàn bộ hệ thống** theo đúng thứ tự thời gian của tất cả các trận (replay toàn bộ lịch sử). Với quy mô 1 CLB, số lượng trận sẽ không lớn nên cách này đủ nhanh và tránh bug.

## 4. Mô hình dữ liệu (gợi ý)

**Player**
- id, name, avatar_url (optional), elo (float), created_at

**Match**
- id, date
- team_a: [player_id, player_id]
- team_b: [player_id, player_id]
- winner: "A" | "B"
- score: string (optional, ví dụ "21-15, 18-21, 21-19")
- created_at

**EloHistory** (snapshot sau mỗi trận, phục vụ biểu đồ + audit)
- id, match_id, player_id, elo_before, elo_after, delta, date

(Các trường elo hiện tại của Player có thể derive từ EloHistory mới nhất, hoặc lưu trực tiếp trên Player và đồng bộ — tuỳ cách triển khai.)

## 5. Các trang giao diện cần có
1. **Trang chủ / Bảng xếp hạng** — mặc định khi mở web
2. **Ghi nhận trận đấu mới** — form nhập nhanh, thao tác trên điện thoại thuận tiện (nhập ngay tại sân)
3. **Quản lý VĐV** — thêm/sửa/xoá
4. **Lịch sử trận đấu** — danh sách, sửa/xoá
5. **Chi tiết VĐV** — ELO theo thời gian + lịch sử đối đầu

## 6. Yêu cầu phi chức năng
- Giao diện **responsive**, ưu tiên trải nghiệm tốt trên điện thoại (vì sẽ nhập kết quả ngay tại sân)
- UI đơn giản, rõ ràng, ít bước thao tác khi nhập 1 trận đấu
- Không bắt buộc có hệ thống đăng nhập phức tạp ở bản đầu tiên (có thể thêm mật khẩu admin đơn giản để bảo vệ thao tác sửa/xoá nếu cần, nhưng không phải ưu tiên)

## 7. Đề xuất công nghệ (có thể điều chỉnh)
- Frontend + Backend: Next.js (full-stack) hoặc React (frontend) + Node/Express (backend)
- Database: SQLite (đơn giản, phù hợp quy mô 1 CLB, dễ chạy local) qua Prisma ORM, hoặc lưu JSON nếu muốn tối giản hơn nữa
- Có thể tự do chọn stack khác nếu hợp lý hơn, miễn đáp ứng được yêu cầu chức năng ở trên

## 8. Ngoài phạm vi (Out of scope)
- Triển khai (deploy) lên server/hosting — sẽ thực hiện ở bước riêng sau
- Hỗ trợ nhiều CLB (multi-tenant)
- Đăng nhập/phân quyền phức tạp
