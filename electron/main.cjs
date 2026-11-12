// main.cjs — Comfort Redesign: design -> skill 'comfort-redesign' trong ChatGPT Work -> 5 mockup Comfort Colors 1:1.
// Chạy qua ChatGPT web (tài khoản ChatGPT, automation Playwright) — không dùng API.
// Prompt đầy đủ nằm trong skill (chatgpt-skill/comfort-redesign/SKILL.md), app chỉ gửi tham số.
const { app, BrowserWindow, ipcMain, shell, nativeImage, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// Cố định thư mục dữ liệu (đăng nhập ChatGPT, cài đặt) — bản .exe mặc định đổi theo productName
// "Comfort Redesign" làm mất phiên đăng nhập + cài đặt đã có khi chạy dev.
app.setPath('userData', path.join(app.getPath('appData'), 'comfort-redesign'));
const runner = require('./chatgpt-runner.cjs');
const P = require('./prompts.cjs');

let win = null;

// ------------------------------- Cài đặt ------------------------------------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = () => ({ outDir: path.join(app.getPath('downloads'), 'Comfort Redesign'), skillName: 'comfort-redesign', parallel: 4 });
function getSettings() {
  try { return { ...defaults(), ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch { return defaults(); }
}
function setSettings(s) {
  const next = { ...getSettings(), ...s };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

// ------------------------------- Job ----------------------------------------
// Nhiều job chạy song song (mỗi job 1 tab Chrome); quá số song song thì xếp hàng.
const jobs = [];
let seq = 0;
const maxParallel = () => Math.min(5, Math.max(1, Number(getSettings().parallel) || 4));
const runningCount = () => jobs.filter((j) => j.running).length;

const send = (ch, data) => { try { win?.webContents.send(ch, data); } catch {} };
// Log chi tiết chỉ ghi ra file (không hiện trên app — nhân viên không cần biết app chạy thế nào).
// File: %APPDATA%\comfort-redesignpp.log (quá 2MB thì làm mới khi mở app).
const logFile = () => path.join(app.getPath('userData'), 'app.log');
const log = (msg) => {
  console.log('[chatgpt]', msg);
  try { fs.appendFileSync(logFile(), `${new Date().toLocaleString('vi-VN')}  ${msg}
`); } catch {}
  send('log', String(msg)); // renderer chỉ dùng để biết trạng thái đăng nhập, không hiển thị
};
const jlog = (job) => (msg) => log(`[#${job.id}] ${msg}`);

function snap(job) {
  const { design, regenChain, ...rest } = job;
  return {
    ...rest,
    designUrl: pathToFileURL(job.designFile).href,
    options: job.options.map((o) => ({ ...o, url: o.file ? `${pathToFileURL(o.file).href}?t=${o.t}` : null })),
  };
}
const update = () => send('jobs:update', jobs.map(snap));
const findJob = (id) => jobs.find((j) => j.id === id);

/** Đổi bước của job (queue → send → work → download) + mốc giờ để app hiện đồng hồ. */
function setStep(job, step) {
  job.step = step; job.stepAt = new Date().toISOString();
  update();
}

function jobCode() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `CR-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
}

/**
 * Nạp lại job cũ từ dữ liệu app (jobs/*.json) khi mở app — như Design Template, hàng đợi không mất khi tắt app.
 * Job đang chạy/chờ lúc tắt app -> báo lỗi, có nút Lấy kết quả (nếu đã có hội thoại) hoặc Thử lại.
 */
function loadHistory() {
  fs.mkdirSync(jobsStore(), { recursive: true });
  // Bản cũ để job.json trong thư mục job -> chuyển sang dữ liệu app rồi xoá khỏi thư mục job.
  try {
    const root = getSettings().outDir;
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      const old = path.join(root, d.name, 'job.json');
      if (!d.isDirectory() || !fs.existsSync(old)) continue;
      if (!fs.existsSync(jobMetaFile(path.join(root, d.name)))) fs.copyFileSync(old, jobMetaFile(path.join(root, d.name)));
      fs.unlinkSync(old);
    }
  } catch {}
  for (const f of fs.readdirSync(jobsStore()).filter((x) => x.endsWith('.json'))) {
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(jobsStore(), f), 'utf8')); } catch { continue; }
    if (meta.hidden || !meta.designFile || !Array.isArray(meta.options) || !fs.existsSync(meta.dir || '')) continue;
    const dir = meta.dir;
    const job = {
      ...meta, id: ++seq, dir, design: null, running: false,
      code: meta.code || `CR-${path.basename(dir).slice(0, 6)}`,
      createdAt: meta.createdAt || fs.statSync(dir).mtime.toISOString(),
    };
    if (job.stage === 'running' || job.stage === 'queued') {
      job.stage = 'error';
      job.error = job.convUrl ? 'App đã tắt khi job đang chạy — bấm "Lấy kết quả" để tải ảnh từ ChatGPT.' : 'App đã tắt trước khi gửi — bấm "Thử lại".';
      job.options.forEach((o) => { if (o.status !== 'done') { o.status = 'error'; o.error = null; } });
    }
    job.options.forEach((o) => { if (o.file && !fs.existsSync(o.file)) { o.file = null; o.status = 'error'; } });
    // App tắt giữa lúc tạo lại -> bỏ trạng thái tạo lại, giữ ảnh cũ.
    job.options.forEach((o) => { if (o.regen) { o.regen = null; if (o.status === 'run') o.status = o.file ? 'done' : 'error'; } });
    jobs.push(job);
  }
  jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Khởi chạy các job đang xếp hàng khi còn chỗ. */
function pump() {
  for (const job of jobs) {
    if (runningCount() >= maxParallel()) break;
    if (job.stage === 'queued' && !job.running) runAll(job);
  }
  update();
}

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'design';

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const runnerPaths = () => ({
  profileDir: path.join(app.getPath('userData'), 'chatgpt-profile'),
  downloadDir: path.join(app.getPath('temp'), 'comfort-redesign'), // ảnh tải tạm + ảnh chụp lỗi
});

/** Ép ảnh về đúng 1:1 (cắt giữa) + lưu PNG. Ảnh không đọc được (webp…) thì giữ nguyên. */
function saveSquare(srcPath, outPath, log) {
  const img = nativeImage.createFromPath(srcPath);
  if (img.isEmpty()) { fs.copyFileSync(srcPath, outPath); return; }
  const { width: w, height: h } = img.getSize();
  let out = img;
  if (Math.abs(w - h) / Math.max(w, h) > 0.01) {
    const s = Math.min(w, h);
    out = img.crop({ x: Math.floor((w - s) / 2), y: Math.floor((h - s) / 2), width: s, height: s });
    log(`Ảnh ${w}×${h} -> cắt giữa thành ${s}×${s} (1:1).`);
  }
  fs.writeFileSync(outPath, out.toPNG());
}

/** Lưu ảnh tải về thành option-N-<tên>.png (không ghi đè bản cũ), ép 1:1. */
function saveOption(job, i, src) {
  const o = job.options[i];
  let n = 1, out;
  do { out = path.join(job.dir, `option-${i + 1}-${slug(o.name)}${n > 1 ? `-${n}` : ''}.png`); n++; } while (fs.existsSync(out));
  saveSquare(src, out, jlog(job));
  try { fs.unlinkSync(src); } catch {}
  o.file = out; o.t = Date.now(); o.status = 'done'; o.error = null;
}

/** Lấy tên / màu áo / tóm tắt từ trả lời của skill ("N. Tên — Màu — Tóm tắt"). */
function applyInfo(o, m) {
  if (!m || m.failed) return;
  o.name = m.name; o.shirt_color = m.color || o.shirt_color; o.summary = m.summary;
}

// Thông tin job lưu trong dữ liệu app (%APPDATA%/comfort-redesign/jobs/<tên thư mục job>.json),
// KHÔNG để trong thư mục job — thư mục job chỉ chứa design gốc + mockup.
const jobsStore = () => path.join(app.getPath('userData'), 'jobs');
const jobMetaFile = (dir) => path.join(jobsStore(), `${path.basename(dir)}.json`);
function saveJobFile(job) {
  try {
    const { design, running, cancelled, regenChain, ...meta } = job;
    fs.mkdirSync(jobsStore(), { recursive: true });
    fs.writeFileSync(jobMetaFile(job.dir), JSON.stringify(meta, null, 2));
  } catch {}
}

/** Gán ảnh + tên hướng vào 5 mẫu (bỏ qua mẫu đã xong và mẫu skill báo FAILED). */
function assignResults(job, r) {
  if (r.url) job.convUrl = r.url;
  const info = P.parseLines(r.reply).slice(-P.NUM_OPTIONS);
  job.options.forEach((o, i) => applyInfo(o, info[i]));
  const slots = job.options.map((_, i) => i).filter((i) => !info[i]?.failed);
  r.files.forEach((f, k) => {
    const i = slots[k];
    if (i !== undefined && job.options[i].status !== 'done') saveOption(job, i, f);
    else try { fs.unlinkSync(f); } catch {}
  });
  job.options.forEach((o, i) => {
    if (o.status === 'done') return;
    o.status = 'error';
    o.error = info[i]?.failed ? `ChatGPT báo lỗi: ${info[i].summary || 'không tạo được'}` : 'ChatGPT chưa tạo mẫu này — bấm Tạo lại.';
  });
}

/** Móc theo dõi tiến độ + key để huỷ (gửi kèm mỗi việc của runner). */
const hooks = (job) => ({ key: job.id, onStep: (st) => setStep(job, st), onImages: (n) => { job.imgCount = n; update(); } });

/** Chạy việc chính (gửi skill) hoặc collect = chỉ lấy kết quả từ hội thoại đã có. */
async function runAll(job, collect = false) {
  if (!job.design && !collect) {
    const ext = path.extname(job.designFile).slice(1).replace('jpg', 'jpeg');
    job.design = { base64: fs.readFileSync(job.designFile).toString('base64'), mimeType: `image/${ext}` };
  }
  job.running = true; job.cancelled = false; job.stage = 'running'; job.error = null; job.imgCount = 0;
  job.step = 'open'; job.stepAt = new Date().toISOString();
  job.options.forEach((o) => { if (o.status !== 'done') { o.status = 'run'; o.error = null; } });
  update();
  try {
    const r = await runner.workTask(collect
      ? { ...runnerPaths(), ...hooks(job), url: job.convUrl, collectOnly: true, expect: P.NUM_OPTIONS }
      : {
        ...runnerPaths(),
        ...hooks(job),
        skill: getSettings().skillName,
        message: P.skillMessage({ product: job.product, model: job.model, color: job.color, note: job.note }),
        images: [job.design],
        expect: P.NUM_OPTIONS,
        onUrl: (u) => { job.convUrl = u; saveJobFile(job); update(); },
      }, jlog(job));
    assignResults(job, r);
    job.stage = 'done';
  } catch (e) {
    if (job.cancelled) { job.stage = 'cancelled'; job.error = 'Đã huỷ.'; jlog(job)('Đã huỷ job.'); }
    else { job.stage = 'error'; job.error = e.message || String(e); jlog(job)('❌ ' + job.error); }
    if (/chưa đăng nhập|hết hạn/i.test(job.error || '')) { setSettings({ loginOk: false }); setupChanged(); }
    job.options.forEach((o) => { if (o.status === 'run') { o.status = 'error'; o.error = job.cancelled ? 'Đã huỷ.' : 'Không có kết quả.'; } });
  } finally {
    job.running = false; job.cancelled = false; job.step = null;
    saveJobFile(job);
    pump();
  }
}

// ------------------------------- IPC ----------------------------------------
ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:set', (_e, s) => { const r = setSettings(s); pump(); return r; });
ipcMain.handle('settings:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: getSettings().outDir });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('chatgpt:login', async () => {
  const r = await runner.prepare({ ...runnerPaths() }, log);
  if (r?.loggedIn) { setSettings({ loginOk: true }); setupChanged(); }
  return r;
});

// ------------------------------- Cài đặt ban đầu ------------------------------
// 4 bước cho máy nhân viên: Chrome · đăng nhập ChatGPT · cài skill · chọn thư mục lưu.
const crypto = require('node:crypto');
const skillHash = () => { try { return crypto.createHash('sha1').update(fs.readFileSync(skillZip())).digest('hex').slice(0, 12); } catch { return ''; } };
const skillZip = () => (app.isPackaged
  ? path.join(process.resourcesPath, 'comfort-redesign.zip')
  : path.join(__dirname, '..', 'chatgpt-skill', 'comfort-redesign.zip'));

function findChrome() {
  const env = process.env;
  return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
    .filter(Boolean).map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    .find((f) => fs.existsSync(f)) || null;
}

function setupStatus() {
  const st = getSettings();
  return {
    chrome: findChrome(),
    loginOk: !!st.loginOk,
    skillOk: !!st.skillOk,
    skillName: st.skillName,
    outDir: st.outDir,
    // đã tự chọn / xác nhận thư mục lưu (máy cũ đã đổi thư mục khác mặc định cũng tính là đã chọn)
    outDirOk: !!st.outDirChosen || st.outDir !== defaults().outDir,
  };
}
const setupChanged = () => send('setup:update', setupStatus());

ipcMain.handle('setup:status', () => setupStatus());
/** Cài / cập nhật skill tự động (ngầm). skillOk chỉ đúng khi tài khoản có skill VÀ là đúng bản đi kèm app này. */
async function autoInstallSkill() {
  log('Đang tự cài skill vào tài khoản ChatGPT (chạy ngầm)…');
  let r;
  try { r = await runner.installSkill({ ...runnerPaths(), skill: getSettings().skillName, zipPath: skillZip() }, log); }
  catch (e) { log('Cài skill lỗi: ' + (e.message || e)); r = { ok: false }; }
  setSettings(r.ok ? { skillOk: true, skillHash: skillHash() } : { skillOk: false });
  setupChanged();
  if (!r.ok) throw new Error('Chưa chuẩn bị xong tài khoản — bấm Thử lại.');
}

// Kiểm tra ngầm đăng nhập + skill; đã đăng nhập mà thiếu skill / skill cũ -> tự cài luôn.
ipcMain.handle('setup:check', async () => {
  let r;
  try { r = await runner.checkSetup({ ...runnerPaths(), skill: getSettings().skillName }, log); }
  catch (e) { log('Kiểm tra lỗi: ' + (e.message || e)); throw new Error('Chưa kiểm tra được — thử lại sau ít phút.'); }
  const current = r.skill && getSettings().skillHash === skillHash();
  setSettings({ loginOk: r.loggedIn, skillOk: current });
  setupChanged();
  if (r.loggedIn && !current) await autoInstallSkill();
  return setupStatus();
});
ipcMain.handle('setup:installSkill', async () => { await autoInstallSkill(); return setupStatus(); });
ipcMain.handle('setup:showSkillFile', () => shell.showItemInFolder(skillZip()));
ipcMain.handle('setup:confirmOutDir', (_e, dir) => { setSettings({ outDir: dir || getSettings().outDir, outDirChosen: true }); return setupStatus(); });
ipcMain.handle('setup:getChrome', () => shell.openExternal('https://www.google.com/chrome/'));
ipcMain.handle('chatgpt:watch', (_e, on) => runner.setWatch(on, log));

ipcMain.handle('job:start', (_e, { base64, mimeType, fileName, product, model, color, note }) => {
  const prod = P.findProduct(product);
  const base = `${stamp()}-${slug(prod.name)}-${slug(path.parse(fileName || 'design').name)}`;
  let name = base;
  for (let k = 2; fs.existsSync(path.join(getSettings().outDir, name)); k++) name = `${base}-${k}`;
  const dir = path.join(getSettings().outDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(runnerPaths().downloadDir, { recursive: true });
  const ext = (mimeType || 'image/png').split('/')[1].replace('jpeg', 'jpg');
  const designFile = path.join(dir, `design-goc.${ext}`);
  fs.writeFileSync(designFile, Buffer.from(base64, 'base64'));
  const job = {
    id: ++seq, name, dir, designFile, design: { base64, mimeType },
    product: prod.name, model: prod.wear ? (model || 'woman') : '', color: prod.cc ? (color || '') : '', note: note || '',
    code: jobCode(), createdAt: new Date().toISOString(), step: 'queue', stepAt: new Date().toISOString(),
    stage: 'queued', running: false, error: null, convUrl: null, options: [],
  };
  job.options = Array.from({ length: P.NUM_OPTIONS }, (_, i) => ({ name: `Mẫu ${i + 1}`, shirt_color: job.color, summary: '', status: 'wait', file: null, error: null, t: 0 }));
  jobs.push(job);
  saveJobFile(job);
  if (runningCount() >= maxParallel()) jlog(job)(`Xếp hàng — đang chạy ${runningCount()}/${maxParallel()} job.`);
  pump();
  return job.id;
});

// Tạo lại 1 mẫu: gửi "Regenerate #N" vào đúng hội thoại Work của job (mở tab riêng).
// Mỗi mẫu có ô mô tả riêng (note). Các lần tạo lại trong CÙNG 1 job chạy lần lượt (cùng 1 hội thoại
// ChatGPT — gửi song song sẽ lẫn ảnh giữa các mẫu); mẫu đang chờ hiện "Chờ tạo lại".
ipcMain.handle('job:regen', (_e, id, i, note) => {
  const job = findJob(id);
  const o = job?.options[i];
  if (!o || job.running || o.regen || !job.convUrl) return;
  o.regen = 'wait'; o.regenNote = String(note || '').trim(); o.error = null; update();
  job.regenChain = (job.regenChain || Promise.resolve()).then(() => regenOne(job, i)).catch(() => {});
});

async function regenOne(job, i) {
  const o = job.options[i];
  o.regen = 'run'; o.status = 'run'; update();
  try {
    if (o.regenNote) jlog(job)(`Tạo lại mẫu ${i + 1} với mô tả: ${o.regenNote}`);
    const r = await runner.workTask({ ...runnerPaths(), key: `${job.id}-r${i}`, url: job.convUrl, message: P.regenMessage(i + 1, o.regenNote), images: [], expect: 1 }, jlog(job));
    applyInfo(o, P.parseLines(r.reply).slice(-1)[0]);
    if (!r.files.length) throw new Error('ChatGPT không tạo lại được.');
    r.files.slice(0, -1).forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    saveOption(job, i, r.files[r.files.length - 1]);
  } catch (e) {
    o.status = o.file ? 'done' : 'error'; // tạo lại lỗi thì vẫn giữ ảnh cũ
    o.error = 'Tạo lại chưa được: ' + (e.message || String(e));
    jlog(job)(`❌ Tạo lại mẫu ${i + 1}: ${e.message || e}`);
  }
  o.regen = null;
  saveJobFile(job);
  update();
}

// Lấy kết quả từ hội thoại Work (khi app lỗi/hết giờ chờ mà ChatGPT vẫn làm tiếp).
ipcMain.handle('job:collect', (_e, id) => { const job = findJob(id); if (job?.convUrl && !job.running) runAll(job, true); });

// Bỏ job đang xếp hàng (chưa chạy) hoặc xoá job đã xong khỏi danh sách (file vẫn giữ).
ipcMain.handle('job:remove', (_e, id) => {
  const k = jobs.findIndex((j) => j.id === id);
  if (k < 0 || jobs[k].running || jobs[k].options.some((o) => o.status === 'run')) return;
  jobs[k].hidden = true; saveJobFile(jobs[k]);
  jobs.splice(k, 1);
  update();
});

// Huỷ: job đang chờ -> bỏ khỏi hàng; đang chạy -> đóng cửa sổ Chrome của job.
ipcMain.handle('job:cancel', async (_e, id) => {
  const job = findJob(id);
  if (!job) return;
  if (job.stage === 'queued' && !job.running) {
    job.stage = 'cancelled'; job.error = 'Đã huỷ.'; job.step = null;
    job.options.forEach((o) => { if (o.status !== 'done') { o.status = 'error'; o.error = 'Đã huỷ.'; } });
    saveJobFile(job); update();
  } else if (job.running) {
    job.cancelled = true;
    await runner.cancel(job.id);
  }
});

// Thử lại: chạy lại job lỗi/huỷ từ đầu (hội thoại mới), giữ các mẫu đã xong.
ipcMain.handle('job:retry', (_e, id) => {
  const job = findJob(id);
  if (!job || job.running || !['error', 'cancelled'].includes(job.stage)) return;
  job.stage = 'queued'; job.error = null; job.step = 'queue'; job.stepAt = new Date().toISOString();
  job.options.forEach((o) => { if (o.status !== 'done') { o.status = 'wait'; o.error = null; } });
  saveJobFile(job);
  pump();
});

ipcMain.handle('open:conv', (_e, id) => { const u = findJob(id)?.convUrl; if (u) shell.openExternal(u); });
ipcMain.handle('colors', () => P.COLORS);
ipcMain.handle('catalog', () => ({ products: P.PRODUCTS, models: P.MODELS, defaultProduct: P.DEFAULT_PRODUCT }));
ipcMain.handle('jobs:get', () => jobs.map(snap));
ipcMain.handle('open:dir', (_e, id) => { const j = findJob(id); if (j) shell.openPath(j.dir); });
ipcMain.handle('open:file', (_e, f) => f && shell.showItemInFolder(f));

// ------------------------------- Window -------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1040, minHeight: 640,
    backgroundColor: '#f4f5f7', autoHideMenuBar: true, title: 'Comfort Redesign',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  try { if (fs.statSync(logFile()).size > 2e6) fs.unlinkSync(logFile()); } catch {}
  loadHistory(); createWindow();
  // Lỗi kiểm tra cập nhật không bao giờ được chặn app khởi động.
  try { setupAutoUpdate(); } catch (e) { log('[update] lỗi khởi tạo: ' + (e?.message || e)); }
});

// ------------------------------- Tự cập nhật (GitHub Releases) -------------------------------
// Bản cài (Setup): mở app + mỗi 4 giờ kiểm tra, có bản mới thì tải ngầm, báo "Khởi động lại & cập nhật"
// (hoặc tắt app là tự cài). Bản portable không tự thay được -> chỉ báo có bản mới + link tải bộ cài.
// Feed đọc từ resources/app-update.yml (electron-builder bỏ mục "build" khỏi package.json khi đóng gói).
let updState = null; // { state: 'downloading' | 'ready' | 'available', version, url? }
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
  let owner = 'Mid-4', repo = 'comfort-redesign-releases';
  try {
    const y = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    owner = /^owner:\s*(\S+)/m.exec(y)?.[1] || owner;
    repo = /^repo:\s*(\S+)/m.exec(y)?.[1] || repo;
  } catch { /* mặc định */ }
  autoUpdater.autoDownload = !portable;
  autoUpdater.autoInstallOnAppQuit = !portable;
  const tell = (st) => { updState = st; send('update:status', st); };
  autoUpdater.on('update-available', (i) => {
    log(`[update] có bản mới ${i.version}`);
    tell(portable ? { state: 'available', version: i.version, url: `https://github.com/${owner}/${repo}/releases/latest` } : { state: 'downloading', version: i.version });
  });
  autoUpdater.on('update-downloaded', (i) => { log(`[update] đã tải ${i.version}`); tell({ state: 'ready', version: i.version }); });
  autoUpdater.on('update-not-available', (i) => log(`[update] đang là bản mới nhất ${i?.version || ''}`));
  autoUpdater.on('error', (e) => log('[update] ' + (e?.message || e))); // mất mạng / GitHub lỗi: lần sau kiểm tra lại
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
  ipcMain.handle('update:install', () => {
    if (jobs.some((j) => j.running || j.options.some((o) => o.status === 'run'))) {
      return { ok: false, error: 'Đang có job chạy — đợi xong (hoặc huỷ) rồi cập nhật.' };
    }
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  });
}
ipcMain.handle('update:get', () => updState);
ipcMain.handle('app:version', () => app.getVersion());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { runner.close(); });
