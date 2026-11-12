// app.js — giao diện Comfort Redesign (HTML/JS thuần, gọi main qua window.api).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let design = null;   // { base64, mimeType, fileName }
let colors = [];     // [[name, hex]]
let jobs = [];       // mọi job trong phiên (main gửi sang)
let selId = null;    // job đang xem
let job = null;      // = job đang xem
let loggedIn = null; // null = chưa biết

const colorHex = (name) => (colors.find((c) => c[0].toLowerCase() === String(name || '').toLowerCase()) || [])[1];
const swatch = (name) => { const h = colorHex(name); return h ? `background:${h}` : ''; };

// ------------------------------- Chip trạng thái ----------------------------
function setChip() {
  const c = $('chip');
  const n = jobs.filter((j) => j.running).length, q = jobs.filter((j) => j.stage === 'queued').length;
  if (n || q) { c.className = 'chip run'; c.textContent = `Đang chạy ${n}${q ? ` · chờ ${q}` : ''}`; return; }
  if (loggedIn === true) { c.className = 'chip ok'; c.textContent = 'ChatGPT đã đăng nhập'; return; }
  if (loggedIn === false) { c.className = 'chip bad'; c.textContent = 'ChatGPT chưa đăng nhập'; return; }
  c.className = 'chip'; c.textContent = 'ChatGPT';
}

// ------------------------------- Ảnh design ---------------------------------
/** Đưa form về trạng thái job mới hoàn toàn: xoá ảnh, sản phẩm / người mẫu / màu / ghi chú về mặc định. */
function resetForm() {
  design = null;
  $('preview').hidden = true; $('preview').removeAttribute('src'); $('dropText').hidden = false;
  $('inFile').value = '';
  $('selProduct').value = defaultProduct;
  $('selModel').value = 'woman';
  $('selColor').value = '';
  $('note').value = '';
  $('designCode').value = '';
  syncProduct(); paintColor();
}

function loadFile(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) { $('err').textContent = 'Chỉ nhận ảnh png, jpg, webp.'; return; }
  const fr = new FileReader();
  fr.onload = () => {
    const url = String(fr.result);
    design = { base64: url.split(',')[1], mimeType: file.type, fileName: file.name || 'design.png' };
    // Chưa nhập mã -> gợi ý theo tên file (ảnh dán từ clipboard tên chung chung thì bỏ qua), sửa lại được.
    const stem = (file.name || '').replace(/\.[^.]+$/, '');
    if (!$('designCode').value.trim() && stem && !/^(image|design|paste|clipboard|untitled)\b/i.test(stem)) $('designCode').value = stem.slice(0, 60);
    $('preview').src = url; $('preview').hidden = false; $('dropText').hidden = true;
    $('err').textContent = '';
    refreshButtons();
  };
  fr.readAsDataURL(file);
}

const drop = $('drop');
$('inFile').onchange = (e) => loadFile(e.target.files[0]);
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); loadFile(e.dataTransfer.files[0]); };
document.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

// ------------------------------- Màu áo -------------------------------------
// Sản phẩm + người mẫu: người mẫu chỉ hiện với đồ mặc, màu Comfort Colors chỉ hiện với T-Shirt/Sweatshirt.
let products = [];
let defaultProduct = '';
let paintColor = () => {};
let syncProduct = () => {};
const product = () => products.find((p) => p.name === $('selProduct').value) || products[0];
async function initCatalog() {
  const c = await window.api.catalog();
  products = c.products.flatMap((g) => g.items);
  $('selProduct').innerHTML = c.products.map((g) => `<optgroup label="${esc(g.group)}">${g.items.map((p) => `<option>${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  $('selModel').innerHTML = c.models.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  defaultProduct = c.defaultProduct;
  const sync = () => { const p = product(); $('fieldModel').hidden = !p.wear; $('fieldColor').hidden = !p.cc; };
  syncProduct = sync;
  $('selProduct').onchange = sync;
}

async function initColors() {
  colors = await window.api.colors();
  const sel = $('selColor');
  sel.innerHTML = '<option value="">AI tự chọn theo từng hướng</option>' + colors.map(([n]) => `<option>${esc(n)}</option>`).join('');
  const paint = () => { $('sw').style.background = colorHex(sel.value) || ''; };
  sel.onchange = paint;
  paintColor = paint;
}

// ------------------------------- Chạy job -----------------------------------
function refreshButtons() {
  $('btnStart').disabled = !design;
  $('btnScale').disabled = !design;
  setChip();
}

// mode: 'redesign' = 5 hướng redesign · 'scale' = research các sàn + 4 mẫu scale + báo cáo.
async function startJob(mode) {
  $('err').textContent = '';
  try {
    const p = product();
    await window.api.start({ ...design, mode, designCode: $('designCode').value.trim(), product: p.name, model: p.wear ? $('selModel').value : '', color: p.cc ? $('selColor').value : '', note: $('note').value.trim() });
    resetForm(); // như Design Template: tạo job xong thì form trống để tạo job mới hoàn toàn
    render();
  } catch (e) { $('err').textContent = e.message || String(e); }
}
// Cả 2 luồng đều bắt đầu bằng bước Claude phân tích -> cần đăng nhập Claude.
async function startWithClaude(mode) {
  if (SETUP.st && !SETUP.st.claudeOk) {
    await openSetup();
    SETUP.err = 'Cần đăng nhập Claude (bước 3) để phân tích design — làm xong rồi bấm lại.'; renderSetup();
    return;
  }
  startJob(mode);
}
$('btnStart').onclick = () => startWithClaude('redesign');
$('btnScale').onclick = () => startWithClaude('scale');
$('btnCollect').onclick = () => job && window.api.collect(job.id);
$('btnOpenDir').onclick = () => job && window.api.openDir(job.id);

$('btnLogin').onclick = async () => {
  $('btnLogin').disabled = true;
  try { const r = await window.api.login(); loggedIn = !!r?.loggedIn; }
  catch (e) { $('err').textContent = e.message || String(e); }
  finally { $('btnLogin').disabled = false; setChip(); }
};


window.api.onLog((msg) => {
  if (/chưa đăng nhập|hết hạn/i.test(msg)) loggedIn = false;
  else if (/sẵn sàng \(đã đăng nhập\)|Xác nhận đăng nhập/.test(msg)) loggedIn = true;
  setChip();
});
window.api.onJobs((list) => { jobs = list; render(); });

// ------------------------------- Hiển thị kết quả ---------------------------
const STATUS = { wait: ['Chờ', 'chip'], run: ['Đang tạo…', 'chip run'], done: ['Xong', 'chip ok'], error: ['Lỗi', 'chip bad'] };

function stageText(j) {
  if (j.stage === 'review') return 'Phân tích xong — xem báo cáo, chọn hướng muốn làm rồi bấm Tạo ảnh.';
  if (j.stage === 'queued') return 'Đang xếp hàng — sẽ chạy khi có job xong.';
  if (j.stage === 'error' || j.stage === 'cancelled') return 'Lỗi: ' + (j.error || '');
  const done = j.options.filter((o) => o.status === 'done').length;
  if (j.running) return (STEP_TEXT[j.step] || 'Đang chạy') + '…';
  return `Hoàn tất ${done}/${j.options.length} mẫu.`;
}

function renderAnalysis(j) {
  $('anImg').src = j.designUrl;
  const modelLabel = { woman: 'Nữ', man: 'Nam', couple: 'Cặp đôi', auto: 'AI chọn' }[j.model] || '';
  const p = products.find((x) => x.name === j.product);
  $('anBody').innerHTML = `
    <p class="an-row"><b>Loại job:</b>${j.mode === 'scale' ? 'Phân tích &amp; Scale (Claude research → chọn hướng → tạo mockup)' : 'Redesign 5 hướng'}</p>
    <p class="an-row"><b>Sản phẩm:</b>${esc(j.product || '')}${modelLabel ? ` · <b>Người mẫu:</b>${esc(modelLabel)}` : ''}</p>
    ${p?.cc ? `<p class="an-row"><b>Màu áo:</b>${esc(j.color || 'AI tự chọn theo từng hướng')}</p>` : ''}
    ${j.note ? `<p class="an-row"><b>Ghi chú:</b>${esc(j.note)}</p>` : ''}
    <p class="an-row"><b>Thư mục:</b>${esc(j.dir)}</p>
    ${['error', 'cancelled'].includes(j.stage) ? `<p class="err">${esc(j.error)}</p>` : ''}`;
  // Lỗi / thiếu mẫu mà đã có hội thoại -> lấy lại kết quả (ChatGPT có thể vẫn đang làm tiếp).
  $('btnCollect').hidden = !(j.convUrl && !j.running && j.options.some((o) => o.status !== 'done'));
  renderReport(j);
}

// ------------------------------- Báo cáo research (job Scale) ----------------
/** Markdown gọn (tiêu đề, gạch đầu dòng, đánh số, in đậm, link) -> HTML an toàn. */
function mdToHtml(md) {
  const inline = (s) => esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank">${t}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  let html = '', list = '';
  const close = () => { if (list) { html += `</${list}>`; list = ''; } };
  for (const raw of String(md || '').split('\n')) {
    const l = raw.trim();
    let m;
    if (!l) { close(); continue; }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { close(); html += m[1].length <= 2 ? `<h4>${inline(m[2])}</h4>` : `<h5>${inline(m[2])}</h5>`; continue; }
    const ul = l.match(/^[-*•]\s+(.*)$/), ol = l.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { close(); html += `<${want}>`; list = want; }
      html += `<li>${inline((ul || ol)[1])}</li>`;
      continue;
    }
    close(); html += `<p>${inline(l)}</p>`;
  }
  close();
  return html;
}

function renderReport(j) {
  const box = $('report');
  const scale = j.mode === 'scale';
  const waiting = !j.report && (j.stage === 'queued' || (j.running && j.step === 'analyze'));
  // Job Redesign cũ (trước khi có bước Claude) không có phân tích -> ẩn khung.
  box.hidden = !(j.report || waiting || scale);
  if (box.hidden) return;
  const title = scale ? '📊 Báo cáo research thị trường' : '🔍 Phân tích design (Claude)';
  const html = j.report
    ? `<h4>${title}</h4>${mdToHtml(j.report)}<p class="hint">Đã lưu: report.md trong thư mục job.</p>`
    : `<p class="hint">${waiting ? (scale ? '📊 Claude đang phân tích & research — báo cáo + 5 hướng scale sẽ hiện ở đây khi xong.' : '🔍 Claude đang phân tích design — kết quả + 5 hướng redesign sẽ hiện ở đây khi xong.') : '📊 Chưa có báo cáo.'}</p>`;
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}

// Mô tả tạo lại đang gõ, theo job + mẫu (giữ nguyên khi trang tự làm mới).
const regenNotes = {};
const noteKey = (i) => `${job.id}:${i}`;

function renderOption(o, i) {
  let [label, cls] = STATUS[o.status] || STATUS.wait;
  if (o.regen === 'run') [label, cls] = ['Đang tạo lại…', 'chip run'];
  else if (o.regen === 'wait') [label, cls] = ['Chờ tạo lại', 'chip warn'];
  const regenning = !!o.regen;
  const shot = o.url
    ? `<img src="${esc(o.url)}" alt="" data-big="${esc(o.url)}">${regenning ? `<div class="regen-over">${o.regen === 'run' ? 'Đang tạo lại…' : 'Chờ tạo lại…'}</div>` : ''}`
    : `<div class="msg">${o.status === 'run' ? 'Đang làm…' : o.status === 'wait' ? 'Đang xếp hàng…' : 'Chưa có ảnh'}</div>`;
  const canRegen = !regenning && o.status !== 'run' && !job.running && !!job.convUrl;
  return `<div class="card opt">
    <div class="top"><b title="${esc(o.name)}">${i + 1} · ${esc(o.name)}</b><span class="${cls}">${label}</span></div>
    <div class="shot ${o.status === 'run' || regenning ? 'run' : ''} ${regenning && o.url ? 'dim' : ''}">${shot}</div>
    <div class="meta"><i class="sw" style="${swatch(o.shirt_color)}"></i>${esc(o.shirt_color || '—')}${o.summary ? ` · ${esc(o.summary)}` : ''}</div>
    ${o.error ? `<div class="oerr">${esc(o.error)}</div>` : ''}
    <textarea class="regen-note" data-note="${i}" rows="2" placeholder="${job.mode === 'scale' ? 'Mô tả muốn sửa khi tạo lại (tuỳ chọn) — VD: đổi câu chữ cho nghề y tá, áo màu Sage…' : 'Mô tả muốn sửa khi tạo lại (tuỳ chọn) — VD: đổi áo màu Sage, chữ to hơn, nền ngoài trời…'}" ${canRegen ? '' : 'disabled'}></textarea>
    <div class="row">
      <button class="btn sm pri" data-regen="${i}" ${canRegen ? '' : 'disabled'}>↻ Tạo lại</button>
      <button class="btn sm" data-file="${i}" ${o.file ? '' : 'disabled'}>Hiện file</button>
    </div>
  </div>`;
}

/** Vẽ lại lưới mẫu nhưng chỉ thay thẻ nào thay đổi -> ô mô tả đang gõ không mất chữ / con trỏ. */
function renderGrid() {
  const grid = $('grid');
  if (grid.dataset.job !== String(job.id)) { grid.innerHTML = ''; grid.dataset.job = String(job.id); }
  job.options.forEach((o, i) => {
    const html = renderOption(o, i);
    let cell = grid.children[i];
    if (!cell) { cell = document.createElement('div'); cell.className = 'cell'; grid.appendChild(cell); }
    if (cell.dataset.html === html) return;
    const ta = cell.querySelector('textarea');
    const hadFocus = ta && document.activeElement === ta, sel = ta && [ta.selectionStart, ta.selectionEnd];
    cell.innerHTML = html; cell.dataset.html = html;
    const nt = cell.querySelector('textarea');
    nt.value = regenNotes[noteKey(i)] || '';
    if (hadFocus && !nt.disabled) { nt.focus(); nt.setSelectionRange(sel[0], sel[1]); }
  });
  while (grid.children.length > job.options.length) grid.lastChild.remove();
}
$('grid').addEventListener('input', (e) => {
  const t = e.target.closest('[data-note]');
  if (t) regenNotes[noteKey(Number(t.dataset.note))] = t.value;
});

// ------------------------------- Hàng đợi job (giống Design Template) -------
const STEPS = ['Gửi', 'Đang làm', 'Tải ảnh'];
const STEP_IDX = { open: 0, send: 0, work: 1, download: 2 };
// Job Scale: Phân tích (Claude research) → Tạo ảnh → Tải ảnh.
const SCALE_STEPS = ['Phân tích', 'Tạo ảnh', 'Tải ảnh'];
const SCALE_IDX = { analyze: 0, open: 1, send: 1, work: 1, download: 2 };
const legacy = (j) => j.mode !== 'scale' && !j.designs?.length && j.stage === 'done'; // job Redesign làm trước khi có bước Claude
const stepsOf = (j) => (legacy(j) ? STEPS : SCALE_STEPS);
const idxOf = (j) => (legacy(j) ? STEP_IDX : SCALE_IDX);
const STEP_TEXT = { queue: 'Chờ tới lượt', analyze: 'Đang phân tích & research', open: 'Chuẩn bị', send: 'Gửi design', work: 'Đang làm', download: 'Tải ảnh về' };
const EXPECT = { analyze: 360, open: 20, send: 40, work: 420, download: 20 }; // giây dự kiến mỗi bước (để thanh chạy đều, không tới 100%)
const QTABS = [['all', 'Tất cả'], ['run', 'Đang chạy'], ['done', 'Hoàn tất'], ['fail', 'Lỗi / huỷ']];
let qTab = 'all';

function jobState(j) {
  if (j.running || j.stage === 'queued' || j.stage === 'review') return 'run';
  if (j.stage === 'error' || j.stage === 'cancelled') return 'fail';
  return 'done';
}
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const modelName = (m) => ({ woman: 'Nữ', man: 'Nam', couple: 'Cặp đôi', auto: 'AI chọn' }[m] || '');

function statusChip(j) {
  const done = j.options.filter((o) => o.status === 'done').length;
  if (j.stage === 'review') return ['Chờ chọn hướng', 'chip warn'];
  if (j.stage === 'queued') return ['Chờ chạy', 'chip'];
  if (j.running) return ['Đang chạy', 'chip run'];
  if (j.stage === 'cancelled') return ['Đã huỷ', 'chip bad'];
  if (j.stage === 'error') return [done ? `Lỗi · ${done}/${j.options.length} mẫu` : 'Lỗi', 'chip bad'];
  return [done < j.options.length ? `Xong ${done}/${j.options.length} mẫu` : 'Hoàn tất', done < j.options.length ? 'chip warn' : 'chip ok'];
}

function progressHtml(j) {
  const steps = stepsOf(j), sIdx = idxOf(j);
  let cur = j.stage === 'done' ? steps.length : j.running ? (sIdx[j.step] ?? 0) : j.stage === 'queued' ? -1 : (sIdx[j.step] ?? 1);
  if (j.designs?.length && cur < 1) cur = 1; // đã phân tích xong
  let pct = 0;
  if (j.running && j.stepAt) {
    const exp = EXPECT[j.step] || 60;
    pct = Math.min(95, Math.max(4, ((Date.now() - Date.parse(j.stepAt)) / 1000 / exp) * 100));
    if (j.step === 'work' && j.imgCount) pct = Math.max(pct, Math.min(95, (j.imgCount / j.options.length) * 100));
  }
  const segs = steps.map((_, i) => {
    if (i < cur) return '<i><b style="width:100%"></b></i>';
    if (i === cur && j.running) return `<i class="run"><b style="width:${pct}%"></b></i>`;
    if (i === cur && (j.stage === 'error' || j.stage === 'cancelled')) return '<i class="bad"><b></b></i>';
    return '<i><b></b></i>';
  }).join('');
  let text, start = '';
  if (j.stage === 'review') text = 'Phân tích xong · chọn hướng để tạo ảnh';
  else if (j.stage === 'queued') text = 'Chờ tới lượt';
  else if (j.running) {
    text = STEP_TEXT[j.step] || 'Đang chạy';
    if (j.step === 'work' && j.imgCount) text += ` · ${j.imgCount}/${j.options.length} ảnh`;
    start = j.stepAt || '';
  } else if (j.stage === 'error' || j.stage === 'cancelled') text = j.error || 'Lỗi';
  else text = `Hoàn tất · ${j.options.filter((o) => o.status === 'done').length} mẫu`;
  return `<div class="prog">${segs}</div><div class="ptext" ${start ? `data-start="${esc(start)}" data-label="${esc(text)}"` : ''} title="${esc(text)}">${esc(text)}</div>`;
}

function rowHtml(j) {
  const [label, cls] = statusChip(j);
  const sub = [j.product, modelName(j.model), j.color].filter(Boolean).join(' · ');
  const busy = j.running || j.options.some((o) => o.status === 'run');
  const acts = [j.stage === 'review'
    ? `<button class="btn sm pri" data-act="detail" data-id="${j.id}">Chọn hướng</button>`
    : `<button class="btn sm" data-act="detail" data-id="${j.id}">Chi tiết</button>`];
  if (j.convUrl && !busy && j.stage !== 'queued' && j.options.some((o) => o.status !== 'done')) acts.push(`<button class="btn sm pri" data-act="collect" data-id="${j.id}">Lấy kết quả</button>`);
  if (['error', 'cancelled'].includes(j.stage) && !busy) acts.push(`<button class="btn sm" data-act="retry" data-id="${j.id}">Thử lại</button>`);
  if (j.stage === 'queued' || j.running) acts.push(`<button class="btn sm danger" data-act="cancel" data-id="${j.id}">Huỷ</button>`);
  else if (!busy) acts.push(`<button class="btn sm" data-act="remove" data-id="${j.id}" title="Ẩn khỏi danh sách (file vẫn giữ)">Xoá khỏi danh sách</button>`);
  return `<div class="qrow">
    <div class="prod" data-act="detail" data-id="${j.id}"><img src="${esc(j.designUrl)}" alt="">
      <div style="min-width:0"><div class="s">${esc(j.code || '')}${j.mode === 'scale' ? ' <span class="tag scale">Scale</span>' : ''}</div><div class="t" title="${esc(j.name)}">${esc(j.designCode || j.name)}</div><div class="s">${esc(sub)}</div></div></div>
    <div><span class="${cls}">${esc(label)}</span>${progressHtml(j)}</div>
    <div class="acts">${acts.join('')}</div>
  </div>`;
}

function renderQueue() {
  const all = jobs.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const count = (k) => (k === 'all' ? all.length : all.filter((j) => jobState(j) === k).length);
  $('qTabs').innerHTML = QTABS.filter(([k]) => k !== 'fail' || count('fail')).map(([k, l]) => `<button class="${qTab === k ? 'on' : ''}" data-tab="${k}">${l} · ${count(k)}</button>`).join('');
  const running = all.filter((j) => j.running).length, waiting = all.filter((j) => j.stage === 'queued').length;
  $('qSummary').textContent = `${all.length} job · ${running} đang chạy · ${waiting} chờ`;
  const list = all.filter((j) => qTab === 'all' || jobState(j) === qTab);
  $('qList').innerHTML = list.length ? list.map(rowHtml).join('') : `<div class="qempty">${all.length ? 'Chưa có job nào ở mục này.' : 'Chưa có job. Thả design bên trái rồi bấm <b>Redesign</b> hoặc <b>Phân tích &amp; Scale</b>.'}</div>`;
}

function renderDetail() {
  if (!$('dlgJob').open) return;
  job = jobs.find((j) => j.id === selId) || null;
  if (!job) { $('dlgJob').close(); return; }
  $('jobName').textContent = [job.designCode, job.code, job.designCode ? '' : job.name].filter(Boolean).join(' · ');
  $('jobStage').textContent = stageText(job);
  renderAnalysis(job);
  renderPicker(job);
  $('grid').hidden = !job.options.length;
  renderGrid();
}

// ------------------------------- Chọn hướng scale (job Scale chờ chọn) -------
const pickSel = {}; // job id -> Set chỉ số hướng đang tick (mặc định tick hết)
function renderPicker(j) {
  const box = $('picker');
  box.hidden = !(j.mode === 'scale' && j.stage === 'review' && j.designs?.length);
  if (box.hidden) { box.dataset.html = ''; return; }
  const sel = pickSel[j.id] || (pickSel[j.id] = new Set(j.designs.map((_, k) => k)));
  const html = `<h4>🎯 Chọn hướng scale muốn tạo ảnh</h4>
    <p class="hint">Tick các hướng muốn làm (xem lý do ở báo cáo bên trên). Mỗi hướng tạo 1 mockup 1:1.</p>
    <div class="pick-grid">${j.designs.map((d, k) => `<div class="pick ${sel.has(k) ? 'on' : ''}">
      <label class="ph"><input type="checkbox" data-pick="${k}" ${sel.has(k) ? 'checked' : ''}>${k + 1} · ${esc(d.name)}</label>
      <span class="pm"><i class="sw" style="${swatch(j.color || d.shirt_color)}"></i>${esc(j.color || d.shirt_color || '')}</span>
      <p>${esc(d.summary_vi || '')}</p>
      <details><summary>Mô tả chi tiết</summary>${esc(d.brief || '')}</details>
    </div>`).join('')}</div>
    <div class="pick-foot"><button class="btn pri" id="btnPick" ${sel.size ? '' : 'disabled'}>🎨 Tạo ảnh ${sel.size} hướng đã chọn</button>
      <span class="hint">Chưa chọn thì job đứng chờ, không tốn lượt tạo ảnh.</span></div>`;
  if (box.dataset.html !== html) {
    const open = [...box.querySelectorAll('details')].map((d) => d.open);
    box.innerHTML = html; box.dataset.html = html;
    box.querySelectorAll('details').forEach((d, k) => { d.open = !!open[k]; });
  }
}
$('picker').addEventListener('change', (e) => {
  const c = e.target.closest('[data-pick]'); if (!c || !job) return;
  const sel = pickSel[job.id];
  c.checked ? sel.add(Number(c.dataset.pick)) : sel.delete(Number(c.dataset.pick));
  renderPicker(job);
});
$('picker').addEventListener('click', async (e) => {
  if (!e.target.closest('#btnPick') || !job) return;
  const sel = [...(pickSel[job.id] || [])];
  if (sel.length) await window.api.pick(job.id, sel);
});

function render() {
  refreshButtons();
  renderQueue();
  renderDetail();
}

function openDetail(id) { selId = id; $('dlgJob').showModal(); renderDetail(); }

// Đồng hồ bước đang chạy (mỗi giây) — như Design Template.
setInterval(() => {
  for (const t of document.querySelectorAll('.ptext[data-start]')) {
    t.textContent = `${t.dataset.label} · ${mmss((Date.now() - Date.parse(t.dataset.start)) / 1000)}`;
  }
}, 1000);
setInterval(() => { if (jobs.some((j) => j.running)) renderQueue(); }, 5000); // thanh tiến trình nhích theo thời gian

$('qTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { qTab = b.dataset.tab; renderQueue(); } };
$('qList').onclick = (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = Number(b.dataset.id), act = b.dataset.act;
  if (act === 'detail') openDetail(id);
  else if (act === 'collect') window.api.collect(id);
  else if (act === 'retry') window.api.retry(id);
  else if (act === 'cancel') { if (confirm('Huỷ job này?')) window.api.cancel(id); }
  else if (act === 'remove') window.api.remove(id);
};
$('btnCloseJob').onclick = () => $('dlgJob').close();

$('grid').onclick = (e) => {
  const t = e.target;
  if (t.dataset.big) { $('bigImg').src = t.dataset.big; $('dlgImg').showModal(); }
  else if (t.dataset.regen) { const i = Number(t.dataset.regen); window.api.regen(job.id, i, regenNotes[noteKey(i)] || ''); }
  else if (t.dataset.file) window.api.openFile(job.options[Number(t.dataset.file)].file);
};
$('btnCloseImg').onclick = () => $('dlgImg').close();
$('dlgImg').onclick = (e) => { if (e.target === $('dlgImg')) $('dlgImg').close(); };

// ------------------------------- Cài đặt / giao diện ------------------------
$('btnSettings').onclick = async () => {
  const s = await window.api.getSettings();
  $('setOut').value = s.outDir; $('setParallel').value = String(s.parallel || 4);
  $('dlgSettings').showModal();
  const a = await window.api.account.get().catch(() => null);
  renderAccount(a);
  // Chưa có thông tin hoặc đã cũ hơn 30 phút -> tự làm mới.
  const at = Date.parse(a?.claude?.checkedAt || '') || 0;
  if (Date.now() - at > 30 * 60 * 1000) refreshAccount();
};

// ------------------------------- Tài khoản & mức dùng -------------------------
const PLAN = { team: 'Team', plus: 'Plus', pro: 'Pro', free: 'Free', enterprise: 'Enterprise', business: 'Business', edu: 'Edu', max: 'Max' };
const planName = (p) => PLAN[String(p || '').toLowerCase()] || p || '—';
const fmtTime = (iso) => {
  const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
  if (isNaN(d)) return '';
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}${d.getFullYear() !== new Date().getFullYear() ? `/${d.getFullYear()}` : ''}`;
};
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !iso || isNaN(m) ? '' : m < 1 ? 'vừa xong' : m < 60 ? `${m} phút trước` : `${Math.round(m / 60)} giờ trước`; };
let acctBusy = false;
function meter(label, w) {
  if (!w) return '';
  const cls = w.used >= 90 ? 'bad' : w.used >= 70 ? 'warn' : '';
  return `<div class="meter"><span>${label}</span><i><b class="${cls}" style="width:${Math.min(100, w.used)}%"></b></i><span>còn ${Math.max(0, 100 - w.used)}% · reset ${esc(fmtTime(w.resetsAt))}</span></div>`;
}
function renderAccount(a) {
  const g = a?.chatgpt || {}, c = a?.claude || {}, st = a?.stats || {}, u = c.usage;
  $('acctBox').innerHTML = `
    <div class="acct-card">
      <div class="ah"><b>ChatGPT</b>${g.email ? `<span class="chip ok">${esc(planName(g.plan))}${g.structure === 'workspace' ? ' · workspace' : ''}</span>` : '<span class="chip">Chưa có thông tin</span>'}</div>
      ${g.email ? `<div class="ar"><b>${esc(g.email)}</b>${g.name ? ` · ${esc(g.name)}` : ''}</div>
      <div class="ar">Phiên đăng nhập hết hạn: ${esc(fmtTime(g.expires))}${g.checkedAt ? ` · kiểm tra ${esc(ago(g.checkedAt))}` : ''}</div>` : ''}
      ${g.error ? `<div class="ar err">${esc(g.error)}</div>` : ''}
      ${g.usage ? meter('5 giờ', g.usage.five_hour) + meter('Tuần', g.usage.week)
          + (g.usage.limitReached || !g.usage.allowed ? '<div class="ar err">Đã chạm giới hạn ChatGPT — job sẽ lỗi tới lúc reset.</div>' : '')
          + `<div class="ar">Mức dùng cập nhật ${esc(ago(g.usage.at))}</div>`
        : (g.email ? '<div class="ar">Chưa đọc được mức dùng — bấm Làm mới.</div>' : '')}
    </div>
    <div class="acct-card">
      <div class="ah"><b>Claude</b>${c.loggedIn ? `<span class="chip ok">${esc(planName(c.plan))}${c.org ? ` · ${esc(c.org)}` : ''}</span>` : `<span class="chip ${c.checkedAt ? 'bad' : ''}">${c.checkedAt ? 'Chưa đăng nhập' : 'Chưa có thông tin'}</span>`}</div>
      ${c.email ? `<div class="ar"><b>${esc(c.email)}</b></div>` : ''}
      ${u ? meter('5 giờ', u.five_hour) + meter('Tuần', u.seven_day) + (u.status && u.status !== 'allowed' ? `<div class="ar err">Đang bị giới hạn (${esc(u.status)}) — bước phân tích sẽ lỗi tới lúc reset.</div>` : '') : (c.loggedIn ? '<div class="ar">Chưa đọc được mức dùng.</div>' : '')}
      ${c.usageAt ? `<div class="ar">Mức dùng cập nhật ${esc(ago(c.usageAt))}</div>` : ''}
    </div>
    <div class="acct-stats">
      <div><b>${st.imagesToday ?? 0}</b>ảnh hôm nay · ${st.images7 ?? 0} / 7 ngày</div>
      <div><b>${st.jobsToday ?? 0}</b>job hôm nay · ${st.jobs7 ?? 0} / 7 ngày</div>
      <div><b>${st.analysesToday ?? 0}</b>lượt Claude phân tích hôm nay · ${st.analyses7 ?? 0} / 7 ngày</div>
    </div>
    <div class="row-btns"><button class="btn sm" id="btnAcctSwitch">Đổi tài khoản ChatGPT / Claude…</button></div>`;
  $('btnAcctRefresh').disabled = acctBusy;
  $('btnAcctRefresh').textContent = acctBusy ? '⏳ Đang kiểm tra…' : '⟳ Làm mới';
}
async function refreshAccount() {
  if (acctBusy) return;
  acctBusy = true;
  renderAccount(await window.api.account.get().catch(() => null));
  let a = null;
  try { a = await window.api.account.refresh(); } catch (e) { a = await window.api.account.get().catch(() => null); }
  acctBusy = false;
  renderAccount(a);
}
$('btnAcctRefresh').onclick = () => refreshAccount();
$('acctBox').addEventListener('click', (e) => {
  if (e.target.closest('#btnAcctSwitch')) { $('dlgSettings').close(); openSetup(); }
});
$('btnPickDir').onclick = async () => { const d = await window.api.pickDir(); if (d) $('setOut').value = d; };
$('btnSetCancel').onclick = () => $('dlgSettings').close();
$('btnSetSave').onclick = async () => {
  await window.api.setSettings({ outDirChosen: true, outDir: $('setOut').value, parallel: Number($('setParallel').value) });
  $('dlgSettings').close();
};
$('btnTheme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cr-theme', next); } catch {}
};

// ------------------------------- Cài đặt ban đầu (giống Design Template) -----
// 4 bước cho máy nhân viên: Chrome · đăng nhập ChatGPT · cài skill · thư mục lưu. Tự mở khi chưa đủ.
let SETUP = { st: null, busy: '', err: '' };
const setupReady = (st) => !!(st && st.chrome && st.loginOk && st.skillOk && st.claudeOk && st.outDirOk);

async function setupAct(label, fn) {
  SETUP.busy = label; SETUP.err = ''; renderSetup();
  try { const r = await fn(); if (r && typeof r === 'object' && 'chrome' in r) SETUP.st = r; }
  catch (e) { SETUP.err = String(e.message || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, ''); }
  SETUP.busy = ''; renderSetup(); applySetup();
}

function applySetup() {
  if (!SETUP.st) return;
  loggedIn = SETUP.st.loginOk ? true : (loggedIn === true ? false : loggedIn);
  setChip();
}

function renderSetup() {
  const d = $('dlgSetup'), st = SETUP.st;
  if (!d.open || !st) return;
  const busy = !!SETUP.busy;
  const dis = (cond) => (busy || cond ? 'disabled' : '');
  const step = (n, title, ok, body) => `<div class="setup-step ${ok ? 'done' : ''}"><div class="setup-n">${ok ? '✓' : n}</div><div class="setup-b"><b>${title}</b>${body}</div></div>`;
  d.innerHTML = `<div class="dlg">
    <div class="dlg-head col"><h3>Cài đặt ban đầu</h3><div class="hint">Làm 1 lần trên mỗi máy · 4 bước</div></div>
    <div class="dlg-body">
      ${step(1, 'Google Chrome', !!st.chrome, st.chrome
        ? `<span class="chip ok">Đã có Chrome</span><div class="p">${esc(st.chrome)}</div>`
        : `<p class="hint">App điều khiển ChatGPT qua Google Chrome. Cài Chrome rồi bấm "Dò lại".</p>
           <div class="btns"><button class="btn sm pri" data-s="chrome">Tải Chrome</button><button class="btn sm" data-s="refresh" ${dis()}>Dò lại</button></div>`)}
      ${step(2, 'Đăng nhập tài khoản ChatGPT của bạn', st.loginOk && st.skillOk, st.loginOk
        ? (st.skillOk
          ? `<span class="chip ok">Đã đăng nhập</span><div class="btns"><button class="btn sm" data-s="login" ${dis()}>Đăng nhập tài khoản khác</button></div>`
          : `<span class="chip warn">Đã đăng nhập · chưa chuẩn bị xong tài khoản</span><div class="btns"><button class="btn sm pri" data-s="skill" ${dis()}>Thử lại</button><button class="btn sm" data-s="login" ${dis()}>Đăng nhập tài khoản khác</button></div>`)
        : `<p class="hint">Bấm nút dưới: app mở cửa sổ Chrome riêng, đăng nhập tài khoản ChatGPT (work) của bạn. Đăng nhập xong cửa sổ tự đóng.</p>
           <div class="btns"><button class="btn sm pri" data-s="login" ${dis(!st.chrome)}>Đăng nhập ChatGPT</button></div>`)}
      ${step(3, 'Đăng nhập tài khoản Claude của bạn', st.claudeOk, st.claudeLoginUrl
        ? `<p class="hint">Trình duyệt đã mở trang đăng nhập Claude. Đăng nhập tài khoản Claude của bạn → bấm <b>Authorize</b> → trang hiện 1 <b>mã</b>: bấm Copy rồi dán vào ô dưới.</p>
           <div class="coderow"><input id="claudeCode" placeholder="Dán mã đăng nhập Claude vào đây" autocomplete="off"><button class="btn sm pri" data-s="claudeCode">Xác nhận</button></div>
           <div class="btns"><button class="btn sm" data-s="claudeOpen">Mở lại trang đăng nhập</button><button class="btn sm" data-s="claudeCancel">Huỷ</button></div>`
        : st.claudeOk
        ? `<span class="chip ok">Đã đăng nhập${st.claudeEmail ? ` · ${esc(st.claudeEmail)}` : ''}</span><div class="btns"><button class="btn sm" data-s="claudeLogin" ${dis()}>Đăng nhập tài khoản khác</button></div>`
        : st.claudeInstalled
          ? `<p class="hint">Dùng cho nút <b>Phân tích &amp; Scale</b>. Bấm nút dưới: trình duyệt mở trang đăng nhập Claude, đăng nhập tài khoản Claude của bạn rồi bấm <b>Authorize</b>, xong quay lại app.</p>
             <div class="btns"><button class="btn sm pri" data-s="claudeLogin" ${dis()}>Đăng nhập Claude</button><button class="btn sm" data-s="claudeCheck" ${dis()}>Kiểm tra lại</button></div>`
          : `<p class="hint">Dùng cho nút <b>Phân tích &amp; Scale</b>. Máy chưa có Claude — bấm nút dưới, app tự tải và cài (~1–3 phút, không cần quyền admin), rồi đăng nhập.</p>
             <div class="btns"><button class="btn sm pri" data-s="claudeInstall" ${dis()}>Cài Claude</button><button class="btn sm" data-s="claudeCheck" ${dis()}>Kiểm tra lại</button></div>`)}
      ${step(4, 'Chọn thư mục lưu kết quả', st.outDirOk, `<p class="hint">Mỗi job là 1 thư mục trong đây (design gốc + 5 mockup).</p>
        <div class="p">${esc(st.outDir)}</div>
        <div class="btns"><button class="btn sm" data-s="pick" ${dis()}>Chọn thư mục khác…</button>${st.outDirOk ? '' : `<button class="btn sm pri" data-s="usedir" ${dis()}>Dùng thư mục này</button>`}</div>`)}
      ${SETUP.busy ? `<p class="hint">⏳ ${esc(SETUP.busy)}</p>` : ''}
      ${SETUP.err ? `<p class="err">${esc(SETUP.err)}</p>` : ''}
    </div>
    <div class="dlg-foot">
      <button class="btn" data-s="check" ${dis(!st.chrome)} style="margin-right:auto">Kiểm tra lại tất cả</button>
      ${setupReady(st) ? '' : `<button class="btn" data-s="later" ${dis()}>Để sau</button>`}
      <button class="btn pri" data-s="done" ${dis(!setupReady(st))}>Bắt đầu dùng</button>
    </div></div>`;
}

$('dlgSetup').onclick = (e) => {
  const b = e.target.closest('[data-s]'); if (!b || b.disabled) return;
  const a = b.dataset.s, S = window.api.setup;
  if (a === 'chrome') S.getChrome();
  else if (a === 'refresh') setupAct('Đang dò…', () => S.status());
  else if (a === 'login') setupAct('Đang chờ bạn đăng nhập trong cửa sổ Chrome…', async () => {
    const r = await window.api.login();
    if (!r?.loggedIn) return S.status();
    SETUP.busy = 'Đã đăng nhập — đang chuẩn bị tài khoản (~30–60 giây)…'; renderSetup();
    return S.check();
  });
  else if (a === 'skill') setupAct('Đang chuẩn bị tài khoản (~30–60 giây)…', () => S.installSkill());
  else if (a === 'check') setupAct('Đang kiểm tra tài khoản (~15–60 giây)…', () => S.check());
  else if (a === 'claudeInstall') setupAct('Đang tải và cài Claude (~1–3 phút)…', async () => {
    const r = await S.claudeInstall();
    if (r.claudeOk) return r;
    SETUP.busy = 'Đã cài Claude — đang chờ bạn đăng nhập Claude trên trình duyệt…'; renderSetup();
    return S.claudeLogin();
  });
  else if (a === 'claudeLogin') setupAct('Đang chờ bạn đăng nhập Claude trên trình duyệt…', () => S.claudeLogin());
  else if (a === 'claudeCode') {
    const v = $('claudeCode')?.value.trim();
    if (!v) { $('claudeCode')?.focus(); return; }
    SETUP.busy = 'Đang xác nhận mã đăng nhập Claude…'; renderSetup();
    S.claudeCode(v);
  }
  else if (a === 'claudeOpen') S.claudeOpenLogin();
  else if (a === 'claudeCancel') S.claudeCancelLogin();
  else if (a === 'claudeCheck') setupAct('Đang kiểm tra…', () => S.claudeCheck());
  else if (a === 'pick') setupAct('', async () => { const d = await window.api.pickDir(); return d ? S.confirmOutDir(d) : S.status(); });
  else if (a === 'usedir') setupAct('', () => S.confirmOutDir());
  else if (a === 'later' || a === 'done') $('dlgSetup').close();
};
$('dlgSetup').addEventListener('cancel', (e) => { if (SETUP.busy) e.preventDefault(); });

async function openSetup() {
  SETUP.st = await window.api.setup.status();
  if (!$('dlgSetup').open) $('dlgSetup').showModal();
  renderSetup();
}
$('btnOpenSetup').onclick = () => { $('dlgSettings').close(); openSetup(); };
window.api.onSetup((st) => { SETUP.st = st; renderSetup(); applySetup(); });

// ------------------------------- Tự cập nhật ---------------------------------
function renderUpdate(st) {
  const box = $('updBox');
  box.hidden = !st;
  if (!st) return;
  if (st.state === 'downloading') box.innerHTML = `<span class="chip run">Đang tải bản mới v${esc(st.version)}…</span>`;
  else if (st.state === 'ready') box.innerHTML = `<button class="btn pri" id="btnUpdate" title="Tắt app, cài bản mới rồi mở lại (job đã xong không mất)">⟳ Khởi động lại & cập nhật v${esc(st.version)}</button>`;
  else if (st.state === 'available') box.innerHTML = `<a class="btn pri" href="${esc(st.url)}" target="_blank">⇩ Có bản mới v${esc(st.version)} — tải bộ cài</a>`;
}
$('updBox').onclick = async (e) => {
  if (!e.target.closest('#btnUpdate')) return;
  const r = await window.api.update.install();
  if (r && !r.ok) alert(r.error);
};
window.api.update.onStatus(renderUpdate);

(async () => {
  window.api.update.get().then(renderUpdate).catch(() => {});
  window.api.version().then((v) => { $('ver').textContent = `v${v}`; }).catch(() => {});
  await initCatalog();
  await initColors();
  resetForm();
  await window.api.watch(false); // luôn chạy ngầm (đã bỏ nút Xem Chrome)
  jobs = await window.api.getJobs();
  render();
  // Máy chưa đủ điều kiện -> mở Cài đặt ban đầu; đã có Chrome thì tự kiểm tra ngầm đăng nhập + skill.
  SETUP.st = await window.api.setup.status();
  applySetup();
  if (!setupReady(SETUP.st)) {
    await openSetup();
    if (SETUP.st.chrome && (!SETUP.st.loginOk || !SETUP.st.skillOk || !SETUP.st.claudeOk)) setupAct('Đang kiểm tra tài khoản (~15–60 giây)…', () => window.api.setup.check());
  }
})();
