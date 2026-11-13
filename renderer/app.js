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
  design = null; images = [];
  $('imgNote').value = ''; renderThumbs();
  $('preview').hidden = true; $('preview').removeAttribute('src'); $('dropText').hidden = false;
  $('inFile').value = '';
  $('selProduct').value = defaultProduct;
  $('selModel').value = 'woman';
  $('selColor').value = '';
  $('note').value = '';
  $('designCode').value = '';
  syncProduct(); paintColor();
}

// Nhiều ảnh: ảnh đầu = design chính (design), các ảnh sau = ảnh tham khảo. Tối đa 6.
const MAX_IMAGES = 6;
let images = []; // [{ base64, mimeType, fileName, url }]
function renderThumbs() {
  design = images[0] || null;
  $('thumbs').hidden = !images.length; $('fieldImgNote').hidden = !images.length;
  $('drop').classList.toggle('has', !!images.length);
  $('dropText').querySelector('b').textContent = images.length ? `+ Thêm ảnh (${images.length}/${MAX_IMAGES})` : 'Kéo-thả design vào đây';
  $('thumbs').innerHTML = images.map((im, i) => `<div class="thumb ${i === 0 ? 'main' : ''}" data-ti="${i}" title="${i === 0 ? 'Design chính' : 'Bấm để đặt làm design chính'}">
      <img src="${im.url}" alt=""><span class="tn">${i === 0 ? 'Chính' : i + 1}</span><button class="tx" data-tx="${i}" title="Bỏ ảnh">×</button></div>`).join('');
  refreshButtons();
}
$('thumbs').onclick = (e) => {
  const x = e.target.closest('[data-tx]');
  if (x) { images.splice(Number(x.dataset.tx), 1); renderThumbs(); return; }
  const t = e.target.closest('[data-ti]');
  if (t && Number(t.dataset.ti) > 0) { const [im] = images.splice(Number(t.dataset.ti), 1); images.unshift(im); renderThumbs(); }
};
function loadFiles(files) {
  for (const f of [...(files || [])]) loadFile(f);
}
function loadFile(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) { $('err').textContent = 'Chỉ nhận ảnh png, jpg, webp.'; return; }
  if (images.length >= MAX_IMAGES) { $('err').textContent = `Tối đa ${MAX_IMAGES} ảnh.`; return; }
  const fr = new FileReader();
  fr.onload = () => {
    if (images.length >= MAX_IMAGES) return;
    const url = String(fr.result);
    images.push({ base64: url.split(',')[1], mimeType: file.type, fileName: file.name || 'design.png', url });
    // Ảnh đầu tiên: chưa nhập mã -> gợi ý theo tên file (ảnh dán clipboard tên chung chung thì bỏ qua), sửa lại được.
    const stem = (file.name || '').replace(/\.[^.]+$/, '');
    if (images.length === 1 && !$('designCode').value.trim() && stem && !/^(image|design|paste|clipboard|untitled)\b/i.test(stem)) $('designCode').value = stem.slice(0, 60);
    $('err').textContent = '';
    renderThumbs();
  };
  fr.readAsDataURL(file);
}

const drop = $('drop');
$('inFile').onchange = (e) => { loadFiles(e.target.files); e.target.value = ''; };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); loadFiles(e.dataTransfer.files); };
document.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  for (const item of [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/'))) loadFile(item.getAsFile());
});

// ------------------------------- Màu áo -------------------------------------
// Sản phẩm + người mẫu: người mẫu chỉ hiện với đồ mặc, màu Comfort Colors chỉ hiện với T-Shirt/Sweatshirt.
let products = [];
let defaultProduct = '';
let paintColor = () => {};
let syncProduct = () => {};
const product = () => products.find((p) => p.name === $('selProduct').value) || products[0];
async function initCatalog() {
  const keep = $('selProduct').value;
  const c = await window.api.catalog();
  products = c.products.flatMap((g) => g.items);
  $('selProduct').innerHTML = c.products.map((g) => `<optgroup label="${esc(g.group)}">${g.items.map((p) => `<option>${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  $('selModel').innerHTML = c.models.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  defaultProduct = c.defaultProduct;
  const sync = () => { const p = product(); $('fieldModel').hidden = !p.wear; $('fieldColor').hidden = !p.cc; };
  syncProduct = sync;
  $('selProduct').onchange = sync;
  if (keep && products.some((p) => p.name === keep)) { $('selProduct').value = keep; sync(); }
}

// ------------------------------- Sản phẩm tự thêm -------------------------------
let editingProduct = null; // tên sản phẩm đang sửa (null = thêm mới)
async function renderProducts() {
  const list = await window.api.products.list();
  $('prodList').innerHTML = list.length
    ? list.map((p) => `<div class="prod-item"><div class="pi"><b>${esc(p.name)}</b><span>${[p.wear ? 'Có người mẫu' : 'Không người mẫu', p.cc ? 'Comfort Colors' : ''].filter(Boolean).join(' · ')}</span></div>
        <button class="btn sm" data-pedit="${esc(p.name)}">Sửa</button><button class="btn sm danger" data-pdel="${esc(p.name)}">Xoá</button></div>`).join('')
    : '<p class="hint">Chưa có sản phẩm tự thêm.</p>';
  return list;
}
function productForm(p) {
  editingProduct = p ? p.name : null;
  $('prName').value = p?.name || ''; $('prWear').checked = !!p?.wear; $('prCc').checked = !!p?.cc;
  $('pfTitle').textContent = p ? `Sửa: ${p.name}` : 'Thêm sản phẩm mới';
  $('btnPrSave').textContent = p ? 'Lưu thay đổi' : 'Thêm sản phẩm';
  $('btnPrNew').hidden = !p; $('prErr').textContent = '';
}
async function openProducts() { productForm(null); await renderProducts(); $('dlgProducts').showModal(); $('prName').focus(); }
$('btnProducts').onclick = () => openProducts();
$('btnOpenProducts').onclick = () => { $('dlgSettings').close(); openProducts(); };
$('btnPrClose').onclick = () => $('dlgProducts').close();
$('btnPrNew').onclick = () => productForm(null);
$('prCc').onchange = () => { if ($('prCc').checked) $('prWear').checked = true; };
$('btnPrSave').onclick = async () => {
  $('prErr').textContent = '';
  const item = { name: $('prName').value, wear: $('prWear').checked, cc: $('prCc').checked };
  try {
    await window.api.products.save(item, editingProduct);
    const name = item.name.replace(/\s+/g, ' ').trim();
    productForm(null); await renderProducts(); await initCatalog();
    $('selProduct').value = name; syncProduct(); // chọn luôn sản phẩm vừa thêm
  } catch (e) { $('prErr').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, ''); }
};
$('prodList').onclick = async (e) => {
  const ed = e.target.closest('[data-pedit]'), del = e.target.closest('[data-pdel]');
  const list = await window.api.products.list();
  if (ed) productForm(list.find((p) => p.name === ed.dataset.pedit));
  if (del && confirm(`Xoá sản phẩm "${del.dataset.pdel}"? (job cũ không bị ảnh hưởng)`)) {
    await window.api.products.remove(del.dataset.pdel);
    if (editingProduct === del.dataset.pdel) productForm(null);
    await renderProducts(); await initCatalog();
  }
};

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
    const { url, ...main } = design;
    await window.api.start({ ...main, refs: images.slice(1).map(({ url: _u, ...r }) => r), imgNote: $('imgNote').value.trim(), mode, designCode: $('designCode').value.trim(), product: p.name, model: p.wear ? $('selModel').value : '', color: p.cc ? $('selColor').value : '', note: $('note').value.trim() });
    resetForm(); // như Design Template: tạo job xong thì form trống để tạo job mới hoàn toàn
    render();
  } catch (e) { $('err').textContent = e.message || String(e); }
}
// Cả 2 luồng đều bắt đầu bằng bước Claude phân tích -> cần đăng nhập Claude.
// ------------------------------- Tạo ảnh bằng ChatGPT hay Gemini -------------------------------
const engine = () => (SETUP.st?.engine === 'gemini' ? 'gemini' : 'chatgpt');
function renderEngine() {
  for (const b of document.querySelectorAll('#engineSeg [data-engine]')) b.classList.toggle('on', b.dataset.engine === engine());
}
async function setEngine(e) {
  const v = await window.api.setEngine(e);
  if (SETUP.st) SETUP.st.engine = v;
  renderEngine();
  if (v === 'gemini' && !SETUP.st?.geminiOk) {
    $('err').textContent = 'Gemini chưa đăng nhập — mở ⚙ Cài đặt → Tài khoản & mức dùng → Gemini → Đăng nhập.';
  } else $('err').textContent = '';
}
$('engineSeg').onclick = (e) => { const b = e.target.closest('[data-engine]'); if (b) setEngine(b.dataset.engine); };

async function startWithClaude(mode) {
  if (engine() === 'gemini' && SETUP.st && !SETUP.st.geminiOk) {
    $('err').textContent = 'Gemini chưa đăng nhập — mở ⚙ Cài đặt → Tài khoản & mức dùng → Gemini → Đăng nhập (hoặc chuyển sang ChatGPT).';
    return;
  }
  if (SETUP.st && !SETUP.st.claudeOk) {
    await openSetup();
    SETUP.err = 'Cần kết nối tài khoản phân tích (bước 3) — làm xong rồi bấm lại.'; renderSetup();
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
  if (j.running) return ((j.step === 'analyze' && j.mode !== 'scale' ? 'Đang phân tích design' : STEP_TEXT[j.step]) || 'Đang chạy') + '…';
  return `Hoàn tất ${done}/${j.options.length} mẫu.`;
}

function renderAnalysis(j) {
  $('anImg').src = j.designUrl;
  const modelLabel = { woman: 'Nữ', man: 'Nam', couple: 'Cặp đôi', auto: 'AI chọn' }[j.model] || '';
  const p = products.find((x) => x.name === j.product);
  $('anBody').innerHTML = `
    <p class="an-row"><b>Loại job:</b>${j.mode === 'scale' ? 'Phân tích &amp; Scale' : 'Redesign 5 hướng'} · <b>Tạo ảnh bằng:</b>${j.engine === 'gemini' ? 'Gemini' : 'ChatGPT'}</p>
    <p class="an-row"><b>Sản phẩm:</b>${esc(j.product || '')}${modelLabel ? ` · <b>Người mẫu:</b>${esc(modelLabel)}` : ''}</p>
    ${p?.cc ? `<p class="an-row"><b>Màu áo:</b>${esc(j.color || 'AI tự chọn theo từng hướng')}</p>` : ''}
    ${j.note ? `<p class="an-row"><b>Ghi chú:</b>${esc(j.note)}</p>` : ''}
    ${j.refUrls?.length ? `<div class="an-row"><b>Ảnh tham khảo:</b><div class="refs">${j.refUrls.map((u) => `<img src="${esc(u)}" alt="" data-big="${esc(u)}">`).join('')}</div></div>` : ''}
    ${j.imgNote ? `<p class="an-row"><b>Mô tả ảnh:</b>${esc(j.imgNote)}</p>` : ''}
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
  const title = scale ? '📊 Báo cáo research thị trường' : '🔍 Phân tích design';
  const html = j.report
    ? `<h4>${title}</h4>${mdToHtml(j.report)}`
    : `<p class="hint">${waiting ? (scale ? '📊 Đang phân tích & research — báo cáo + 5 hướng scale sẽ hiện ở đây khi xong.' : '🔍 Đang phân tích design — kết quả + 5 hướng redesign sẽ hiện ở đây khi xong.') : '📊 Chưa có báo cáo.'}</p>`;
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}

// Mô tả tạo lại đang gõ, theo job + mẫu (giữ nguyên khi trang tự làm mới).
const regenNotes = {};
const noteKey = (i) => `${job.id}:${i}`;

// Nhãn rủi ro TM/IP (bước phân tích chấm cho từng hướng): Thấp / Trung bình / Cao + lý do.
const RISK = { low: ['Rủi ro IP: Thấp', 'ok'], medium: ['Rủi ro IP: Trung bình', 'warn'], high: ['Rủi ro IP: Cao', 'bad'] };
const riskBadge = (level, reason) => (RISK[level]
  ? `<div class="risk ${RISK[level][1]}" title="${esc(reason || '')}">🛡️ ${RISK[level][0]}${reason ? ` — ${esc(reason)}` : ''}</div>` : '');

function renderOption(o, i) {
  let [label, cls] = STATUS[o.status] || STATUS.wait;
  if (o.regen === 'run') [label, cls] = ['Đang tạo lại…', 'chip run'];
  else if (o.regen === 'wait') [label, cls] = ['Chờ tạo lại', 'chip warn'];
  const regenning = !!o.regen;
  const shot = o.url
    ? `<img src="${esc(o.url)}" alt="" data-big="${esc(o.url)}">${regenning ? `<div class="regen-over">${o.regen === 'run' ? 'Đang tạo lại…' : 'Chờ tạo lại…'}</div>` : ''}`
    : `<div class="msg">${o.status === 'run' ? 'Đang làm…' : o.status === 'wait' ? 'Đang xếp hàng…' : 'Chưa có ảnh'}</div>`;
  const canRegen = !regenning && o.status !== 'run' && !job.running && (!!job.convUrl || !!job.designs?.length);
  return `<div class="card opt">
    <div class="top"><b title="${esc(o.name)}">${i + 1} · ${esc(o.name)}</b><span class="${cls}">${label}</span></div>
    <div class="shot ${o.status === 'run' || regenning ? 'run' : ''} ${regenning && o.url ? 'dim' : ''}">${shot}</div>
    <div class="meta"><i class="sw" style="${swatch(o.shirt_color)}"></i>${esc(o.shirt_color || '—')}${o.summary ? ` · ${esc(o.summary)}` : ''}</div>
    ${riskBadge(o.ipRisk, o.ipReason)}
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
    text = (j.step === 'analyze' && j.mode !== 'scale' ? 'Đang phân tích design' : STEP_TEXT[j.step]) || 'Đang chạy';
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
      <div style="min-width:0"><div class="s">${esc(j.code || '')}${j.mode === 'scale' ? ' <span class="tag scale">Scale</span>' : ''}${j.engine === 'gemini' ? ' <span class="tag gem">Gemini</span>' : ''}</div><div class="t" title="${esc(j.name)}">${esc(j.designCode || j.name)}</div><div class="s">${esc(sub)}</div></div></div>
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
      ${riskBadge(d.ip_risk, d.ip_reason)}
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
  renderTiles();
  const active = jobs.filter((j) => j.running || j.stage === 'queued').length;
  $('navBadge').hidden = !active; $('navBadge').textContent = active;
  // có thêm ảnh xong -> cập nhật biểu đồ + thống kê
  const done = jobs.reduce((n, j) => n + j.options.filter((o) => o.status === 'done').length, 0);
  if (done !== lastDone) { lastDone = done; loadDash(); }
}

// ------------------------------- Bảng điều khiển (ô số liệu + biểu đồ) -----------
let dash = null, lastDone = -1, dashTimer = null;
function loadDash() {
  clearTimeout(dashTimer);
  dashTimer = setTimeout(async () => { dash = await window.api.account.get().catch(() => dash); renderTiles(); renderChart(); renderAvatar(); }, 400);
}
setInterval(loadDash, 60000);
function tile(label, value, sub, bar, tip = '') {
  const cls = bar == null ? '' : bar >= 90 ? 'bad' : bar >= 70 ? 'warn' : '';
  return `<div class="tile" title="${esc(tip)}"><div class="tl">${label}</div><div class="tv">${value}</div>
    ${bar == null ? '' : `<div class="tbar"><b class="${cls}" style="width:${Math.min(100, bar)}%"></b></div>`}
    <div class="ts">${sub}</div></div>`;
}
function renderTiles() {
  const run = jobs.filter((j) => j.running).length, wait = jobs.filter((j) => j.stage === 'queued').length;
  const pick = jobs.filter((j) => j.stage === 'review').length;
  const st = dash?.stats || {}, g = dash?.chatgpt?.usage, c = dash?.claude?.usage;
  const left = (w) => (w ? Math.max(0, 100 - w.used) : null);
  const usageTile = (name, u) => (u?.five_hour
    ? tile(`${name} · 5 giờ`, `${left(u.five_hour)}%<small>còn</small>`, `Tuần còn ${left(u.week || u.seven_day) ?? '—'}%`, u.five_hour.used, `5 giờ reset ${fmtTime(u.five_hour.resetsAt)}`)
    : tile(`${name} · mức dùng`, '—', 'Mở Tài khoản &amp; mức dùng để cập nhật'));
  $('tiles').innerHTML = [
    tile('Job đang chạy', `${run}<small>/ ${wait} chờ</small>`, pick ? `${pick} job chờ chọn hướng` : `${jobs.length} job trong danh sách`),
    tile('Ảnh tạo hôm nay', `${st.imagesToday ?? 0}`, `7 ngày: ${st.images7 ?? 0} ảnh`),
    usageTile('ChatGPT', g),
    tile('Job hôm nay', `${st.jobsToday ?? 0}`, `7 ngày: ${st.jobs7 ?? 0} job`),
  ].join('');
}
function renderChart() {
  const days = dash?.stats?.days || [];
  const max = Math.max(1, ...days.map((d) => d.images));
  const last = days.length - 1;
  $('bars').innerHTML = days.map((d, k) => `<div class="bc ${k === last ? 'today' : ''}" title="${esc(d.d)}: ${d.images} ảnh · ${d.jobs} job">
      <span class="bv">${d.images || ''}</span><i class="bb" style="height:${Math.round((d.images / max) * 118)}px"></i></div>`).join('')
    + '';
  let x = $('barsX');
  if (!x) { x = document.createElement('div'); x.id = 'barsX'; x.className = 'bars-x'; $('bars').after(x); }
  x.innerHTML = days.map((d, k) => `<span class="${k === last ? 'today' : ''}">${k === last ? 'Hôm nay' : esc(d.d)}</span>`).join('');
  $('chartSum').textContent = `${dash?.stats?.images7 ?? 0} ảnh · ${dash?.stats?.jobs7 ?? 0} job`;
}
// Hồ sơ: tên hiển thị + ảnh đại diện (người dùng tự đặt); chưa đặt thì lấy chữ cái đầu tên / email.
let prof = { name: '', avatarUrl: '' };
const userEmail = () => dash?.chatgpt?.email || ''; // chỉ email ChatGPT (không hiện tài khoản phân tích)
const initial = () => ((prof.name || userEmail() || '?').trim()[0] || '?').toUpperCase();
const avatarHtml = () => (prof.avatarUrl ? `<img src="${esc(prof.avatarUrl)}" alt="">` : esc(initial()));
function renderAvatar() {
  $('avatar').innerHTML = avatarHtml();
  $('userName').textContent = prof.name || '';
  $('userName').hidden = !prof.name;
  $('avatar').title = [prof.name, userEmail()].filter(Boolean).join(' · ') || 'Hồ sơ';
}
window.api.profile.get().then((p) => { prof = p; renderAvatar(); }).catch(() => {});

function renderProfileDlg() {
  $('pfAvatar').innerHTML = prof.avatarUrl ? `<img src="${esc(prof.avatarUrl)}" alt="">` : esc((($('pfName').value || userEmail() || '?').trim()[0] || '?').toUpperCase());
  $('btnPfClear').disabled = !prof.avatarUrl;
  $('pfEmail').textContent = userEmail() ? `Tài khoản: ${userEmail()}` : '';
}
function openProfile() {
  $('pfName').value = prof.name; $('pfErr').textContent = '';
  renderProfileDlg();
  $('dlgProfile').showModal();
  $('pfName').focus();
}
$('pfName').oninput = () => { if (!prof.avatarUrl) renderProfileDlg(); };
$('btnPfPick').onclick = async () => {
  $('pfErr').textContent = '';
  try { prof = await window.api.profile.pickAvatar(); } catch (e) { $('pfErr').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, ''); }
  renderProfileDlg(); renderAvatar();
};
$('btnPfClear').onclick = async () => { prof = await window.api.profile.clearAvatar(); renderProfileDlg(); renderAvatar(); };
$('btnPfSave').onclick = async () => { prof = await window.api.profile.setName($('pfName').value); renderAvatar(); $('dlgProfile').close(); };
$('btnPfCancel').onclick = () => $('dlgProfile').close();
$('btnPfAccount').onclick = () => { $('dlgProfile').close(); $('btnSettings').click(); };

// Menu bên trái: đổi màn (Bảng điều khiển / Hàng đợi) hoặc mở hộp thoại.
const VIEW_TITLE = { dash: 'Bảng điều khiển', queue: 'Hàng đợi job' };
$('nav').onclick = (e) => {
  const b = e.target.closest('.nav-i'); if (!b) return;
  if (b.dataset.view) {
    $('board').dataset.view = b.dataset.view;
    $('pageTitle').textContent = VIEW_TITLE[b.dataset.view];
    for (const x of document.querySelectorAll('.nav-i[data-view]')) x.classList.toggle('on', x === b);
  } else if (b.dataset.nav === 'account') $('btnSettings').click();
  else if (b.dataset.nav === 'setup') openSetup();
};
$('avatar').onclick = () => openProfile();

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
$('anBody').addEventListener('click', (e) => { const t = e.target.closest('[data-big]'); if (t) { $('bigImg').src = t.dataset.big; $('dlgImg').showModal(); } });
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
  const st0 = SETUP.st || {}, eng = engine();
  const useBtn = (id) => (eng === id ? '<span class="chip ok">Đang dùng</span>' : `<button class="btn sm pri" data-use="${id}">Dùng</button>`);
  $('acctBox').innerHTML = `
    <div class="acct-card ${eng === 'chatgpt' ? 'using' : ''}">
      <div class="ah"><b>ChatGPT</b>${useBtn('chatgpt')}</div>
      <div class="ah"><span></span>${g.email ? `<span class="chip ok">${esc(planName(g.plan))}${g.structure === 'workspace' ? ' · workspace' : ''}</span>` : '<span class="chip">Chưa có thông tin</span>'}</div>
      ${g.email ? `<div class="ar"><b>${esc(g.email)}</b>${g.name ? ` · ${esc(g.name)}` : ''}</div>
      <div class="ar">Phiên đăng nhập hết hạn: ${esc(fmtTime(g.expires))}${g.checkedAt ? ` · kiểm tra ${esc(ago(g.checkedAt))}` : ''}</div>` : ''}
      ${g.error ? `<div class="ar err">${esc(g.error)}</div>` : ''}
      ${g.usage ? meter('5 giờ', g.usage.five_hour) + meter('Tuần', g.usage.week)
          + (g.usage.limitReached || !g.usage.allowed ? '<div class="ar err">Đã chạm giới hạn ChatGPT — job sẽ lỗi tới lúc reset.</div>' : '')
          + `<div class="ar">Mức dùng cập nhật ${esc(ago(g.usage.at))}</div>`
        : (g.email ? '<div class="ar">Chưa đọc được mức dùng — bấm Làm mới.</div>' : '')}
    </div>
    <div class="acct-card ${eng === 'gemini' ? 'using' : ''}">
      <div class="ah"><b>Gemini</b>${useBtn('gemini')}</div>
      ${st0.geminiOk ? `<div class="ar"><b>${esc(st0.geminiEmail || 'Đã đăng nhập')}</b></div>` : '<div class="ar">Chưa đăng nhập tài khoản Google (gemini.google.com).</div>'}
      <div class="ar">Tạo mockup bằng Gemini web (Nano Banana) — mỗi mẫu 1 lượt, chạy lần lượt.</div>
      <div class="row-btns"><button class="btn sm" data-gem="login">${st0.geminiOk ? 'Đăng nhập tài khoản khác' : 'Đăng nhập Gemini'}</button>${st0.geminiOk ? '<button class="btn sm" data-gem="check">Kiểm tra</button>' : ''}</div>
      <div class="ar" id="gemMsg"></div>
    </div>
    <div class="acct-stats">
      <div><b>${st.imagesToday ?? 0}</b>ảnh hôm nay · ${st.images7 ?? 0} / 7 ngày</div>
      <div><b>${st.jobsToday ?? 0}</b>job hôm nay · ${st.jobs7 ?? 0} / 7 ngày</div>
      <div><b>${st.analysesToday ?? 0}</b>lượt phân tích hôm nay · ${st.analyses7 ?? 0} / 7 ngày</div>
    </div>
    <div class="row-btns"><button class="btn sm" id="btnAcctSwitch">Đổi tài khoản ChatGPT…</button></div>`;
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
$('acctBox').addEventListener('click', async (e) => {
  if (e.target.closest('#btnAcctSwitch')) { $('dlgSettings').close(); openSetup(); }
  const u = e.target.closest('[data-use]');
  if (u) { await setEngine(u.dataset.use); renderAccount(await window.api.account.get().catch(() => null)); }
  const g = e.target.closest('[data-gem]');
  if (g) {
    g.disabled = true;
    $('gemMsg').textContent = g.dataset.gem === 'login' ? '⏳ Cửa sổ Chrome đã mở — đăng nhập tài khoản Google, xong cửa sổ tự đóng…' : '⏳ Đang kiểm tra…';
    const r = await (g.dataset.gem === 'login' ? window.api.gemini.login() : window.api.gemini.check()).catch(() => ({ ok: false }));
    SETUP.st = await window.api.setup.status();
    renderAccount(await window.api.account.get().catch(() => null));
    $('gemMsg').textContent = r.ok ? '✅ Gemini đã đăng nhập.' : '❌ Chưa đăng nhập được Gemini.';
  }
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
      ${step(3, 'Kết nối tài khoản phân tích', st.claudeOk, st.claudeLoginUrl
        ? `<p class="hint">Trình duyệt đã mở trang đăng nhập. Đăng nhập tài khoản được cấp → bấm <b>Authorize</b> → trang hiện 1 <b>mã</b>: bấm Copy rồi dán vào ô dưới.</p>
           <div class="coderow"><input id="claudeCode" placeholder="Dán mã đăng nhập vào đây" autocomplete="off"><button class="btn sm pri" data-s="claudeCode">Xác nhận</button></div>
           <div class="btns"><button class="btn sm" data-s="claudeOpen">Mở lại trang đăng nhập</button><button class="btn sm" data-s="claudeCancel">Huỷ</button></div>`
        : st.claudeOk
        ? `<span class="chip ok">Đã kết nối</span><div class="btns"><button class="btn sm" data-s="claudeLogin" ${dis()}>Đăng nhập tài khoản khác</button></div>`
        : st.claudeInstalled
          ? `<p class="hint">Dùng cho nút <b>Phân tích &amp; Scale</b>. Bấm nút dưới: trình duyệt mở trang đăng nhập, đăng nhập tài khoản được cấp rồi bấm <b>Authorize</b>, xong quay lại app.</p>
             <div class="btns"><button class="btn sm pri" data-s="claudeLogin" ${dis()}>Đăng nhập</button><button class="btn sm" data-s="claudeCheck" ${dis()}>Kiểm tra lại</button></div>`
          : `<p class="hint">Dùng cho nút <b>Phân tích &amp; Scale</b>. Máy chưa có công cụ phân tích — bấm nút dưới, app tự tải và cài (~1–3 phút, không cần quyền admin), rồi đăng nhập.</p>
             <div class="btns"><button class="btn sm pri" data-s="claudeInstall" ${dis()}>Cài công cụ phân tích</button><button class="btn sm" data-s="claudeCheck" ${dis()}>Kiểm tra lại</button></div>`)}
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
  else if (a === 'claudeInstall') setupAct('Đang tải và cài công cụ phân tích (~1–3 phút)…', async () => {
    const r = await S.claudeInstall();
    if (r.claudeOk) return r;
    SETUP.busy = 'Đã cài — đang chờ bạn đăng nhập trên trình duyệt…'; renderSetup();
    return S.claudeLogin();
  });
  else if (a === 'claudeLogin') setupAct('Đang chờ bạn đăng nhập trên trình duyệt…', () => S.claudeLogin());
  else if (a === 'claudeCode') {
    const v = $('claudeCode')?.value.trim();
    if (!v) { $('claudeCode')?.focus(); return; }
    SETUP.busy = 'Đang xác nhận mã đăng nhập…'; renderSetup();
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
window.api.onSetup((st) => { SETUP.st = st; renderSetup(); applySetup(); renderEngine(); });

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
  applySetup(); renderEngine();
  if (!setupReady(SETUP.st)) {
    await openSetup();
    if (SETUP.st.chrome && (!SETUP.st.loginOk || !SETUP.st.skillOk || !SETUP.st.claudeOk)) setupAct('Đang kiểm tra tài khoản (~15–60 giây)…', () => window.api.setup.check());
  }
})();
