// ============================================================================
// chatgpt-runner.cjs — điều khiển ChatGPT web (chatgpt.com) bằng Playwright.
// (Khung login/đính kèm copy từ Design Transfer 2; luồng việc chạy trong ChatGPT WORK + skill.)
//
// Dùng TÀI KHOẢN ChatGPT đã đăng nhập -> không tốn API.
// Chỉ thao tác như người dùng (click/gõ/upload), KHÔNG gọi API nội bộ.
// Login hiện cửa sổ -> sau đó chạy NGẦM (off-screen). Hội thoại Work được GIỮ để tạo lại từng mẫu.
//
// ⚠️ ChatGPT chặn bot mạnh (Cloudflare). UI hay đổi -> selector gom ở khối SEL.
// ============================================================================
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ----------------------------- CONFIG (chỉnh ở đây) -------------------------
const CHATGPT_URL = process.env.CHATGPT_URL || 'https://chatgpt.com/';
const RUN_HEADLESS = false;   // ChatGPT/Cloudflare chặn headless -> dùng cửa sổ off-screen
const ALWAYS_VISIBLE = false; // true = luôn hiện cửa sổ (debug); false = chạy ngầm (chỉ hiện khi login)

const SEL = {
  // Ô soạn tin (ChatGPT dùng contenteditable #prompt-textarea).
  promptInput: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'],
  // Dấu hiệu CHƯA đăng nhập.
  signIn: ['[data-testid="login-button"]', '[data-testid="signup-button"]', 'button:has-text("Log in")', 'a:has-text("Log in")', 'button:has-text("Sign up")', 'button:has-text("Đăng nhập")'],
  // Input file để đính kèm ảnh (thường ẩn).
  fileInput: ['input[type="file"]'],
  // Nút "+" mở menu đính kèm.
  attachBtn: [
    'button[data-testid="composer-plus-btn"]',
    'button[aria-label*="Add files" i]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Add photos" i]',
    'button[aria-label*="upload" i]',
    'button[aria-label*="đính kèm" i]',
    'button[aria-label*="Thêm" i]',
    'button:has-text("add")',
  ],
  // Mục "Upload from computer" / "Tải lên từ máy tính" trong menu "+".
  uploadMenuItem: [
    '[role="menuitem"]:has-text("Upload from computer")',
    '[role="menuitem"]:has-text("Tải lên từ máy tính")',
    '[role="menuitem"]:has-text("Add photos")',
    '[role="menuitem"]:has-text("Upload")',
    '[role="menuitem"]:has-text("Tải lên")',
  ],
  // Nút gửi.
  sendBtn: ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[aria-label*="Gửi" i]'],
  // Nút dừng = ChatGPT đang trả lời.
  stopBtn: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]', 'button[aria-label*="Dừng" i]'],
};

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const TASK_TIMEOUT_MS = 45 * 60 * 1000; // 1 việc Work (phân tích/research + 4–5 ảnh) có thể lâu
const SLOW_MO_MS = 120;
const LOGIN_GRACE_MS = 8000; // đã đăng nhập rồi vẫn chờ chừng này để user kịp ĐỔI TÀI KHOẢN
const CLOSE_IDLE_MS = 6000;  // xong hết, hàng đợi rảnh -> tự đóng cửa sổ sau chừng này
// ---------------------------------------------------------------------------

let context = null;
let mainPage = null;   // tab đầu của cửa sổ (đăng nhập / đặt vị trí cửa sổ)
// Mỗi việc chạy trong 1 TAB riêng; pg() trả tab của việc đang chạy (AsyncLocalStorage) -> chạy song song được.
const { AsyncLocalStorage } = require('node:async_hooks');
const tabStore = new AsyncLocalStorage();
const pg = () => tabStore.getStore() || mainPage;
let active = 0;        // số việc đang chạy
let ctxReady = null;   // promise mở Chrome dùng chung khi nhiều việc khởi động cùng lúc
let sendLock = Promise.resolve(); // bước gửi tin (đính kèm, @skill, gõ, gửi) chạy LẦN LƯỢT
let closeTimer = null; // hẹn giờ tự đóng cửa sổ khi rảnh
const noop = () => {};

function cancelCloseTimer() { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } }
function scheduleCloseTimer(log) {
  cancelCloseTimer();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (active > 0) return;
    log('Hoàn tất — tự đóng cửa sổ Chrome.');
    close().catch(() => {});
  }, CLOSE_IDLE_MS);
}

async function firstVisible(scope, candidates, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of candidates) {
      const loc = scope.locator(sel).first();
      try { if (await loc.isVisible()) return loc; } catch {}
    }
    await scope.waitForTimeout(300);
  }
  return null;
}

async function firstPresent(scope, candidates) {
  for (const sel of candidates) {
    const loc = scope.locator(sel).first();
    try { if (await loc.count()) return loc; } catch {}
  }
  return null;
}

/** ĐÃ đăng nhập = không còn nút Log in/Sign up + có ô soạn tin. */
async function isLoggedIn() {
  if (/auth0|login|\/auth/.test(pg().url())) return false;
  await pg().waitForTimeout(1000);
  for (const sel of SEL.signIn) {
    try { if (await pg().locator(sel).first().isVisible()) return false; } catch {}
  }
  return !!(await firstVisible(pg(), SEL.promptInput, 2500));
}

async function withRetry(label, fn, log, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      log(`[retry ${i}/${tries}] ${label}: ${e.message || e}`);
      if (pg()) await pg().waitForTimeout(1000 * i);
    }
  }
  throw new Error(`${label} thất bại sau ${tries} lần: ${lastErr?.message || lastErr}`);
}

function writeTempImages(images) {
  const dir = path.join(os.tmpdir(), 'comfort-redesign-chatgpt');
  fs.mkdirSync(dir, { recursive: true });
  return images.map((im, i) => {
    const ext = (im.mimeType?.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const p = path.join(dir, `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}.${ext}`);
    fs.writeFileSync(p, Buffer.from(im.base64, 'base64'));
    return p;
  });
}

const OFFSCREEN = { left: -32000, top: -32000, width: 1366, height: 900 };
const ONSCREEN = { left: 60, top: 40, width: 1280, height: 860 }; // cửa sổ đăng nhập

/**
 * Chrome nhớ trạng thái cửa sổ trong profile; nếu đã lưu "maximized" thì lần sau mở
 * phóng to NGAY TRÊN MÀN HÌNH, bỏ qua --window-position -> phải xoá cờ này trước khi chạy ngầm.
 */
function clearMaximized(profileDir) {
  const f = path.join(profileDir, 'Default', 'Preferences');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const wp = j.browser && j.browser.window_placement;
    if (wp && wp.maximized) { wp.maximized = false; fs.writeFileSync(f, JSON.stringify(j)); }
  } catch {}
}

/**
 * Không cho Chrome khôi phục phiên cũ: app bị tắt giữa chừng -> hồ sơ đánh dấu "Crashed" -> lần mở sau Chrome
 * tự mở lại mọi cửa sổ cũ (about:blank, chatgpt.com…) sau ~30s (lỗi đã gặp 12/11). Đánh dấu tắt bình thường
 * + xoá dữ liệu phiên/tab (chỉ file phiên — đăng nhập, cookie giữ nguyên).
 */
function noSessionRestore(profileDir) {
  const f = path.join(profileDir, 'Default', 'Preferences');
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.profile = { ...(j.profile || {}), exit_type: 'Normal', exited_cleanly: true };
    j.session = { ...(j.session || {}), restore_on_startup: 5 }; // 5 = mở trang tab mới, không khôi phục
    fs.writeFileSync(f, JSON.stringify(j));
  } catch {}
  for (const d of ['Sessions', 'Sessions_Encrypted']) {
    const dir = path.join(profileDir, 'Default', d);
    try { for (const x of fs.readdirSync(dir)) fs.rmSync(path.join(dir, x), { force: true, recursive: true }); } catch {}
  }
}

/** Ép vị trí cửa sổ qua CDP (chốt chặn cuối nếu Chrome tự đặt cửa sổ theo trạng thái đã nhớ). */
async function placeWindow(bounds, log, target = mainPage) {
  try {
    const cdp = await context.newCDPSession(target);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds });
    await cdp.detach().catch(() => {});
  } catch (e) { log('⚠️ Không đặt được vị trí cửa sổ Chrome: ' + (e.message || e)); }
}

let hidden = false;    // cửa sổ hiện tại đang chạy ngầm?
let watch = false;     // người dùng bật "Xem Chrome" -> cửa sổ hiện trên màn hình
let loginOpen = false; // đang mở cửa sổ đăng nhập

/** Mở Chrome + profile riêng cho ChatGPT. visible=true để đăng nhập; false = chạy ngầm. */
async function ensureContext(profileDir, log, visible) {
  if (context) return;
  const wantVisible = visible || ALWAYS_VISIBLE || watch;
  const headless = !wantVisible && RUN_HEADLESS;
  log(wantVisible ? 'Mở Chrome (hiện cửa sổ)…' : 'Chạy ChatGPT NGẦM (ẩn cửa sổ)…');
  fs.mkdirSync(profileDir, { recursive: true });
  if (!wantVisible) clearMaximized(profileDir);
  noSessionRestore(profileDir);
  // Cửa sổ đăng nhập: kích thước cố định (KHÔNG maximize, để profile không nhớ trạng thái phóng to).
  const args = wantVisible
    ? [`--window-position=${ONSCREEN.left},${ONSCREEN.top}`, `--window-size=${ONSCREEN.width},${ONSCREEN.height}`, '--disable-blink-features=AutomationControlled']
    : ['--disable-blink-features=AutomationControlled', '--hide-crash-restore-bubble',
       ...(headless ? [] : [`--window-position=${OFFSCREEN.left},${OFFSCREEN.top}`, `--window-size=${OFFSCREEN.width},${OFFSCREEN.height}`])];
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless,
      viewport: null,
      acceptDownloads: true,
      slowMo: SLOW_MO_MS,
      chromiumSandbox: true,
      args,
      timeout: 45000,
    });
  } catch (e) {
    log(`❌ Mở Chrome thất bại: ${e.message || e}`);
    log('→ Nếu còn cửa sổ Chrome do app mở trước đó, hãy đóng nó rồi thử lại.');
    throw e;
  }
  mainPage = context.pages()[0] || (await context.newPage());
  context.on('close', () => { context = null; mainPage = null; busyPages.clear(); });
  // Cửa sổ gốc bị đóng (huỷ job đang dùng nó) -> lấy cửa sổ khác còn mở làm gốc.
  context.on('page', (p) => p.on('close', () => {
    busyPages.delete(p);
    if (p === mainPage) mainPage = context?.pages().find((x) => !x.isClosed()) || null;
  }));
  const first = mainPage;
  first.on('close', () => { busyPages.delete(first); if (mainPage === first) mainPage = context?.pages().find((x) => !x.isClosed()) || null; });
  hidden = !wantVisible && !headless;
  if (!headless) await placeWindow(hidden ? OFFSCREEN : ONSCREEN, log);
}

/** Mở ChatGPT + đảm bảo đã đăng nhập. */
async function ensureChatReady(log, waitForLogin, url = CHATGPT_URL) {
  try {
    if (!hidden) await pg().bringToFront(); // chạy ngầm thì không kéo Chrome lên (khỏi giành focus)
    await pg().goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log(`⚠️ Không mở được ChatGPT: ${e.message || e}`);
  }
  // Nhiều tab tải cùng lúc -> trang chậm: chờ tới 25s, chỉ kết luận "chưa đăng nhập" khi thấy nút Log in.
  for (const end = Date.now() + 25000; Date.now() < end;) {
    if (await isLoggedIn()) { log('ChatGPT sẵn sàng (đã đăng nhập).'); return; }
    if (/auth0|login|\/auth/.test(pg().url()) || await firstVisible(pg(), SEL.signIn, 300)) break;
    await pg().waitForTimeout(1500);
  }

  if (!waitForLogin) {
    throw new Error('ChatGPT chưa đăng nhập hoặc phiên đã hết hạn — bấm nút "Đăng nhập ChatGPT" trên app.');
  }
  log('⚠️ Hãy ĐĂNG NHẬP ChatGPT trong cửa sổ Chrome (gặp Cloudflare thì tự xác minh). Đang chờ…');
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isLoggedIn()) { log('✅ Đã xác nhận đăng nhập.'); return; }
    await pg().waitForTimeout(2000);
  }
  throw new Error('Hết thời gian chờ đăng nhập ChatGPT.');
}

/** Lấy bounding box của ô soạn tin. */
async function getPromptBox() {
  for (const sel of SEL.promptInput) {
    try { const b = await pg().locator(sel).first().boundingBox(); if (b) return b; } catch {}
  }
  return null;
}

/** Bấm nút "+": (a) selector -> (b) nút ngay bên trái ô soạn cùng hàng -> (c) toạ độ. */
async function clickPlusButton(log) {
  const bySel = await firstVisible(pg(), SEL.attachBtn, 4000);
  if (bySel) { await bySel.click(); log('Đã bấm "+" (selector).'); return true; }

  const okStruct = await pg().evaluate((sels) => {
    const input = sels.map((s) => document.querySelector(s)).find(Boolean)
      || document.querySelector('[contenteditable="true"], textarea');
    if (!input) return false;
    const r = input.getBoundingClientRect();
    let best = null, bestDx = 1e9;
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      const rb = b.getBoundingClientRect();
      if (!rb.width) continue;
      const sameRow = Math.abs((rb.top + rb.bottom) / 2 - (r.top + r.bottom) / 2) < 40;
      const dx = r.left - rb.right;
      if (sameRow && dx >= -12 && dx < bestDx) { bestDx = dx; best = b; }
    }
    if (best) { best.click(); return true; }
    return false;
  }, SEL.promptInput).catch(() => false);
  if (okStruct) { log('Đã bấm "+" (cấu trúc).'); return true; }

  const box = await getPromptBox();
  if (box) {
    const x = Math.max(8, box.x - 30), y = box.y + box.height / 2;
    log(`Bấm "+" theo toạ độ (${Math.round(x)}, ${Math.round(y)}).`);
    await pg().mouse.click(x, y);
    return true;
  }
  return false;
}

/** Đính kèm ảnh: input sẵn -> hoặc "+" -> "Upload from computer" (bắt cả file dialog). */
async function attachImages(imagePaths, log) {
  let input = await firstPresent(pg(), SEL.fileInput);
  if (input) { await input.setInputFiles(imagePaths); log(`Đã đính kèm ${imagePaths.length} ảnh.`); return; }

  if (!(await clickPlusButton(log))) throw new Error('Không bấm được nút "+" để đính kèm.');
  await pg().waitForTimeout(800);

  const uploadItem = await firstVisible(pg(), SEL.uploadMenuItem, 5000);
  if (uploadItem) {
    try {
      const [chooser] = await Promise.all([
        pg().waitForEvent('filechooser', { timeout: 8000 }),
        uploadItem.click(),
      ]);
      await chooser.setFiles(imagePaths);
      log(`Đã đính kèm ${imagePaths.length} ảnh (hộp chọn file).`);
      return;
    } catch {
      input = await firstPresent(pg(), SEL.fileInput);
      if (input) { await input.setInputFiles(imagePaths); log(`Đã đính kèm ${imagePaths.length} ảnh.`); return; }
    }
  }

  input = await firstPresent(pg(), SEL.fileInput);
  if (input) { await input.setInputFiles(imagePaths); log(`Đã đính kèm ${imagePaths.length} ảnh.`); return; }
  throw new Error('Không tìm thấy cách đính kèm ảnh (nút "+"/Upload).');
}

/** Text vùng hội thoại đang HIỆN (trang có nhiều <main>, khối trang chủ Work bị ẩn vẫn còn trong DOM). */
async function pageText() {
  return pg().evaluate(() => {
    const mains = [...document.querySelectorAll('main')].filter((m) => m.offsetParent !== null);
    mains.sort((a, b) => b.innerText.length - a.innerText.length);
    return (mains[0] || document.body).innerText || '';
  }).catch(() => '');
}

/** Nội dung các khối code trong hội thoại đang hiện (markdown gốc, giữ nguyên link). */
async function codeBlocks() {
  return pg().evaluate(() => {
    const mains = [...document.querySelectorAll('main')].filter((m) => m.offsetParent !== null);
    mains.sort((a, b) => b.innerText.length - a.innerText.length);
    return [...(mains[0] || document.body).querySelectorAll('pre')].map((p) => (p.querySelector('code') || p).textContent || '');
  }).catch(() => []);
}
const result = async (files) => ({ url: pg().url(), files, reply: await pageText(), blocks: await codeBlocks() });

/** ChatGPT đang làm? Work hiện "Working for 1m 33s" (xong thì "Worked for …"); chat thường có nút Stop. */
async function isBusy() {
  if (/\bWorking for\b|\bCreating image\b/i.test(await pageText())) return true;
  for (const sel of SEL.stopBtn) {
    try { if (await pg().locator(sel).first().isVisible()) return true; } catch {}
  }
  return false;
}

async function debugShot(downloadDir, e, log) {
  try {
    const shot = path.join(downloadDir, `chatgpt-debug-${Date.now()}.png`);
    await pg().screenshot({ path: shot, fullPage: true });
    log(`📸 Lỗi "${e.message || e}" — ảnh chụp màn hình: ${shot}`);
  } catch {}
}

// ----------------------------- ChatGPT Work ---------------------------------

/** Chuyển sang tab "Work" (trang chủ có 2 tab Chat / Work). */
async function selectWorkMode(log) {
  for (let i = 0; i < 4; i++) {
    const ok = await pg().evaluate(() => {
      const b = [...document.querySelectorAll('button,[role=tab]')]
        .find((e) => (e.innerText || '').trim() === 'Work' && e.getBoundingClientRect().width);
      if (b) { b.click(); return true; }
      return false;
    }).catch(() => false);
    if (ok) {
      await pg().waitForTimeout(1500);
      const inWork = await pg().evaluate(() => {
        const ed = [...document.querySelectorAll('[contenteditable="true"]')].find((e) => e.getBoundingClientRect().width);
        const ph = ed ? (ed.getAttribute('placeholder') || ed.getAttribute('aria-label') || '') : '';
        return /work/i.test(ph) || /what should we work on/i.test(document.body.innerText);
      }).catch(() => false);
      log(inWork ? 'Đã chuyển sang ChatGPT Work.' : '⚠️ Đã bấm tab Work nhưng chưa chắc đã vào Work — vẫn tiếp tục.');
      return;
    }
    await pg().waitForTimeout(1500);
  }
  throw new Error('Không thấy tab "Work" — tài khoản đang đăng nhập chưa có ChatGPT Work?');
}

/** Gõ "@<skill>" rồi chọn skill trong popup. Không thấy skill -> xoá chữ đã gõ, trả false. */
async function mentionSkill(skill, log) {
  const box = await firstVisible(pg(), SEL.promptInput, 8000);
  if (!box) throw new Error('Không thấy ô soạn tin.');
  await box.click({ force: true }).catch(() => {});
  await pg().keyboard.press('Control+End').catch(() => {});
  await pg().keyboard.type('@' + skill, { delay: 35 });
  await pg().waitForTimeout(2500);
  const picked = await pg().evaluate((name) => {
    const norm = (s) => (s || '').toLowerCase().replace(/[\s_-]+/g, '');
    const want = norm(name);
    const cands = [...document.querySelectorAll('[role=option],[role=menuitem],[cmdk-item],li,button,div,span')]
      .filter((e) => e.getBoundingClientRect().width && !e.closest('[contenteditable="true"]') && !e.closest('nav')
        && (e.innerText || '').length < 200 && norm(e.innerText).includes(want));
    cands.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length); // lá nhỏ nhất khớp tên
    const t = cands[0];
    if (!t) return null;
    const c = t.closest('[role=option],[role=menuitem],[cmdk-item],button,li') || t;
    c.click();
    return (c.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  }, skill).catch(() => null);
  if (picked) { log(`Đã chọn skill: ${picked}`); await pg().waitForTimeout(800); return true; }
  log(`⚠️ Không thấy skill "${skill}" trong popup @ — ghi tên skill vào tin nhắn thay thế.`);
  await pg().keyboard.press('Escape').catch(() => {});
  for (let i = 0; i <= skill.length; i++) await pg().keyboard.press('Backspace');
  return false;
}

/** Gõ thêm text vào cuối ô soạn (giữ nguyên chip skill / ảnh đã đính kèm). */
async function typeText(text, log) {
  await withRetry('Nhập tin nhắn', async () => {
    const box = await firstVisible(pg(), SEL.promptInput, 8000);
    if (!box) throw new Error('Không thấy ô soạn tin.');
    const before = ((await box.textContent().catch(() => '')) || '').length;
    await box.click({ force: true, timeout: 5000 }).catch(() => {});
    await pg().keyboard.press('Control+End').catch(() => {});
    await pg().keyboard.insertText(text);
    await pg().waitForTimeout(300);
    const after = ((await box.textContent().catch(() => '')) || '').length;
    if (after < before + Math.min(5, text.length)) throw new Error('Tin nhắn chưa vào được ô soạn.');
    log(`Đã nhập tin nhắn (${text.length} ký tự).`);
  }, log);
}

async function clickSend(log) {
  await withRetry('Gửi', async () => {
    const send = await firstVisible(pg(), SEL.sendBtn, 15000);
    if (send) { await send.click(); log('Đã gửi.'); }
    else { await pg().keyboard.press('Enter'); log('Đã gửi bằng Enter.'); }
  }, log);
}

/**
 * Ảnh ChatGPT tạo trong hội thoại: src duy nhất, theo thứ tự.
 * Work hiện nhiều ảnh dạng gallery: 1 ảnh lớn + thumbnail 54px (alt rỗng nhưng là ảnh gốc 1254px)
 * -> lọc theo kích thước GỐC (naturalWidth), lấy thứ tự theo thumbnail trước, rồi các ảnh đơn.
 */
async function listGenerated() {
  return pg().evaluate(() => {
    const ok = (i) => i.naturalWidth >= 512 && !/user attachment/i.test(i.alt || '')
      && !i.closest('nav') && !i.closest('[contenteditable="true"]');
    const imgs = [...document.querySelectorAll('img')].filter(ok);
    // Thumbnail nằm trong nút "Show generated image N" -> xếp theo N trong từng gallery (gallery mới bắt đầu ở N=1),
    // không tin thứ tự DOM.
    const idx = (i) => +(((i.closest('button,[role=button]')?.getAttribute('aria-label') || '').match(/generated image (\d+)/i) || [])[1] || 0);
    const groups = [];
    for (const i of imgs.filter((x) => x.getBoundingClientRect().width < 100)) {
      if (!groups.length || idx(i) <= 1) groups.push([]);
      groups[groups.length - 1].push(i);
    }
    const thumbs = groups.flatMap((g) => g.sort((a, b) => idx(a) - idx(b)));
    const seen = new Set(), out = [];
    for (const i of [...thumbs, ...imgs]) {
      const src = i.currentSrc || i.src;
      if (src && !seen.has(src)) { seen.add(src); out.push(src); }
    }
    return out;
  }).catch(() => []);
}

/** Số ô ảnh trong gallery ("Show generated image N") mà ảnh chưa tải xong — gallery vừa gom lại thì ảnh load dần. */
async function galleryPending() {
  return pg().evaluate(() => [...document.querySelectorAll('button[aria-label],[role=button][aria-label]')]
    .filter((b) => /generated image \d+/i.test(b.getAttribute('aria-label') || ''))
    .filter((b) => { const i = b.querySelector('img'); return !i || !i.complete || i.naturalWidth < 512; }).length).catch(() => 0);
}

/**
 * Chờ tới khi có đủ `expect` ảnh mới và ChatGPT xong việc ("Worked for…", trang đứng yên).
 * ChatGPT dừng mà chưa đủ ảnh -> trả số ảnh đang có.
 */
async function waitForImages(before, expect, log, onImages) {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  let lastSig = '', lastChange = Date.now(), lastN = -1;
  while (Date.now() < deadline) {
    await pg().waitForTimeout(3000);
    const list = (await listGenerated()).slice(before);
    const sig = list.join('|') + '#' + (await pageText());
    if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
    if (list.length !== lastN) { lastN = list.length; if (lastN) log(`Đã có ${lastN}/${expect} ảnh…`); onImages?.(lastN); }
    if (await isBusy()) continue;
    const quiet = Date.now() - lastChange;
    // Gallery còn ô chưa tải ảnh -> chờ thêm (tối đa 60s), không thì tải thiếu ảnh (lỗi đã gặp 12/11).
    if (list.length >= expect && quiet < 60000 && await galleryPending()) continue;
    if (list.length >= expect && quiet > 12000) return list.length;
    if (quiet > 120000) return list.length; // ChatGPT đã dừng hẳn mà chưa đủ ảnh
  }
  log('⚠️ Hết thời gian chờ ChatGPT Work.');
  return Math.max(0, lastN);
}

/** Tải các ảnh mới (từ vị trí `before`) về downloadDir. */
async function downloadGenerated(before, downloadDir, log) {
  fs.mkdirSync(downloadDir, { recursive: true });
  const srcs = (await listGenerated()).slice(before);
  const files = [];
  for (const [k, src] of srcs.entries()) {
    const data = await pg().evaluate(async (u) => {
      const r = await fetch(u); if (!r.ok) return null;
      const b = await r.blob();
      const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
      return { type: b.type, b64: String(url).split(',')[1] };
    }, src).catch(() => null);
    if (!data?.b64) { log(`⚠️ Không tải được ảnh ${k + 1}.`); continue; }
    const ext = /jpe?g/.test(data.type) ? 'jpg' : /webp/.test(data.type) ? 'webp' : 'png';
    const out = path.join(downloadDir, `work-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${k + 1}.${ext}`);
    fs.writeFileSync(out, Buffer.from(data.b64, 'base64'));
    files.push(out);
  }
  log(`Đã tải ${files.length} ảnh.`);
  return files;
}

/**
 * 1 việc trong ChatGPT Work: (hội thoại mới ở tab Work | hội thoại cũ theo url)
 * -> đính kèm -> @skill -> tin nhắn -> gửi -> chờ đủ ảnh -> tải về.
 * collectOnly: không gửi gì, chỉ chờ + tải ảnh có sẵn trong hội thoại `url`.
 * onUrl(url): gọi ngay khi biết link hội thoại (để lỡ app lỗi vẫn lấy lại được kết quả).
 */
async function workTaskOnce({ url, skill, message, images, expect = 1, downloadDir, collectOnly, onUrl, onStep = noop, onImages }, log) {
  if (url) await ensureChatReady(log, false, url);
  else { await ensureChatReady(log, false, CHATGPT_URL); await selectWorkMode(log); }
  await pg().waitForTimeout(2500);

  if (collectOnly) {
    log('Đang lấy kết quả từ hội thoại ChatGPT…');
    onStep('work');
    const n = await waitForImages(0, expect, log, onImages);
    if (n <= 0) throw new Error('Hội thoại chưa có ảnh nào.');
    onStep('download');
    return result(await downloadGenerated(0, downloadDir, log));
  }

  const before = (await listGenerated()).length;
  const imagePaths = writeTempImages(images || []);
  try {
    onStep('send');
    await withSendLock(log, async () => {
      if (imagePaths.length) {
        await withRetry('Đính kèm ảnh', async () => { await attachImages(imagePaths, log); await pg().waitForTimeout(2500); }, log);
      }
      let text = message;
      if (skill && !(await mentionSkill(skill, log))) text = `Use the "${skill}" skill. ${message}`;
      await typeText((skill ? ' ' : '') + text, log);
      await clickSend(log);
      for (let i = 0; i < 15 && !/\/c\//.test(pg().url()); i++) await pg().waitForTimeout(1000);
    });
    if (onUrl && /\/c\//.test(pg().url())) onUrl(pg().url());
    log(`ChatGPT Work đang làm (chờ ${expect} ảnh, có thể mất 5–30 phút)…`);
    onStep('work');

    let n = await waitForImages(before, expect, log, onImages);
    if (n > 0 && n < expect) {
      log(`Mới có ${n}/${expect} ảnh — nhắc ChatGPT làm tiếp…`);
      await withSendLock(log, async () => {
        await typeText(`Continue: create the remaining ${expect - n} mockup image(s) now, then give the final list.`, log);
        await clickSend(log);
      });
      n = await waitForImages(before, expect, log, onImages);
    }
    if (n <= 0) throw new Error('ChatGPT không tạo ảnh. Cuối trang: ' + (await pageText()).slice(-300).replace(/\s+/g, ' '));
    onStep('download');
    const files = await downloadGenerated(before, downloadDir, log);
    return result(files);
  } catch (e) {
    await debugShot(downloadDir, e, log);
    throw e;
  } finally {
    for (const p of imagePaths) { try { fs.unlinkSync(p); } catch {} }
  }
}

/** Đăng nhập: luôn mở cửa sổ (để đăng nhập / ĐỔI TÀI KHOẢN), tự đóng sau khi xác nhận. */
async function prepare(payload, log = noop) {
  if (active > 0) throw new Error('Đang có job chạy — đợi xong rồi hãy đăng nhập lại.');
  cancelCloseTimer();
  await close();
  loginOpen = true;
  try {
    await ensureContext(payload.profileDir, log, true); // hiện cửa sổ
    await pg().goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    log('Cửa sổ đã mở — đăng nhập hoặc ĐỔI TÀI KHOẢN nếu muốn. Sẽ tự đóng sau khi xác nhận.');
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let confirmedSince = 0;
    while (Date.now() < deadline) {
      if (await isLoggedIn()) {
        if (!confirmedSince) { confirmedSince = Date.now(); log('Đã đăng nhập — chờ vài giây phòng khi bạn muốn đổi tài khoản…'); }
        if (Date.now() - confirmedSince >= LOGIN_GRACE_MS) break;
      } else {
        confirmedSince = 0;
      }
      await pg().waitForTimeout(1500);
    }
    loginOpen = false;
    if (confirmedSince) { log('✅ Xác nhận đăng nhập — đóng cửa sổ, từ giờ chạy NGẦM.'); await close(); }
    else log('Hết thời gian chờ đăng nhập — giữ cửa sổ mở để bạn tiếp tục.');
    return { loggedIn: !!confirmedSince };
  } finally {
    loginOpen = false;
  }
}

/** Bước gửi tin chạy lần lượt giữa các tab (tránh dồn yêu cầu cùng lúc lên ChatGPT). */
function withSendLock(log, fn) {
  const run = sendLock.then(fn);
  sendLock = run.catch(() => {});
  return run;
}

/** Chạy 1 việc trong 1 tab mới (nhiều việc = nhiều tab song song). Hết việc -> tự đóng cửa sổ. */
/**
 * Mỗi việc 1 CỬA SỔ riêng (không phải tab): tab nền bị Chrome ngừng vẽ -> gallery ảnh không tải,
 * còn mỗi cửa sổ có 1 tab đang hiện nên luôn được vẽ. Tạo lần lượt để bắt đúng page mới.
 */
const windowsByKey = new Map(); // key việc -> cửa sổ (để huỷ)
// Cửa sổ đang có việc. Việc đầu dùng luôn cửa sổ gốc (about:blank lúc mở Chrome) -> 1 job chỉ 1 cửa sổ;
// việc thứ 2 trở đi mới mở thêm cửa sổ (trước đây luôn mở thêm -> lúc chạy 1 job vẫn thấy 2 cửa sổ Chrome).
const busyPages = new Set();
let winLock = Promise.resolve();
let winCount = 0;
function windowBounds() {
  if (hidden) return OFFSCREEN;
  const k = winCount % 5; // đang xem: xếp so le cho dễ nhìn
  return { ...ONSCREEN, left: ONSCREEN.left + 40 * k, top: ONSCREEN.top + 30 * k };
}
function openWindow(log) {
  const run = winLock.then(async () => {
    const b = windowBounds();
    winCount++;
    const cdp = await context.newCDPSession(mainPage);
    const created = context.waitForEvent('page', { timeout: 20000 });
    await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, left: b.left, top: b.top, width: b.width, height: b.height })
      .catch(() => cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true }));
    const p = await created;
    await cdp.detach().catch(() => {});
    await placeWindow(b, log, p);
    return p;
  });
  winLock = run.catch(() => {});
  return run;
}

async function inTab(payload, log, fn) {
  if (loginOpen) throw new Error('Đang mở cửa sổ đăng nhập — đăng nhập xong rồi chạy lại.');
  cancelCloseTimer();
  active++;
  let tab = null;
  try {
    if (!context) {
      if (!ctxReady) ctxReady = ensureContext(payload.profileDir, log, false).finally(() => { ctxReady = null; });
      await ctxReady;
    }
    if (context && (!mainPage || mainPage.isClosed())) mainPage = context.pages().find((x) => !x.isClosed()) || (await context.newPage());
    tab = mainPage && !busyPages.has(mainPage) ? mainPage : await openWindow(log);
    busyPages.add(tab);
    if (payload.key != null) windowsByKey.set(payload.key, tab);
    return await tabStore.run(tab, fn);
  } finally {
    if (payload.key != null && windowsByKey.get(payload.key) === tab) windowsByKey.delete(payload.key);
    active--;
    busyPages.delete(tab);
    // Cửa sổ gốc giữ lại (đưa về trang trắng) để giữ phiên Chrome; cửa sổ mở thêm thì đóng.
    if (tab && tab === mainPage) await tab.goto('about:blank').catch(() => {});
    else await tab?.close().catch(() => {});
    if (active === 0) scheduleCloseTimer(log);
  }
}

/**
 * Giao 1 việc cho ChatGPT Work (mỗi việc 1 tab, chạy song song). payload:
 * { url?, skill?, message, images:[{base64,mimeType}], expect, collectOnly?, onUrl?, profileDir, downloadDir }
 * -> { url, files:[đường dẫn ảnh], reply }
 */
function workTask(payload, log = noop) {
  return inTab(payload, log, () => workTaskOnce(payload, log));
}

/** Bật/tắt hiện cửa sổ Chrome để theo dõi (có tác dụng ngay cả khi đang chạy). */
async function setWatch(on, log = noop) {
  watch = !!on;
  if (context && mainPage && !loginOpen) {
    hidden = !watch;
    let k = 0;
    for (const p of context.pages()) {
      await placeWindow(watch ? { ...ONSCREEN, left: ONSCREEN.left + 40 * (k % 5), top: ONSCREEN.top + 30 * (k % 5) } : OFFSCREEN, log, p);
      k++;
    }
    log(watch ? 'Đã hiện cửa sổ Chrome để theo dõi.' : 'Đã ẩn cửa sổ Chrome (chạy ngầm).');
  }
  return watch;
}

// ----------------------------- Cài đặt ban đầu --------------------------------
const SKILLS_URL = 'https://chatgpt.com/skills';
const norm = (t) => String(t || '').toLowerCase().replace(/[\s_-]+/g, '');

/** Trang Skills có skill tên `skill` chưa (so khớp ĐÚNG tên, không tính tên file .zip đang upload). */
async function hasSkill(skill) {
  return pg().evaluate((want) => {
    const n = (t) => String(t || '').toLowerCase().replace(/[\s_-]+/g, '');
    // Bỏ qua hộp thoại (đang upload / xem trước) — chỉ tính skill đã nằm trong danh sách.
    return [...document.querySelectorAll('body *')].some((e) => e.children.length === 0 && !e.closest('[role=dialog]')
      && e.getBoundingClientRect().width && n(e.textContent) === want);
  }, norm(skill)).catch(() => false);
}

/** Kiểm tra NGẦM: đã đăng nhập ChatGPT chưa + tài khoản đã cài skill chưa. */
function checkSetup(payload, log = noop) {
  return inTab(payload, log, async () => {
    await pg().goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    let loggedIn = false;
    for (const end = Date.now() + 25000; Date.now() < end;) {
      if (await isLoggedIn()) { loggedIn = true; break; }
      if (/auth0|login|\/auth/.test(pg().url()) || await firstVisible(pg(), SEL.signIn, 300)) break;
      await pg().waitForTimeout(1500);
    }
    if (!loggedIn) return { loggedIn: false, skill: false };
    await pg().goto(SKILLS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    let skill = false;
    for (const end = Date.now() + 20000; Date.now() < end && !skill;) {
      await pg().waitForTimeout(1500);
      skill = await hasSkill(payload.skill);
    }
    return { loggedIn, skill };
  });
}

/**
 * Cài skill TỰ ĐỘNG (chạy ngầm, nhân viên không phải bấm gì): trang Skills → Add → "Upload from your computer"
 * → đưa file zip vào ô chọn file → CHỜ upload xong ("Uploading…" -> "Skill uploaded") → trùng tên thì
 * "Replace existing" → Done → tải lại trang, thấy skill là xong. Lỗi -> chụp màn hình + ghi log chi tiết.
 * Lưu ý: nút Done hiện NGAY từ lúc đang upload — bấm sớm là huỷ upload (lỗi đã gặp ở máy nhân viên).
 */
function installSkill(payload, log = noop) {
  return inTab(payload, log, async () => {
    const p = pg();
    const dlgText = () => p.locator('[role=dialog]').allInnerTexts().then((t) => t.join(' ').replace(/\s+/g, ' ')).catch(() => '');
    const btn = (re) => p.locator('[role=dialog] button').filter({ hasText: re }).first();
    const visible = (l) => l.isVisible().catch(() => false);
    try {
      await p.goto(SKILLS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      const add = p.locator('button').filter({ hasText: /^\s*(Add|Thêm)\s*$/i }).first();
      try { await add.waitFor({ state: 'visible', timeout: 45000 }); }
      catch { throw new Error(`Không thấy nút Add trên trang Skills (url: ${p.url()}) — tài khoản/workspace có thể chưa bật Skills.`); }
      await p.waitForTimeout(3000); // chờ trang chạy xong, bấm sớm menu không mở
      let item = p.locator('[role=menuitem]').filter({ hasText: /upload|tải lên|máy tính/i }).first();
      for (let i = 0; i < 3 && !(await visible(item)); i++) {
        await add.click().catch(() => {});
        await p.waitForTimeout(1500);
      }
      if (!(await visible(item))) throw new Error('Bấm Add nhưng không thấy mục "Upload from your computer".');
      await item.click();
      const input = p.locator('[role=dialog] input[type=file]').first();
      await input.waitFor({ state: 'attached', timeout: 15000 });
      await input.setInputFiles(payload.zipPath);
      log('Đã gửi file skill, đang chờ ChatGPT tải lên…');

      let finished = false, replaced = false, last = '';
      for (const end = Date.now() + 120000; Date.now() < end && !finished;) {
        await p.waitForTimeout(1500);
        const rep = btn(/replace|thay thế/i);
        if (!replaced && await visible(rep)) {
          await rep.click(); replaced = true;
          log('Tài khoản đã có skill cũ — thay bằng bản mới.');
          continue;
        }
        const txt = await dlgText();
        if (txt !== last) { last = txt; log('Hộp thoại upload: ' + txt.replace(/Third-party skills[^.]*\.(\s*Only[^.]*\.)?/i, '').slice(-160)); }
        if (!txt) { finished = true; break; } // hộp thoại đã tự đóng
        if (/\b(error|failed|invalid|could not|couldn.t)\b|lỗi|thất bại/i.test(txt.replace(/Third-party skills[^.]*\.(\s*Only[^.]*\.)?/i, ''))) {
          throw new Error('ChatGPT báo lỗi khi upload: ' + txt.slice(-200));
        }
        if (/uploading|đang tải/i.test(txt) || await visible(btn(/replace|thay thế/i))) continue;
        const uploaded = /uploaded|đã tải lên|replaced|đã thay/i.test(txt) || await visible(btn(/^\s*(Edit|Sửa|Chỉnh sửa)\b/i));
        if (uploaded) {
          await p.waitForTimeout(1000);
          const done = btn(/^\s*(Done|Xong|Hoàn tất)\s*$/i);
          if (await visible(done)) await done.click().catch(() => {});
          finished = true;
        }
      }
      if (!finished) throw new Error('Hết thời gian chờ upload skill. Hộp thoại: ' + last.slice(-200));

      // Kiểm tra lại trên trang Skills mới tải.
      await p.waitForTimeout(2000);
      await p.goto(SKILLS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      for (const end = Date.now() + 40000; Date.now() < end;) {
        await p.waitForTimeout(2000);
        if (await hasSkill(payload.skill)) { log('✅ Đã cài skill vào tài khoản ChatGPT.'); return { ok: true }; }
      }
      throw new Error('Upload xong nhưng chưa thấy skill trong danh sách.');
    } catch (e) {
      log('❌ Cài skill lỗi: ' + (e.message || e));
      if (payload.downloadDir) { fs.mkdirSync(payload.downloadDir, { recursive: true }); await debugShot(payload.downloadDir, e, log); }
      return { ok: false, error: e.message || String(e) };
    }
  });
}

/** Huỷ việc đang chạy: đóng cửa sổ của nó -> mọi thao tác trong cửa sổ đó báo lỗi và việc dừng. */
async function cancel(key) {
  const w = windowsByKey.get(key);
  if (w) await w.close().catch(() => {});
  return !!w;
}

async function close() {
  try { await context?.close(); } catch {}
  context = null; mainPage = null;
}

module.exports = { workTask, prepare, setWatch, cancel, checkSetup, installSkill, close };
