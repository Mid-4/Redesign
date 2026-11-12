# Comfort Redesign

App Electron (.exe), chạy qua **ChatGPT Work + skill `comfort-redesign`** bằng tài khoản ChatGPT (automation chatgpt.com, không dùng API).

Luồng: thả 1 design, chọn **sản phẩm** (28 loại: T-Shirt/Sweatshirt 1–2 mặt, AOP, pajamas, jersey, blanket, mug, flag, ornament, doormat…) + **người mẫu** (đồ mặc) → app mở tab **Work**, đính kèm design, gõ `@comfort-redesign` + 1 dòng tham số (sản phẩm, người mẫu, màu áo, ghi chú) → agent Work phân tích, lên **5 hướng redesign** (đổi bố cục + style, giữ art + text) làm **mặt sau**, thêm **mặt trước** hợp bộ, tạo **5 mockup 1:1** (nữ mặc Comfort Colors 1717, 2 mặt trước/sau, khung cằm → hông, có background) → app tải 5 ảnh về.

- **Phân tích & Scale:** nút thứ 2. Bước 1 = **agent Claude** (Claude Code CLI, tài khoản Claude của nhân viên, `electron/claude-agent.cjs`): xem design + research Google Shopping, Etsy, Amazon, eBay, Walmart, Redbubble, Reddit, Instagram, Facebook… → báo cáo tiếng Việt (`report.md`, hiện ở trang chi tiết) + 5 brief. Bước 2 = ChatGPT Work skill chế độ `SCALE MODE` vẽ **5 mockup** theo brief. Cài đặt ban đầu có bước Đăng nhập Claude (tự cài Claude nếu máy chưa có; đăng nhập kiểu dán mã).
- **Skill tự cập nhật:** đổi SKILL.md → nén lại zip → bản app mới mở lên tự cài lại skill ngầm vào tài khoản (so hash zip).
- **Prompt nằm trong skill:** [chatgpt-skill/comfort-redesign/SKILL.md](chatgpt-skill/comfort-redesign/SKILL.md). Sửa prompt = sửa skill rồi upload lại (`comfort-redesign.zip`), không cần build lại app.
- **Cài skill (1 lần):** ChatGPT → Plugins → Skills (`chatgpt.com/skills`) → Add → upload `chatgpt-skill/comfort-redesign.zip`.
- **Tạo lại 1 mẫu:** app gửi `Regenerate #N` vào đúng hội thoại Work của job (hội thoại được giữ lại, nút "Mở trong ChatGPT").
- Màu áo Comfort Colors (chỉ T-Shirt/Sweatshirt): AI tự chọn theo từng hướng, hoặc ghim 1 màu cho cả 5.
- Thêm/sửa sản phẩm: sửa `PRODUCTS` trong `electron/prompts.cjs` VÀ mục cùng tên trong SKILL.md (tên phải khớp).
- **Chạy song song:** mỗi job 1 CỬA SỔ Chrome riêng (không dùng tab để tránh tab nền bị Chrome ngừng vẽ). Số job song song 1–5 ở ⚙ Cài đặt (mặc định 4), dư thì xếp hàng. Bước gửi tin chạy lần lượt, bước chờ ChatGPT làm chạy song song.
- Kết quả: `<thư mục lưu>/<job>/` (design gốc, `option-N-*.png`, `job.json`). Đổi thư mục / tên skill ở ⚙ Cài đặt.
- Cần Google Chrome. Lần đầu bấm **Đăng nhập ChatGPT**. Chrome luôn chạy ngầm (ngoài màn hình).
- Máy/tài khoản ChatGPT khác: phải upload skill `chatgpt-skill/comfort-redesign.zip` vào tài khoản đó trước.

## Chạy / build
```
npm install
npm start          # terminal VSCode: unset ELECTRON_RUN_AS_NODE trước
npm run check      # kiểm tra cú pháp + sản phẩm khớp SKILL.md + zip skill mới nhất
npm run dist:win   # release/Comfort-Redesign-Setup-x.y.z.exe (bộ cài, không đăng)
```
Dữ liệu app: `%APPDATA%\comfort-redesign` (đăng nhập ChatGPT, cài đặt, jobs/*.json, app.log).

## Phát hành bản mới (tự cập nhật cho nhân viên)
- Code: `Mid-4/comfort-redesign` (private) · Bộ cài + cập nhật: `Mid-4/comfort-redesign-releases` (public).
- Token GitHub fine-grained, quyền **Contents: Read and write** trên 2 repo trên → dán vào file `.gh-token` (đã gitignore).
- Commit hết thay đổi rồi chạy `npm run release` (patch) / `npm run release -- minor`. Lỗi lúc build/đăng: `npm run release -- retry`.
- Máy nhân viên đã cài bản Setup: mở app tự tải bản mới → nút "⟳ Khởi động lại & cập nhật" (hoặc tắt app là tự cài).
- Lần đầu gửi nhân viên: file `release/Comfort-Redesign-Setup-x.y.z.exe` (bản portable cũ không tự cập nhật được).

## File chính
- `chatgpt-skill/`: skill cho ChatGPT Work (prompt đầy đủ)
- `electron/chatgpt-runner.cjs`: automation ChatGPT Work (tab Work, @skill, chờ đủ ảnh, tải ảnh)
- `electron/prompts.cjs`: tin nhắn ngắn gửi kèm skill, đọc danh sách "N. Tên — Màu — Tóm tắt", bảng màu
- `electron/main.cjs`: điều phối job, lưu file, ép ảnh 1:1
- `renderer/`: giao diện HTML/JS thuần
