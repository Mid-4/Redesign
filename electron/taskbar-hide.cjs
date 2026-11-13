// taskbar-hide.cjs — ẩn biểu tượng các cửa sổ Chrome DO APP MỞ (chạy ngầm ngoài màn hình) khỏi thanh taskbar.
// Cách làm: đặt tiêu đề trang = mã đánh dấu riêng -> tìm đúng cửa sổ có tiêu đề đó -> đổi kiểu cửa sổ sang
// WS_EX_TOOLWINDOW (cửa sổ công cụ: Windows không hiện trên taskbar) và bỏ WS_EX_APPWINDOW, ẩn/hiện lại để
// taskbar cập nhật. Cửa sổ vẫn "hiện" (ngoài màn hình) nên Chrome vẫn vẽ trang bình thường (ảnh vẫn tải).
// Chỉ đụng cửa sổ mang mã đánh dấu của app — không đụng Chrome cá nhân của người dùng. Lỗi thì bỏ qua.
const { execFile } = require('node:child_process');

const PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class CRTaskbar {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(P f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  public static int Hide(string mark) {
    int n = 0;
    EnumWindows((h, l) => {
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.ToString().StartsWith(mark)) {
        long ex = GetWindowLongPtr(h, -20).ToInt64();
        long nx = (ex | 0x80L) & ~0x40000L;   // + WS_EX_TOOLWINDOW, - WS_EX_APPWINDOW
        if (nx != ex) { ShowWindow(h, 0); SetWindowLongPtr(h, -20, new IntPtr(nx)); ShowWindow(h, 4); }
        n++;
      }
      return true;
    }, IntPtr.Zero);
    return n;
  }
}
"@
[CRTaskbar]::Hide($env:CR_MARK)
`;

let seq = 0;
const newMark = () => `CRW-${process.pid}-${Date.now().toString(36)}-${++seq}`;

/** Chạy PowerShell đổi kiểu cửa sổ có tiêu đề bắt đầu bằng `mark`. -> số cửa sổ đã xử lý (0 nếu lỗi). */
function hideByMark(mark) {
  if (process.platform !== 'win32') return Promise.resolve(0);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS],
      { windowsHide: true, timeout: 20000, env: { ...process.env, CR_MARK: mark } },
      (err, out) => resolve(err ? 0 : Number(String(out).trim().split(/\s+/).pop()) || 0));
  });
}

/**
 * Ẩn cửa sổ Chrome chứa `page` (Playwright) khỏi taskbar: đánh dấu tiêu đề -> đổi kiểu cửa sổ -> trả tiêu đề cũ.
 * Gọi khi cửa sổ vừa mở (trang about:blank). Thử lại 1 lần nếu chưa thấy cửa sổ (tiêu đề cập nhật chậm).
 */
async function hidePage(page, log = () => {}) {
  if (process.platform !== 'win32' || !page) return false;
  const mark = newMark();
  try {
    const old = await page.evaluate((m) => { const t = document.title; document.title = m; return t; }, mark);
    let n = 0;
    for (let i = 0; i < 2 && !n; i++) { await page.waitForTimeout(400); n = await hideByMark(mark); }
    await page.evaluate((t) => { document.title = t; }, old).catch(() => {});
    if (!n) log('⚠️ Chưa ẩn được biểu tượng Chrome khỏi taskbar (không ảnh hưởng job).');
    return n > 0;
  } catch { return false; }
}

module.exports = { hidePage };
