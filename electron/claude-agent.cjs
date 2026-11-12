// claude-agent.cjs — bước "Phân tích & research" của job Scale chạy bằng Claude Code CLI (agent Claude)
// đăng nhập bằng tài khoản Claude của nhân viên (claude.ai, không dùng API key).
// Chỉ cho agent 3 công cụ: Read (xem ảnh design), WebSearch, WebFetch. Không đọc settings/MCP/plugin của máy.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const exists = (f) => { try { return !!f && fs.statSync(f).isFile(); } catch { return false; } };

/** Tìm claude.exe: bản cài chính thức (~/.local/bin), PATH, npm, extension VS Code / Cursor. */
function findClaude() {
  const cands = [path.join(HOME, '.local', 'bin', 'claude.exe')];
  for (const d of String(process.env.PATH || '').split(path.delimiter)) if (d) cands.push(path.join(d, 'claude.exe'));
  if (process.env.APPDATA) cands.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  for (const base of ['.vscode', '.cursor', '.windsurf'].map((x) => path.join(HOME, x, 'extensions'))) {
    let dirs = [];
    try { dirs = fs.readdirSync(base).filter((n) => /^anthropic\.claude-code-/.test(n)).sort().reverse(); } catch {}
    for (const d of dirs) cands.push(path.join(base, d, 'resources', 'native-binary', 'claude.exe'));
  }
  return cands.find(exists) || null;
}

const run = (exe, args, timeout = 30000) => new Promise((res) => {
  execFile(exe, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, out, errOut) => res({ err, out: String(out || ''), errOut: String(errOut || '') }));
});

/** { installed, loggedIn, email } */
async function status() {
  const exe = findClaude();
  if (!exe) return { installed: false, loggedIn: false };
  const r = await run(exe, ['auth', 'status', '--json']);
  try { const j = JSON.parse(r.out); return { installed: true, loggedIn: !!j.loggedIn, email: j.email || '' }; }
  catch { return { installed: true, loggedIn: false }; }
}

/** Cài Claude Code bằng bộ cài chính thức (vào ~/.local/bin, không cần quyền admin). */
function install(log = () => {}) {
  return new Promise((resolve, reject) => {
    log('Đang cài Claude (bộ cài chính thức)…');
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { windowsHide: true });
    let tail = '';
    const keep = (d) => { tail = (tail + d).slice(-2000); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    p.on('error', reject);
    p.on('close', () => {
      log('Cài Claude: ' + tail.replace(/\s+/g, ' ').slice(-300));
      findClaude() ? resolve() : reject(new Error('Chưa cài được Claude — kiểm tra mạng rồi thử lại.'));
    });
  });
}

/**
 * Đăng nhập Claude: CLI tự mở trình duyệt; chạy không có terminal nên Claude dùng kiểu "dán mã" —
 * đăng nhập xong trang web hiện 1 mã, nhân viên dán vào app -> submitCode() gửi vào CLI.
 * onPrompt({ url }) gọi khi CLI chờ mã. Chờ tối đa 15 phút.
 */
let loginProc = null;
function login(log = () => {}, onPrompt = () => {}) {
  const exe = findClaude();
  if (!exe) return Promise.reject(new Error('Máy chưa có Claude.'));
  if (loginProc) { try { loginProc.kill(); } catch {} }
  return new Promise((resolve) => {
    const p = spawn(exe, ['auth', 'login', '--claudeai'], { windowsHide: true });
    loginProc = p;
    let out = '', asked = false;
    const keep = (d) => {
      out = (out + d).slice(-4000);
      const url = /https:\/\/\S+oauth\S+/.exec(out)?.[0];
      if (!asked && url && /paste code/i.test(out)) { asked = true; onPrompt({ url }); }
    };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    const timer = setTimeout(() => p.kill(), 15 * 60 * 1000);
    const done = async () => {
      clearTimeout(timer); if (loginProc === p) loginProc = null;
      log('Đăng nhập Claude: ' + out.replace(/https:\/\/\S+/g, '<link>').replace(/\s+/g, ' ').slice(-300));
      resolve(await status());
    };
    p.on('close', done);
    p.on('error', done);
  });
}
/** Gửi mã nhân viên dán từ trang đăng nhập Claude vào CLI đang chờ. */
function submitCode(code) {
  if (!loginProc) return false;
  loginProc.stdin.write(String(code || '').trim() + '\n');
  return true;
}
function cancelLogin() { if (loginProc) { try { loginProc.kill(); } catch {} loginProc = null; } }

const SCHEMA = {
  type: 'object',
  required: ['report_md', 'designs'],
  properties: {
    report_md: { type: 'string' },
    designs: {
      type: 'array', minItems: 5, maxItems: 5,
      items: {
        type: 'object', required: ['name', 'shirt_color', 'summary_vi', 'brief'],
        properties: { name: { type: 'string' }, shirt_color: { type: 'string' }, summary_vi: { type: 'string' }, brief: { type: 'string' } },
      },
    },
  },
};

const procs = new Map(); // key -> child process (để huỷ)

/**
 * Phân tích design + research thị trường + lên 5 mẫu scale.
 * -> { report: markdown tiếng Việt, designs: [{ name, shirt_color, summary_vi, brief }] }
 */
function analyze({ key, designFile, prompt, workDir, tools = 'Read,WebSearch,WebFetch', timeoutMs = 25 * 60 * 1000 }, log = () => {}) {
  const exe = findClaude();
  if (!exe) return Promise.reject(new Error('Máy chưa có Claude — mở Cài đặt ban đầu để cài và đăng nhập.'));
  fs.mkdirSync(workDir, { recursive: true });
  const img = path.join(workDir, 'design' + path.extname(designFile));
  fs.copyFileSync(designFile, img);
  const args = [
    '-p', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA),
    '--tools', tools, '--allowedTools', tools,
    '--permission-mode', 'dontAsk', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence',
  ];
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { cwd: workDir, windowsHide: true });
    procs.set(key, p);
    let out = '', errOut = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { errOut = (errOut + d).slice(-4000); });
    const timer = setTimeout(() => { p.kill(); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); procs.delete(key); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer); procs.delete(key);
      if (p.cancelled) return reject(new Error('Đã huỷ.'));
      let j;
      try { j = JSON.parse(out.trim().split('\n').filter(Boolean).pop()); } catch {}
      if (!j) return reject(new Error(`Claude không trả kết quả (mã ${code}). ${errOut.slice(-300)}`));
      if (j.is_error) {
        const msg = String(j.result || j.subtype || '');
        if (/log ?in|auth|credential|401|403/i.test(msg)) return reject(new Error('Claude chưa đăng nhập / hết hạn — mở Cài đặt ban đầu để đăng nhập Claude.'));
        if (/limit|quota|usage/i.test(msg)) return reject(new Error('Tài khoản Claude đã hết lượt dùng — thử lại sau.'));
        return reject(new Error('Claude lỗi: ' + msg.slice(0, 300)));
      }
      let data = j.structured_output;
      if (!data) { try { data = JSON.parse(String(j.result).replace(/^```(json)?|```$/g, '').trim()); } catch {} }
      if (!data?.designs?.length) return reject(new Error('Claude trả kết quả sai định dạng.'));
      log(`Claude phân tích xong (${Math.round((j.duration_ms || 0) / 1000)}s, ${j.usage?.server_tool_use?.web_search_requests || 0} lượt tìm web).`);
      resolve({ report: String(data.report_md || '').trim(), designs: data.designs.slice(0, 5) });
    });
    p.stdin.end(prompt.replace('{{DESIGN}}', path.basename(img)));
  });
}

function cancel(key) { const p = procs.get(key); if (p) { p.cancelled = true; p.kill(); } }

module.exports = { findClaude, status, install, login, submitCode, cancelLogin, analyze, cancel };
