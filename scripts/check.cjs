// Kiểm tra nhanh trước khi phát hành: cú pháp mọi file JS + danh sách sản phẩm khớp với skill + có file skill zip.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const fail = (m) => { console.error('✕ ' + m); process.exit(1); };

for (const dir of ['electron', 'renderer', 'scripts']) {
  for (const f of fs.readdirSync(path.join(root, dir)).filter((x) => /\.(c?js)$/.test(x))) {
    execSync(`node --check "${path.join(root, dir, f)}"`, { stdio: 'inherit' });
  }
}
const P = require(path.join(root, 'electron', 'prompts.cjs'));
const skill = fs.readFileSync(path.join(root, 'chatgpt-skill', 'comfort-redesign', 'SKILL.md'), 'utf8');
const missing = P.PRODUCTS.flatMap((g) => g.items).filter((p) => !skill.includes(`**${p.name}**`)).map((p) => p.name);
if (missing.length) fail('Sản phẩm có trong app nhưng thiếu trong SKILL.md: ' + missing.join(', '));
const zip = path.join(root, 'chatgpt-skill', 'comfort-redesign.zip');
if (!fs.existsSync(zip)) fail('Thiếu chatgpt-skill/comfort-redesign.zip');
if (fs.statSync(zip).mtimeMs + 1000 < fs.statSync(path.join(root, 'chatgpt-skill', 'comfort-redesign', 'SKILL.md')).mtimeMs) {
  fail('SKILL.md mới hơn file zip — chạy lại: cd chatgpt-skill && nén lại comfort-redesign.zip');
}
console.log('✓ check ok');
