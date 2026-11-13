// prompts.cjs — tin nhắn ngắn gửi kèm skill (prompt đầy đủ nằm trong skill:
// chatgpt-skill/comfort-redesign/SKILL.md) + bảng màu Comfort Colors 1717.

const NUM_OPTIONS = 5;
const SCALE_OPTIONS = 5; // job Phân tích & Scale: Claude phân tích + research, ChatGPT tạo 5 mockup

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
// Sản phẩm người dùng tự thêm (⚙ / nút dưới ô Sản phẩm): { name, wear, cc, spec } — spec = mô tả cho AI
// (vùng in, số mặt, cách chụp mockup), gửi kèm vì skill không có sẵn sản phẩm này.
const CUSTOM_GROUP = 'Sản phẩm thêm';
let CUSTOM = [];
function setCustomProducts(list) { CUSTOM = (list || []).map((p) => ({ name: p.name, wear: !!p.wear, cc: !!p.cc, spec: p.spec || '', custom: true })); }
const catalogGroups = () => (CUSTOM.length ? [...PRODUCTS, { group: CUSTOM_GROUP, items: CUSTOM }] : PRODUCTS);
const findProduct = (name) => [...PRODUCTS.flatMap((g) => g.items), ...CUSTOM].find((p) => p.name === name)
  || PRODUCTS[0].items.find((p) => p.name === DEFAULT_PRODUCT);
const specLine = (p, end = '') => (p.spec ? `Product spec (custom product — follow exactly): ${String(p.spec).replace(/\s+/g, ' ').trim().replace(/[.!;,\s]+$/, '')}${end}` : '');

// Người mẫu cho đồ mặc: [giá trị gửi skill, nhãn trên app].
const MODELS = [['woman', 'Nữ'], ['man', 'Nam'], ['couple', 'Cặp đôi'], ['auto', 'AI chọn']];

/** Tin nhắn chạy skill: chỉ tham số, phần còn lại skill lo. */
function skillMessage({ product, model, color, note }) {
  const p = findProduct(product);
  return [
    `Create ${NUM_OPTIONS} options for the attached design.`,
    `Product: ${p.name}.`,
    specLine(p, '.'),
    p.wear ? `Model: ${model || 'woman'}.` : '',
    p.cc ? `Shirt color: ${color || 'choose per option'}.` : '',
    note ? `Note: ${note}` : '',
  ].filter(Boolean).join(' ');
}

const MODEL_EN = { woman: 'an adult woman', man: 'an adult man', couple: 'an adult couple (woman + man)', auto: 'adult model(s) that sell this product best' };

/**
 * Prompt cho agent Claude (bước Phân tích của job Scale): xem design, research thị trường trên web,
 * chọn 5 hướng scale, viết brief cho bước tạo mockup. Trả JSON theo schema trong claude-agent.cjs.
 */
function scaleAnalysisPrompt({ product, model, color, note }) {
  const p = findProduct(product);
  return `You are a senior print-on-demand (POD) market researcher and designer for a US-focused POD shop.

The design to analyze is the image file "{{DESIGN}}" in the current directory — open it with the Read tool first.{{REFS}}
Target product: ${p.name}${p.wear ? ` (worn by ${MODEL_EN[model] || MODEL_EN.woman})` : ''}.${p.spec ? ` ${specLine(p, '.')}` : ''}${p.cc ? ` Shirt: Comfort Colors garment-dyed${color ? `, color fixed to "${color}"` : ''}.` : ''}${note ? `\nShop owner's note: ${note}` : ''}

Do this:
1. ANALYZE the design: niche, target buyer, occasion, subject/art, every text exactly, style, layout, and the selling "formula" (e.g. "funny profession phrase + retro sunset badge").
2. RESEARCH the market with WebSearch / WebFetch across Google Shopping, Etsy, Amazon, eBay, Walmart, Redbubble, TeePublic, Pinterest, Reddit, Instagram, Facebook, TikTok Shop and other e-commerce / POD sites. If a site blocks access, use search results / snippets and say so. Find: best-selling / trending similar designs, which variations of the formula sell (audiences, professions, phrases, characters, holidays/seasons, personalization), buyer keywords and tags, the typical price range for this product, demand signals (reviews, sales badges, likes, threads), and gaps. Use at least 8 different sources and keep their URLs. Be honest: listings prove a niche exists, not sales volume.
3. PICK 5 SCALE DESIGNS — 5 clearly different angles. Each keeps the recognizable formula of the original (style, layout energy, vibe, product fit) but changes the variable part (audience, phrase, subject, occasion…) toward a demand you found. Original art and wording only: never copy a competitor's design; no brand logos, trademarks, sports-team marks or celebrity names that are not already in the attached design. New text: short, punchy, correctly spelled English.

Return JSON only (it is validated against a schema):
- "report_md": the report in VIETNAMESE markdown (keep keywords/tags in English), exactly these sections:
  "## Phân tích design" (3–5 bullets), "## Thị trường" (one bullet per site checked: finding + source as [tên](url)), "## Từ khoá & tag" (10–20 comma-separated), "## Giá bán tham khảo" (price range + sources), "## 5 hướng scale" (numbered: **name** — why it sells + evidence link).
- "designs": exactly 5 items, same order as the report:
  - "name": short English name of the design;
  - "shirt_color": ${p.cc ? (color ? `"${color}"` : `exactly one of these Comfort Colors names: ${COLORS.map((c) => c[0]).join(', ')} — pick what fits, vary across designs`) : 'the product/base color'};
  - "summary_vi": one short Vietnamese line: what changed vs the original;
  - "brief": a complete English brief for an image generator, 60–120 words: subject and art (pose, details), EXACT text to print (in quotes), layout and typography, style, palette, where the print goes on the product${/2 mặt|Jersey|AOP/.test(p.name) ? ' (back = large main design, front = small matching chest print)' : ''}, and a fitting lifestyle background. Do not describe the model's face.`;
}

/**
 * Prompt cho agent Claude — bước Phân tích của job Redesign: đọc design thật kỹ (art, chép đúng từng chữ),
 * lên 5 hướng redesign (đổi bố cục + style, giữ art + text) hợp sản phẩm, viết brief cho bước tạo mockup.
 */
function redesignAnalysisPrompt({ product, model, color, note }) {
  const p = findProduct(product);
  return `You are a senior print-on-demand (POD) designer.

The design to redesign is the image file "{{DESIGN}}" in the current directory — open it with the Read tool first and study it closely.{{REFS}}
Target product: ${p.name}${p.wear ? ` (worn by ${MODEL_EN[model] || MODEL_EN.woman})` : ''}.${p.spec ? ` ${specLine(p, '.')}` : ''}${p.cc ? ` Shirt: Comfort Colors garment-dyed${color ? `, color fixed to "${color}"` : ''}.` : ''}${note ? `\nShop owner's note (follow it): ${note}` : ''}

Do this:
1. ANALYZE: theme/niche and target buyer; describe the artwork precisely (subjects, pose, details, colors) so an illustrator could recognize it; transcribe EVERY text exactly as printed (spelling, punctuation, capitalization); current style and layout.
2. PLAN 5 REDESIGN DIRECTIONS for this product. Each direction KEEPS the original artwork (same illustration / characters / graphics — never a different subject) and KEEPS ALL text exactly, letter for letter, no new words. Each uses a clearly DIFFERENT layout and a clearly DIFFERENT style — different from the original and from each other (e.g. arched retro type, vintage badge/emblem, distressed 70s, Y2K, minimal line art, sticker collage, editorial typographic poster, grunge halftone, varsity, western, cottagecore — pick what fits the theme). Fit the layout to the product's print area and shape${/2 mặt|Jersey|AOP/.test(p.name) ? '; back = large redesign, front = small matching chest print reusing part of the text or art' : ''}.

Return JSON only (it is validated against a schema):
- "report_md": the analysis in VIETNAMESE markdown (quote original texts as-is), exactly these sections:
  "## Phân tích design" (bullets: ngách & khách hàng, art, chữ trên design (chép đúng), style, bố cục), "## 5 hướng redesign" (numbered: **name** — bố cục + style + vì sao hợp).
- "designs": exactly 5 items, same order as the report:
  - "name": short English direction name;
  - "shirt_color": ${p.cc ? (color ? `"${color}"` : `exactly one of these Comfort Colors names: ${COLORS.map((c) => c[0]).join(', ')} — strong contrast with the print, vary across directions`) : 'the product/base color'};
  - "summary_vi": one short Vietnamese line: bố cục + style mới;
  - "brief": a complete English brief for an image generator, 60–120 words: which parts of the original art are used and how they are arranged, the EXACT original text (in quotes) and its typography, the new layout and style, palette, print placement on the product, and a fitting lifestyle background. Do not describe the model's face.`;
}

/**
 * Tin nhắn gửi skill (ChatGPT Work) tạo mockup theo brief Claude đã viết.
 * kind 'redesign' = giữ art + chữ của design đính kèm; 'scale' = thiết kế mới, design gốc chỉ để tham khảo chất lượng.
 */
/**
 * File brief đính kèm (comfort-brief.md) — thay cho tin nhắn dài: tin nhắn chỉ còn @skill, mọi thông tin
 * (chế độ, sản phẩm, người mẫu, màu, ghi chú, các hướng đã chọn) nằm trong file này, skill đọc file rồi làm.
 * kind 'redesign' = giữ art + chữ của design đính kèm; 'scale' = thiết kế mới theo brief.
 */
const BRIEF_FILE = 'comfort-brief.md';
function briefFile({ product, model, color, note, designs, kind = 'scale', refCount = 0, imgNote = '' }) {
  const p = findProduct(product);
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  return [
    '# COMFORT BRIEF',
    `Mode: ${kind === 'redesign' ? 'REDESIGN' : 'SCALE'}`,
    `Images: ${designs.length}`,
    `Product: ${p.name}`,
    specLine(p),
    p.wear ? `Model: ${model || 'woman'}` : '',
    note ? `Note: ${clean(note)}` : '',
    '',
    ...attachedImagesSection(refCount, imgNote),
    kind === 'redesign'
      ? 'Keep the attached design\'s artwork and ALL its text exactly; change only layout and style as each design below says.'
      : 'New scale designs: follow each design below; the attached image is only the quality and style reference.',
    '',
    ...designs.flatMap((d, i) => [`## #${i + 1} ${clean(d.name)}`, `${p.cc ? 'Shirt color' : 'Color'}: ${clean(color || d.shirt_color)}`, clean(d.brief), '']),
  ].filter((x, k, a) => x !== '' || a[k - 1] !== '').join('\n');
}

/** Mục "ảnh đính kèm" trong brief: ảnh 1 = design chính, ảnh 2..N = ảnh tham khảo + mô tả của nhân viên. */
function attachedImagesSection(refCount, imgNote) {
  if (!refCount && !imgNote) return [];
  return ['## Attached images',
    refCount ? `Image 1 (the first attached image) = the original design. Images 2-${refCount + 1} = reference images — use them only as the staff note says; never output them as designs.` : 'Image 1 = the original design.',
    imgNote ? `Staff note about the images: ${String(imgNote).replace(/\s+/g, ' ').trim()}` : '', ''].filter((x, k) => x !== '' || k === 3);
}
/** Câu nhắc cho Claude về ảnh tham khảo (thay {{REFS}}). */
function refsPrompt(names, imgNote) {
  if (!names.length && !imgNote) return '';
  const note = imgNote ? ` Staff note about the attached images: ${String(imgNote).replace(/\s+/g, ' ').trim().replace(/[.!]?$/, '.')}` : '';
  return names.length
    ? `\nAlso open the reference image(s) ${names.map((n) => `"${n}"`).join(', ')} — they are extra references from the staff (not the design to redesign).${note} Take them into account in the analysis and in every brief.`
    : `\n${note.trim()}`;
}

function briefMessage({ product, model, color, note, designs, kind = 'scale' }) {
  const p = findProduct(product);
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  return [
    kind === 'redesign'
      ? `Render ${designs.length} redesign options from these briefs (keep the attached design's artwork and ALL its text exactly; change only layout and style as each brief says).`
      : `Render ${designs.length} scale designs from these briefs (the attached image is the original design — use it only as the quality and style reference).`,
    `Product: ${p.name}.`,
    p.wear ? `Model: ${model || 'woman'}.` : '',
    note ? `Note: ${clean(note)}` : '',
    ...designs.map((d, i) => `#${i + 1} ${clean(d.name)} | ${p.cc ? 'Shirt color' : 'Color'}: ${clean(color || d.shirt_color)} | ${clean(d.brief)}`),
  ].filter(Boolean).join(' '); // 1 dòng: xuống dòng trong ô soạn ChatGPT có thể gửi tin luôn
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

module.exports = { setCustomProducts, catalogGroups, CUSTOM_GROUP, refsPrompt, NUM_OPTIONS, SCALE_OPTIONS, scaleAnalysisPrompt, redesignAnalysisPrompt, briefMessage, briefFile, BRIEF_FILE, COLORS, PRODUCTS, MODELS, DEFAULT_PRODUCT, findProduct, skillMessage, regenMessage, parseLines };
