// Phát hành bản mới bằng 1 lệnh: tăng version → kiểm tra → commit + tag + push code → build bộ cài →
// đăng lên GitHub Releases. Máy nhân viên mở app sẽ tự tải bản mới và báo "Khởi động lại & cập nhật".
//
//   npm run release            1.1.0 -> 1.1.1
//   npm run release -- minor   1.1.1 -> 1.2.0
//   npm run release -- major   1.2.0 -> 2.0.0
//   npm run release -- retry   giữ version, chỉ build + đăng lại (lần trước lỗi lúc build/đăng)
//
// Cần GitHub token (fine-grained) quyền "Contents: Read and write" trên 2 repo:
//   - code:    git remote origin (Mid-4/comfort-redesign, private)
//   - bản cài: package.json → build.publish (Mid-4/comfort-redesign-releases, public)
// Đặt trong biến môi trường GH_TOKEN hoặc dán vào file .gh-token ở thư mục này (đã gitignore).

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const run = (cmd, env) => execSync(cmd, { cwd: root, stdio: 'inherit', env: env ?? process.env });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
const fail = (msg) => { console.error(`\n✕ ${msg}\n`); process.exit(1); };
const pkg = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const arg = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major', 'retry'].includes(arg)) fail(`Tham số không hợp lệ: ${arg} (dùng patch | minor | major | retry)`);

const { owner, repo } = pkg().build.publish;
const tokenFile = path.join(root, '.gh-token');
const token = process.env.GH_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
if (!token) fail('Chưa có GitHub token. Tạo token rồi dán vào file .gh-token (xem README, mục "Phát hành bản mới").');

// Push bằng chính token phát hành (qua biến môi trường, không ghi vào git config) để login GitHub cũ
// lưu trong Windows Credential Manager không chen vào.
const tokenEnv = { ...process.env, GH_TOKEN: token };
const push = (refs) => run(`git -c credential.helper= -c "credential.helper=!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f" push -u origin ${refs}`, tokenEnv);

if (arg !== 'retry') {
  if (out('git status --porcelain')) fail('Còn thay đổi chưa commit. Commit (hoặc bỏ) trước rồi chạy lại.');
  run('npm run check');
  run(`npm version ${arg} --no-git-tag-version`);
  const { version } = pkg();
  run('git add package.json package-lock.json');
  run(`git commit -m "Release v${version}"`);
  run(`git tag v${version}`);
  push(`HEAD v${version}`);
}

const { version } = pkg();
console.log(`\n▶ Build + đăng v${version} lên GitHub Releases (${owner}/${repo})...\n`);
const env = { ...process.env, GH_TOKEN: token };
delete env.ELECTRON_RUN_AS_NODE; // biến này có sẵn trong terminal VSCode, làm hỏng electron-builder
run('npx electron-builder --win nsis --publish always', env);

// Dọn release/: chỉ giữ bộ cài của bản này (file gửi nhân viên) + win-unpacked.
const setup = pkg().build.nsis.artifactName.replace('${version}', version);
const outDir = path.join(root, 'release'), keep = new Set([setup, 'win-unpacked']);
for (const f of fs.readdirSync(outDir)) if (!keep.has(f)) fs.rmSync(path.join(outDir, f), { recursive: true, force: true });

console.log(`\n✓ Đã phát hành v${version}: https://github.com/${owner}/${repo}/releases/tag/v${version}`);
console.log(`  File gửi nhân viên (cài lần đầu): release\${setup}`);
console.log('  Máy đã cài: mở app sẽ tự tải bản mới, bấm "Khởi động lại & cập nhật" hoặc tắt app là xong.\n');
