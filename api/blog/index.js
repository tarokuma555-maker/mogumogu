const { supabase } = require('../_lib/auth');
const { APP_URL, CATEGORY_MAP, pageShell, esc, categoryBadge, stageBadge } = require('../_lib/blog-template');

module.exports = async (req, res) => {
  const cat = req.query.cat || 'all';

  // 記事取得
  let query = supabase
    .from('blog_posts')
    .select('id, slug, title, description, category, baby_stage, views_count, created_at')
    .eq('published', true)
    .order('created_at', { ascending: false });

  if (cat !== 'all' && CATEGORY_MAP[cat]) {
    query = query.eq('category', cat);
  }

  const { data: posts } = await query;
  const articles = posts || [];

  // カテゴリタブ
  const cats = [
    { id: 'all', label: 'すべて', icon: '📚' },
    ...Object.entries(CATEGORY_MAP).map(([id, v]) => ({ id, ...v })),
  ];

  const catTabsHtml = cats
    .map(
      (c) =>
        `<a href="/blog${c.id === 'all' ? '' : `?cat=${c.id}`}" class="cat-btn${c.id === cat ? ' active' : ''}">${c.icon} ${c.label}</a>`
    )
    .join('');

  // 記事一覧
  let listHtml = '';
  if (articles.length === 0) {
    listHtml = '<div class="empty"><p style="font-size:48px;margin-bottom:12px">📝</p><p>記事がまだありません</p></div>';
  } else {
    listHtml = articles
      .map((p) => {
        const date = new Date(p.created_at).toLocaleDateString('ja-JP');
        return `
        <a href="/blog/${esc(p.slug)}" class="card">
          <div style="margin-bottom:6px">${categoryBadge(p.category)}${stageBadge(p.baby_stage)}</div>
          <div class="card-title">${esc(p.title)}</div>
          ${p.description ? `<div class="card-desc">${esc(p.description).slice(0, 80)}…</div>` : ''}
          <div class="card-date">${date}</div>
        </a>`;
      })
      .join('');
  }

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'MoguMogu 離乳食ガイド',
    description: '離乳食の進め方、月齢別レシピ、食材ガイド、アレルギー対策など',
    url: `${APP_URL}/blog`,
    isPartOf: { '@type': 'WebSite', name: 'MoguMogu', url: APP_URL },
  });

  const html = pageShell({
    title: '離乳食ガイド - 月齢別の進め方・レシピ・食材ガイド | MoguMogu',
    description:
      '離乳食の進め方、月齢別のおすすめレシピ、食材の与え方、アレルギー対策など、初めての離乳食を分かりやすく解説。MoguMoguの離乳食ガイド。',
    canonicalUrl: `${APP_URL}/blog`,
    jsonLd,
    body: `
      <div class="header">
        <div class="wrap">
          <a href="${APP_URL}">← アプリに戻る</a>
          <h1>📚 離乳食ガイド</h1>
          <p style="font-size:12px;opacity:.85;margin-top:2px">月齢別の進め方、レシピ、食材ガイド</p>
        </div>
      </div>

      <div class="wrap">
        <!-- カテゴリフィルター -->
        <div class="cat-bar">${catTabsHtml}</div>

        <!-- 記事一覧 -->
        <div style="padding-bottom:24px">
          ${listHtml}
        </div>

        <!-- CTA -->
        <div class="cta-box">
          <h3>🍼 MoguMogu アプリで離乳食をもっとラクに</h3>
          <p>レシピ検索、離乳食動画、AI相談が全部無料！</p>
          <a href="${APP_URL}" class="cta-btn">アプリを使ってみる →</a>
        </div>

        <!-- フッター -->
        <div class="footer">
          <a href="${APP_URL}" style="font-weight:700">🍼 アプリトップ</a>
          <div style="margin-top:12px;font-size:11px;color:#A8977F">© MoguMogu - 離乳食サポートアプリ</div>
        </div>
      </div>`,
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  res.send(html);
};
