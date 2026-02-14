const APP_URL = 'https://mogumogu-omega.vercel.app';

const CATEGORY_MAP = {
  basic: { label: '基本', icon: '📖' },
  recipe: { label: 'レシピ', icon: '🍳' },
  stage: { label: '月齢別', icon: '👶' },
  food: { label: '食材', icon: '🥕' },
  allergy: { label: 'アレルギー', icon: '⚠️' },
  tips: { label: 'コツ', icon: '💡' },
  goods: { label: 'グッズ', icon: '🧸' },
};

// ===== 簡易 Markdown → HTML 変換 =====
function mdToHtml(md) {
  if (!md) return '';

  // 各行を処理
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let inTable = false;
  let tableHeader = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 見出し
    if (line.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      if (inTable) { html += '</tbody></table>'; inTable = false; }
      html += `<h3>${line.slice(4)}</h3>`;
      continue;
    }
    if (line.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      if (inTable) { html += '</tbody></table>'; inTable = false; }
      html += `<h2>${line.slice(3)}</h2>`;
      continue;
    }

    // テーブル
    if (line.startsWith('|')) {
      const cells = line.split('|').filter((c) => c.trim()).map((c) => c.trim());
      // セパレータ行をスキップ
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        tableHeader = false;
        continue;
      }
      if (!inTable) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<table><thead>';
        inTable = true;
        tableHeader = true;
      }
      const tag = tableHeader ? 'th' : 'td';
      if (!tableHeader && html.includes('<thead>') && !html.includes('<tbody>')) {
        html += '</thead><tbody>';
      }
      html += '<tr>' + cells.map((c) => `<${tag}>${inlineFormat(c)}</${tag}>`).join('') + '</tr>';
      continue;
    } else if (inTable) {
      html += '</tbody></table>';
      inTable = false;
    }

    // リスト
    if (line.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineFormat(line.slice(2))}</li>`;
      continue;
    } else if (/^\d+\.\s/.test(line)) {
      if (!inList) { html += '<ol>'; inList = true; }
      html += `<li>${inlineFormat(line.replace(/^\d+\.\s/, ''))}</li>`;
      continue;
    } else if (inList) {
      html += line.trim() === '' ? '' : '</ul>';
      if (line.trim() !== '') inList = false;
      else { continue; }
    }

    // 空行
    if (line.trim() === '') {
      continue;
    }

    // 通常テキスト
    html += `<p>${inlineFormat(line)}</p>`;
  }

  if (inList) html += '</ul>';
  if (inTable) html += '</tbody></table>';

  return html;
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// ===== HTMLテンプレート =====
function pageShell({ title, description, canonicalUrl, jsonLd, body }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
<title>${esc(title || 'MoguMogu 離乳食ガイド')}</title>
<meta name="description" content="${esc(description || '離乳食レシピ・月齢別ガイド')}"/>
<meta property="og:title" content="${esc(title || 'MoguMogu 離乳食ガイド')}"/>
<meta property="og:description" content="${esc(description || '離乳食レシピ・月齢別ガイド')}"/>
<meta property="og:type" content="article"/>
<meta property="og:site_name" content="MoguMogu"/>
${canonicalUrl ? `<meta property="og:url" content="${esc(canonicalUrl)}"/>\n<link rel="canonical" href="${esc(canonicalUrl)}"/>` : ''}
<meta name="twitter:card" content="summary"/>
${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700;900&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Zen Maru Gothic',-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;background:#FFF8F0;color:#3D2C1E;line-height:1.8}
a{color:#FF6B35;text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:680px;margin:0 auto;padding:0 16px}
.header{background:linear-gradient(135deg,#FF8C42,#FF6B35);padding:20px 16px;color:#fff}
.header a{color:#fff;font-size:13px;opacity:.85}
.header h1{font-size:14px;font-weight:700;margin-top:4px}
.article-content{font-size:15px;padding:24px 0 16px}
.article-content h2{font-size:19px;margin:32px 0 14px;padding-bottom:8px;border-bottom:2px solid #FF6B35;color:#3D2C1E;font-weight:900}
.article-content h3{font-size:16px;margin:24px 0 10px;padding-left:12px;border-left:3px solid #FF6B35;color:#3D2C1E;font-weight:700}
.article-content p{margin:0 0 14px}
.article-content ul,.article-content ol{padding-left:22px;margin:0 0 14px}
.article-content li{margin-bottom:6px}
.article-content table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px}
.article-content th,.article-content td{padding:8px 10px;border:1px solid #FFE0C2}
.article-content th{background:#FFF0E0;font-weight:700;white-space:nowrap}
.article-content strong{color:#E65100}
.article-content code{background:#FFF0E0;padding:2px 6px;border-radius:4px;font-size:13px}
.badge{display:inline-block;font-size:11px;padding:3px 10px;border-radius:8px;font-weight:700;margin-right:6px}
.badge-cat{background:#FFF0E0;color:#E65100}
.badge-stage{background:#E8F5E9;color:#2E7D32}
.cta-box{margin:32px 0;padding:24px;background:linear-gradient(135deg,#FFF3E0,#FFE0B2);border-radius:16px;text-align:center}
.cta-box h3{font-size:17px;margin-bottom:6px}
.cta-box p{font-size:13px;color:#8B7355;margin-bottom:14px}
.cta-btn{display:inline-block;background:linear-gradient(135deg,#FF8C42,#FF6B35);color:#fff;border-radius:30px;padding:12px 28px;font-size:14px;font-weight:700;text-decoration:none}
.cta-btn:hover{text-decoration:none;opacity:.9}
.line-box{margin:0 0 32px;padding:18px;background:#E8F5E9;border-radius:14px;text-align:center}
.line-btn{display:inline-block;background:#06C755;color:#fff;border-radius:30px;padding:10px 24px;font-size:13px;font-weight:700;text-decoration:none}
.footer{padding:24px 0;border-top:1px solid #FFE0C2;text-align:center;font-size:13px;margin-top:16px}
.card{background:#fff;border-radius:16px;padding:16px;margin-bottom:12px;border:1px solid #FFE0C2;display:block;text-decoration:none;color:#3D2C1E}
.card:hover{box-shadow:0 2px 12px rgba(255,107,53,.12);text-decoration:none}
.card-title{font-size:15px;font-weight:700;line-height:1.4;margin-bottom:4px}
.card-desc{font-size:12px;color:#8B7355;line-height:1.5}
.card-date{font-size:11px;color:#A8977F;margin-top:6px}
.cat-bar{display:flex;gap:8px;overflow-x:auto;padding:12px 0;-webkit-overflow-scrolling:touch}
.cat-btn{flex-shrink:0;padding:7px 14px;border-radius:18px;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;background:#fff;color:#8B7355;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.cat-btn.active{background:#FF6B35;color:#fff}
.empty{text-align:center;padding:60px 20px;color:#A8977F}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function categoryBadge(cat) {
  const c = CATEGORY_MAP[cat];
  if (!c) return '';
  return `<span class="badge badge-cat">${c.icon} ${c.label}</span>`;
}

function stageBadge(stage) {
  if (!stage) return '';
  return `<span class="badge badge-stage">${stage}</span>`;
}

module.exports = { APP_URL, CATEGORY_MAP, mdToHtml, pageShell, esc, categoryBadge, stageBadge };
