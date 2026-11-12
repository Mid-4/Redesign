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
const claude = require('./claude-agent.cjs'); // agent Claude: bước Phân tích & research của job Scale
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

function jobCode(prefix = 'CR') {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
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
// Tên file: có mã design -> "<mã>-<số thứ tự>.png" (tạo lại: "<mã>-<số>_v2.png", file cũ giữ nguyên);
// job cũ chưa có mã -> như trước "option-N-<tên hướng>.png".
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').replace(/^[ .-]+|[ .-]+$/g, '').slice(0, 60);
function saveOption(job, i, src) {
  const o = job.options[i];
  const code = safeName(job.designCode);
  let n = 1, out;
  do {
    out = path.join(job.dir, code ? `${code}-${i + 1}${n > 1 ? `_v${n}` : ''}.png` : `option-${i + 1}-${slug(o.name)}${n > 1 ? `-${n}` : ''}.png`);
    n++;
  } while (fs.existsSync(out));
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

/**
 * ChatGPT đôi khi vẽ thừa (vẽ lại 1 hướng 2 lần) -> nhiều ảnh hơn số mẫu, lệch thứ tự.
 * Bỏ dần ảnh GIỐNG ảnh liền sau nhất (bản nháp trước của cùng hướng), giữ bản sau, tới khi đủ `n` ảnh.
 */
function pruneExtras(files, n, log) {
  const sig = (f) => {
    const img = nativeImage.createFromPath(f);
    if (img.isEmpty()) return null;
    // So vùng giữa (áo + bản in), bỏ bớt nền: 2 bản của cùng 1 hướng cùng màu áo, cùng bố cục.
    const { width: w, height: h } = img.getSize();
    return img.crop({ x: Math.round(w * 0.1), y: Math.round(h * 0.25), width: Math.round(w * 0.8), height: Math.round(h * 0.6) })
      .resize({ width: 32, height: 24, quality: 'good' }).toBitmap();
  };
  const list = files.map((f) => ({ f, s: sig(f) }));
  const diff = (a, b) => {
    if (!a.s || !b.s || a.s.length !== b.s.length) return Infinity;
    let d = 0;
    for (let k = 0; k < a.s.length; k += 4) d += Math.abs(a.s[k] - b.s[k]) + Math.abs(a.s[k + 1] - b.s[k + 1]) + Math.abs(a.s[k + 2] - b.s[k + 2]);
    return d / (a.s.length / 4);
  };
  while (list.length > n) {
    let best = 0, bestD = Infinity;
    for (let k = 0; k + 1 < list.length; k++) { const d = diff(list[k], list[k + 1]); if (d < bestD) { bestD = d; best = k; } }
    log(`ChatGPT vẽ thừa ảnh — bỏ ảnh ${best + 1} (giống ảnh kế tiếp, lệch ${Math.round(bestD)}).`);
    try { fs.unlinkSync(list[best].f); } catch {}
    list.splice(best, 1);
  }
  return list.map((x) => x.f);
}

/** Gán ảnh + tên hướng vào 5 mẫu (bỏ qua mẫu đã xong và mẫu skill báo FAILED). */
function assignResults(job, r) {
  if (r.url) job.convUrl = r.url;
  const info = P.parseLines(r.reply).slice(-job.options.length);
  job.options.forEach((o, i) => applyInfo(o, info[i]));
  const slots = job.options.map((_, i) => i).filter((i) => !info[i]?.failed);
  if (r.files.length > slots.length) r.files = pruneExtras(r.files, slots.length, jlog(job));
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
/** Báo cáo research của job Scale: hiện ở trang chi tiết + lưu report.md trong thư mục job. */
function saveReport(job, md) {
  if (!md) return;
  job.report = md;
  try { fs.writeFileSync(path.join(job.dir, 'report.md'), `# Báo cáo research — ${job.name}\n\n${md}\n`); } catch {}
}

/** Tên + màu + mô tả tiếng Việt của mẫu Scale lấy theo brief của Claude (giữ màu ChatGPT báo nếu có). */
// Job Scale = tiến trình riêng 2 chặng: (1) Claude phân tích + research → 5 hướng, dừng ở stage 'review'
// chờ nhân viên chọn hướng; (2) bấm "Tạo ảnh" → ChatGPT vẽ mockup cho các hướng đã chọn (job.picked).
const pickedDesigns = (job) => (job.picked || []).map((k) => job.designs?.[k]).filter(Boolean);
function applyDesigns(job) {
  pickedDesigns(job).forEach((d, i) => {
    const o = job.options[i];
    if (!o) return;
    o.name = d.name || o.name; o.summary = d.summary_vi || o.summary;
    o.shirt_color = job.color || d.shirt_color || o.shirt_color; // ChatGPT hay ghi kèm tên SP ("T-shirt 2 mặt Sage") -> lấy màu theo brief
  });
}

async function runAll(job, collect = false) {
  if (!job.design && !collect) {
    const ext = path.extname(job.designFile).slice(1).replace('jpg', 'jpeg');
    job.design = { base64: fs.readFileSync(job.designFile).toString('base64'), mimeType: `image/${ext}` };
  }
  job.running = true; job.cancelled = false; job.stage = 'running'; job.error = null; job.imgCount = 0;
  job.step = 'open'; job.stepAt = new Date().toISOString();
  job.options.forEach((o) => { if (o.status !== 'done') { o.status = 'run'; o.error = null; } });
  update();
  const expect = job.options.length;
  const msgArgs = { product: job.product, model: job.model, color: job.color, note: job.note };
  try {
    // Bước đầu mọi job: Claude phân tích design (làm 1 lần — Thử lại không phân tích lại).
    //  - Scale: + research thị trường -> 5 hướng scale -> DỪNG chờ nhân viên chọn hướng (job:pick).
    //  - Redesign: 5 hướng redesign (giữ art + chữ) -> chạy tiếp luôn sang ChatGPT vẽ 5 mockup.
    if (!collect && !job.designs?.length) {
      const scale = job.mode === 'scale';
      setStep(job, 'analyze');
      const a = await claude.analyze({
        key: job.id, designFile: job.designFile,
        prompt: scale ? P.scaleAnalysisPrompt(msgArgs) : P.redesignAnalysisPrompt(msgArgs),
        tools: scale ? 'Read,WebSearch,WebFetch' : 'Read',
        workDir: path.join(runnerPaths().downloadDir, `claude-${path.basename(job.dir)}`),
      }, jlog(job));
      if (job.cancelled) throw new Error('Đã huỷ.');
      job.designs = a.designs;
      saveReport(job, a.report);
      if (scale) {
        job.stage = 'review';
        jlog(job)('Phân tích xong — chờ chọn hướng để tạo ảnh.');
        return;
      }
      job.picked = job.designs.map((_, k) => k).slice(0, job.options.length);
      applyDesigns(job);
      saveJobFile(job); update();
      job.step = 'open'; job.stepAt = new Date().toISOString();
    }
    await skillReady; // app vừa cập nhật skill mới vào tài khoản -> chờ cài xong rồi mới gửi
    const r = await runner.workTask(collect
      ? { ...runnerPaths(), ...hooks(job), url: job.convUrl, collectOnly: true, expect }
      : {
        ...runnerPaths(),
        ...hooks(job),
        skill: getSettings().skillName,
        // Có brief của Claude -> skill chỉ vẽ theo brief (phòng hờ không có brief thì skill tự phân tích như bản đầu).
        // Có brief của Claude -> tin nhắn CHỈ gọi @skill, brief nằm trong file comfort-brief.md đính kèm.
        message: job.designs?.length ? '' : P.skillMessage(msgArgs),
        images: job.designs?.length
          ? [job.design, { fileName: P.BRIEF_FILE, text: P.briefFile({ ...msgArgs, designs: pickedDesigns(job), kind: job.mode === 'scale' ? 'scale' : 'redesign' }) }]
          : [job.design],
        expect,
        onUrl: (u) => { job.convUrl = u; saveJobFile(job); update(); },
      }, jlog(job));
    assignResults(job, r);
    applyDesigns(job);
    job.stage = 'done';
  } catch (e) {
    if (job.cancelled) { job.stage = 'cancelled'; job.error = 'Đã huỷ.'; jlog(job)('Đã huỷ job.'); }
    else { job.stage = 'error'; job.error = e.message || String(e); jlog(job)('❌ ' + job.error); }
    if (/Claude chưa đăng nhập|máy chưa có Claude/i.test(job.error || '')) { setSettings({ claudeOk: false }); setupChanged(); }
    else if (/chưa đăng nhập|hết hạn/i.test(job.error || '')) { setSettings({ loginOk: false }); setupChanged(); }
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
    claudeOk: !!st.claudeOk, claudeInstalled: !!claude.findClaude(), claudeEmail: st.claudeEmail || '',
    claudeLoginUrl, // đang chờ nhân viên dán mã đăng nhập Claude
    outDir: st.outDir,
    // đã tự chọn / xác nhận thư mục lưu (máy cũ đã đổi thư mục khác mặc định cũng tính là đã chọn)
    outDirOk: !!st.outDirChosen || st.outDir !== defaults().outDir,
  };
}
const setupChanged = () => send('setup:update', setupStatus());

ipcMain.handle('setup:status', () => setupStatus());
/**
 * Tải skill của app lên tài khoản ChatGPT (ngầm). Chỉ 1 lượt cài tại 1 thời điểm — trước đây lượt tự cập nhật
 * lúc mở app và lượt của bước kiểm tra chạy chồng nhau -> ChatGPT báo "Couldn't upload this skill" (12/11).
 * quiet = cập nhật nền (bản app mới mang skill mới): lỗi thì chỉ ghi log, KHÔNG đánh dấu tài khoản hỏng
 * (tài khoản vẫn có skill cũ dùng được), lần mở app sau thử lại.
 */
let installing = null;
function autoInstallSkill({ quiet = false } = {}) {
  if (!installing) {
    installing = (async () => {
      log('Đang tự cài skill vào tài khoản ChatGPT (chạy ngầm)…');
      try { return await runner.installSkill({ ...runnerPaths(), skill: getSettings().skillName, zipPath: skillZip() }, log); }
      catch (e) { log('Cài skill lỗi: ' + (e.message || e)); return { ok: false }; }
    })().finally(() => { installing = null; });
  }
  return installing.then((r) => {
    if (r.ok) setSettings({ skillOk: true, skillHash: skillHash() });
    else if (!quiet) setSettings({ skillOk: false });
    setupChanged();
    if (!r.ok && !quiet) throw new Error('Chưa chuẩn bị xong tài khoản — bấm Thử lại.');
  });
}

// Kiểm tra ngầm đăng nhập + skill. Tài khoản ĐÃ CÓ skill đúng tên -> xong, không cài lại;
// chưa có -> mới tải skill của app lên. (Cập nhật skill khi app có bản mới: refreshSkillIfChanged, chạy nền.)
ipcMain.handle('setup:check', async () => {
  await claudeCheck().catch(() => {}); // Claude: chỉ đọc trạng thái trên máy (~1–2s)
  let r;
  try { r = await runner.checkSetup({ ...runnerPaths(), skill: getSettings().skillName }, log); }
  catch (e) { log('Kiểm tra lỗi: ' + (e.message || e)); throw new Error('Chưa kiểm tra được — thử lại sau ít phút.'); }
  if (installing) await installing.catch(() => {}); // đang có lượt cài (tự cập nhật lúc mở app) -> chờ, không cài chồng
  setSettings({ loginOk: r.loggedIn, skillOk: r.loggedIn && r.skill });
  setupChanged();
  if (r.loggedIn && !r.skill) await autoInstallSkill();
  return setupStatus();
});
// App mới cài bản skill khác (VD thêm chế độ Scale) -> tự cài lại ngầm khi mở app; job chờ cài xong mới gửi.
let skillReady = Promise.resolve();
function refreshSkillIfChanged() {
  const st = getSettings();
  if (!st.loginOk || !st.skillOk || !skillHash() || st.skillHash === skillHash()) return;
  log('Skill đi kèm app đã đổi — tự cập nhật vào tài khoản ChatGPT…');
  skillReady = autoInstallSkill({ quiet: true }).catch(() => {});
}
// Claude (bước phân tích của job Scale): cài bằng bộ cài chính thức + đăng nhập tài khoản Claude trên trình duyệt.
async function claudeCheck() {
  const s = await claude.status();
  setSettings({ claudeOk: s.loggedIn, claudeEmail: s.email || '' });
  setupChanged();
  return setupStatus();
}
ipcMain.handle('setup:claudeCheck', () => claudeCheck());
ipcMain.handle('setup:claudeCode', (_e, code) => claude.submitCode(code));
ipcMain.handle('setup:claudeOpenLogin', () => claudeLoginUrl && shell.openExternal(claudeLoginUrl));
ipcMain.handle('setup:claudeCancelLogin', () => claude.cancelLogin());
ipcMain.handle('setup:claudeInstall', async () => {
  try { await claude.install(log); } catch (e) { log('Cài Claude lỗi: ' + (e.message || e)); throw new Error('Chưa cài được Claude — kiểm tra mạng rồi bấm thử lại.'); }
  return claudeCheck();
});
let claudeLoginUrl = null;
ipcMain.handle('setup:claudeLogin', async () => {
  const s = await claude.login(log, ({ url }) => { claudeLoginUrl = url; setupChanged(); });
  claudeLoginUrl = null;
  await claudeCheck();
  if (!s.loggedIn) throw new Error('Chưa đăng nhập Claude — bấm Đăng nhập Claude và hoàn tất trên trình duyệt.');
  return setupStatus();
});
// ------------------------------- Tài khoản & mức dùng (⚙ Cài đặt) ----------------
/** Thống kê trong app: job + ảnh đã tạo hôm nay / 7 ngày (kể cả job đã ẩn khỏi danh sách). */
function usageStats() {
  const metas = [];
  try {
    for (const f of fs.readdirSync(jobsStore()).filter((x) => x.endsWith('.json'))) {
      try { metas.push(JSON.parse(fs.readFileSync(path.join(jobsStore(), f), 'utf8'))); } catch {}
    }
  } catch {}
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime(), t7 = t0 - 6 * 86400000;
  const s = { jobsToday: 0, jobs7: 0, imagesToday: 0, images7: 0, analysesToday: 0, analyses7: 0 };
  // 7 ngày (cũ -> hôm nay) cho biểu đồ trên bảng điều khiển
  const p2 = (n) => String(n).padStart(2, '0');
  s.days = Array.from({ length: 7 }, (_, k) => { const d = new Date(t7 + k * 86400000); return { d: `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`, images: 0, jobs: 0 }; });
  const dayIdx = (t) => Math.floor((t - t7) / 86400000);
  for (const m of metas) {
    const c = Date.parse(m.createdAt || '') || 0;
    if (c >= t0) s.jobsToday++;
    if (c >= t7 && s.days[dayIdx(c)]) s.days[dayIdx(c)].jobs++;
    if (c >= t7) { s.jobs7++; if (m.designs?.length) { s.analyses7++; if (c >= t0) s.analysesToday++; } }
    for (const o of m.options || []) {
      if (!o.file || !o.t) continue;
      if (o.t >= t0) s.imagesToday++;
      if (o.t >= t7) { s.images7++; if (s.days[dayIdx(o.t)]) s.days[dayIdx(o.t)].images++; }
    }
  }
  return s;
}
// Mức dùng ChatGPT mới nhất (bắt được lúc chạy job) -> gộp vào thông tin đã lưu.
function accountWithLive() {
  const a = getSettings().account || {};
  const live = runner.usageSnapshot();
  if (live && (!a.chatgpt?.usage || Date.parse(live.at) > Date.parse(a.chatgpt.usage.at || 0))) {
    a.chatgpt = { ...(a.chatgpt || {}), usage: live };
    setSettings({ account: a });
  }
  return { ...a, stats: usageStats() };
}
ipcMain.handle('account:get', () => accountWithLive());
// Làm mới: ChatGPT mở ngầm 1 cửa sổ đọc phiên (~10–20s); Claude đọc trạng thái + 1 câu ngắn để lấy mức dùng (~5s).
ipcMain.handle('account:refresh', async () => {
  const [g, c, u] = await Promise.all([
    runner.accountInfo({ ...runnerPaths(), key: 'account' }, log).then((x) => ({ ...x, ok: true }), (e) => ({ ok: false, error: e.message || String(e) })),
    claude.status().catch(() => ({})),
    claude.usage().catch(() => null),
  ]);
  const prev = getSettings().account || {};
  const account = {
    chatgpt: g.ok ? { ...g, usage: g.usage || prev.chatgpt?.usage || null, checkedAt: new Date().toISOString() } : { ...(prev.chatgpt || {}), error: g.error },
    claude: { ...c, usage: u || prev.claude?.usage || null, usageAt: u ? new Date().toISOString() : prev.claude?.usageAt || '', checkedAt: new Date().toISOString() },
  };
  setSettings({ account, ...(g.ok ? { loginOk: true } : {}), claudeOk: !!c.loggedIn, claudeEmail: c.email || '' });
  setupChanged();
  return { ...account, stats: usageStats() };
});

ipcMain.handle('setup:installSkill', async () => { await autoInstallSkill(); return setupStatus(); });
ipcMain.handle('setup:showSkillFile', () => shell.showItemInFolder(skillZip()));
ipcMain.handle('setup:confirmOutDir', (_e, dir) => { setSettings({ outDir: dir || getSettings().outDir, outDirChosen: true }); return setupStatus(); });
ipcMain.handle('setup:getChrome', () => shell.openExternal('https://www.google.com/chrome/'));
ipcMain.handle('chatgpt:watch', (_e, on) => runner.setWatch(on, log));

// mode: 'redesign' (5 hướng redesign) | 'scale' (research các sàn + 4 mẫu scale + báo cáo).
ipcMain.handle('job:start', (_e, { base64, mimeType, fileName, product, model, color, note, mode, designCode }) => {
  const prod = P.findProduct(product);
  const scale = mode === 'scale';
  const code = safeName(designCode);
  const base = `${stamp()}-${scale ? 'scale-' : ''}${code ? code : `${slug(prod.name)}-${slug(path.parse(fileName || 'design').name)}`}`;
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
    mode: scale ? 'scale' : 'redesign', report: '', designCode: code,
    product: prod.name, model: prod.wear ? (model || 'woman') : '', color: prod.cc ? (color || '') : '', note: note || '',
    code: jobCode(scale ? 'SC' : 'CR'), createdAt: new Date().toISOString(), step: 'queue', stepAt: new Date().toISOString(),
    stage: 'queued', running: false, error: null, convUrl: null, options: [],
  };
  // Job Scale chưa có mẫu nào: mẫu chỉ có sau khi nhân viên chọn hướng (job:pick).
  job.options = Array.from({ length: scale ? 0 : P.NUM_OPTIONS }, (_, i) => ({ name: `Mẫu ${i + 1}`, shirt_color: job.color, summary: '', status: 'wait', file: null, error: null, t: 0 }));
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
    claude.cancel(job.id);
    await runner.cancel(job.id);
  }
});

// Thử lại: chạy lại job lỗi/huỷ từ đầu (hội thoại mới), giữ các mẫu đã xong.
// Chọn hướng scale (chỉ số trong job.designs) -> tạo mẫu + xếp hàng chặng vẽ bằng ChatGPT.
ipcMain.handle('job:pick', (_e, id, picks) => {
  const job = findJob(id);
  if (!job || job.mode !== 'scale' || job.stage !== 'review' || job.running) return;
  const idx = [...new Set((picks || []).map(Number))].filter((k) => job.designs?.[k]).sort((a, b) => a - b);
  if (!idx.length) return;
  job.picked = idx;
  job.options = idx.map(() => ({ name: '', shirt_color: job.color, summary: '', status: 'wait', file: null, error: null, t: 0 }));
  applyDesigns(job);
  job.stage = 'queued'; job.error = null; job.step = 'queue'; job.stepAt = new Date().toISOString();
  jlog(job)(`Đã chọn ${idx.length} hướng: ${idx.map((k) => k + 1).join(', ')} — xếp hàng tạo ảnh.`);
  saveJobFile(job);
  pump();
});

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
  refreshSkillIfChanged();
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
  let owner = 'Mid-4', repo = 'Redesign';
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
