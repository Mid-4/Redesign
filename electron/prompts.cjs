// prompts.cjs — tin nhắn ngắn gửi kèm skill (prompt đầy đủ nằm trong skill:
// chatgpt-skill/comfort-redesign/SKILL.md) + bảng màu Comfort Colors 1717.

const NUM_OPTIONS = 5;

// Màu Comfort Colors 1717 (hex xấp xỉ, chỉ để hiện ô màu trên app).
const COLORS = [
  ['Ivory', '#f1ead8'], ['White', '#f7f7f4'], ['Butter', '#f3e3a6'], ['Banana', '#f6e48e'],
  ['Mustard', '#d6a33d'], ['Citrus', '#f2a34a'], ['Yam', '#c9682e'], ['Terracotta', '#c87d62'],
  ['Watermelon', '#d9646a'], ['Crunchberry', '#d9577a'], ['Blossom', '#f2c6d0'], ['Peony', '#e7889e'],
  ['Orchid', '#c8a6c9'], ['Violet', '#8e7fb4'], ['Wine', '#6e2c38'], ['Brick', '#8a3b34'],
  ['Chili', '#9e2f2a'], ['Khaki', '#bfae8c'], ['Sandstone', '#c9b79a'], ['Espresso', '#4b3a31'],
  ['Moss', '#6f6f45'], ['Sage', '#a6ad8f'], ['Light Green', '#a9bf9c'], ['Chalky Mint', '#a8dcc8'],
  ['Seafoam', '#7fb8a9'], ['Island Reef', '#9fd9c6'], ['Blue Spruce', '#3f5c56'], ['Ice Blue', '#b9cbd3'],
  ['Chambray', '#bcd2e3'], ['Flo Blue', '#7d9bd1'], ['Washed Denim', '#7e9cb5'], ['Blue Jean', '#5f7389'],
  ['Denim', '#4b5e78'], ['True Navy', '#2f3a4f'], ['Midnight', '#2a3346'], ['Graphite', '#55565a'],
  ['Granite', '#8a8b8d'], ['Grey', '#9b9893'], ['Pepper', '#4a4a48'], ['Black', '#1f1f1f'],
];

// Sản phẩm (tên phải khớp mục PRODUCTS trong SKILL.md). wear = đồ mặc (có người mẫu), cc = áo Comfort Colors.
const PRODUCTS = [
  { group: 'Áo', items: [
    { name: 'T-Shirt 1 mặt', wear: true, cc: true }, { name: 'T-Shirt 2 mặt', wear: true, cc: true },
    { name: 'Sweatshirt 1 mặt', wear: true, cc: true }, { name: 'Sweatshirt 2 mặt', wear: true, cc: true },
    { name: 'Cardigan', wear: true }, { name: 'Ugly Sweater', wear: true }, { name: 'Hawaii Shirt', wear: true },
    { name: 'Baseball Jersey Shirt', wear: true }, { name: 'Football Jersey Shirt', wear: true },
  ] },
  { group: 'All-over print', items: [
    { name: 'AOP T-Shirt', wear: true }, { name: 'AOP Sweatshirt', wear: true }, { name: 'AOP Hoodie', wear: true },
  ] },
  { group: 'Đồ ngủ & mặc nhà', items: [
    { name: 'Satin Pajamas', wear: true }, { name: 'Raglan Pajamas', wear: true }, { name: 'Jumpsuit Pajamas', wear: true },
    { name: 'Hooded Blanket', wear: true }, { name: 'Hoodie Blanket', wear: true }, { name: 'Cozy Slipper', wear: true },
  ] },
  { group: 'Trang trí nhà', items: [
    { name: 'Mug' }, { name: 'Tapestry' }, { name: 'Woven Blanket' }, { name: 'Fleece Blanket' },
    { name: 'Garden Flag' }, { name: 'House Flag' }, { name: 'Doormat' },
  ] },
  { group: 'Ornament', items: [
    { name: 'Die Cut Acrylic Ornament' }, { name: 'Circle Glass Ornament' }, { name: 'Circle Ceramic Ornament' },
  ] },
];
const DEFAULT_PRODUCT = 'T-Shirt 2 mặt';
const findProduct = (name) => PRODUCTS.flatMap((g) => g.items).find((p) => p.name === name)
  || PRODUCTS[0].items.find((p) => p.name === DEFAULT_PRODUCT);

// Người mẫu cho đồ mặc: [giá trị gửi skill, nhãn trên app].
const MODELS = [['woman', 'Nữ'], ['man', 'Nam'], ['couple', 'Cặp đôi'], ['auto', 'AI chọn']];

/** Tin nhắn chạy skill: chỉ tham số, phần còn lại skill lo. */
function skillMessage({ product, model, color, note }) {
  const p = findProduct(product);
  return [
    `Create ${NUM_OPTIONS} options for the attached design.`,
    `Product: ${p.name}.`,
    p.wear ? `Model: ${model || 'woman'}.` : '',
    p.cc ? `Shirt color: ${color || 'choose per option'}.` : '',
    note ? `Note: ${note}` : '',
  ].filter(Boolean).join(' ');
}

function regenMessage(n, note) {
  return `Regenerate #${n}${note ? `. Note: ${note.replace(/\s+[—–]\s+/g, ', ').replace(/\s+/g, ' ').trim()}` : ''}`;
}

/**
 * Đọc các dòng "Tên — Màu áo — Tóm tắt" (hoặc "FAILED — lý do") trong trả lời của skill, theo thứ tự.
 * Danh sách đánh số của ChatGPT mất số khi lấy innerText nên không dựa vào số; số có sẵn thì bỏ đi.
 */
function parseLines(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().replace(/^\d+[.)]\s+/, '').match(/^(.+?)\s+[—–]\s+(.+)$/);
    if (!m) continue;
    const parts = [m[1], ...m[2].split(/\s+[—–]\s+/)].map((x) => x.trim());
    const failed = /^FAILED\b/i.test(parts[0]);
    if (!failed && parts.length < 2) continue;
    out.push({ name: parts[0], color: failed ? '' : parts[1], summary: parts.slice(failed ? 1 : 2).join(' — '), failed });
  }
  return out;
}

module.exports = { NUM_OPTIONS, COLORS, PRODUCTS, MODELS, DEFAULT_PRODUCT, findProduct, skillMessage, regenMessage, parseLines };
