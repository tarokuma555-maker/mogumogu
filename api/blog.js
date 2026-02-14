const { supabase } = require('./_lib/auth');
const { APP_URL, CATEGORY_MAP, mdToHtml, pageShell, esc, categoryBadge, stageBadge } = require('./_lib/blog-template');

// ===== サイトマップ =====
async function handleSitemap(req, res) {
  const base = 'https://mogumogu-omega.vercel.app';

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('slug, updated_at')
    .eq('published', true)
    .order('created_at', { ascending: false });

  const staticPages = [
    { url: '/', priority: '1.0', freq: 'daily' },
    { url: '/blog', priority: '0.8', freq: 'weekly' },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticPages.map((p) => `  <url>
    <loc>${base}${p.url}</loc>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
${(posts || []).map((p) => `  <url>
    <loc>${base}/blog/${p.slug}</loc>
    <lastmod>${new Date(p.updated_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, s-maxage=86400');
  res.send(xml);
}

// ===== 記事詳細 =====
async function handleArticle(req, res, slug) {
  const { data: post, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('slug', slug)
    .eq('published', true)
    .single();

  if (error || !post) {
    const html = pageShell({
      title: '記事が見つかりません - MoguMogu',
      body: `
        <div class="header"><div class="wrap"><a href="/blog">← 記事一覧</a><h1>📚 離乳食ガイド</h1></div></div>
        <div class="wrap"><div class="empty"><p style="font-size:48px;margin-bottom:12px">📄</p><p style="font-size:16px;font-weight:700;margin-bottom:8px">記事が見つかりません</p><p><a href="/blog">記事一覧に戻る →</a></p></div></div>`,
    });
    return res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
  }

  // 閲覧数カウントアップ（非同期、エラー無視）
  supabase
    .from('blog_posts')
    .update({ views_count: (post.views_count || 0) + 1 })
    .eq('id', post.id)
    .then(() => {});

  // 関連記事を取得（同カテゴリ、最大3件）
  const { data: related } = await supabase
    .from('blog_posts')
    .select('slug, title, category, baby_stage')
    .eq('published', true)
    .eq('category', post.category)
    .neq('slug', post.slug)
    .order('created_at', { ascending: false })
    .limit(3);

  const contentHtml = mdToHtml(post.content);
  const dateStr = new Date(post.created_at).toLocaleDateString('ja-JP');
  const canonical = `${APP_URL}/blog/${post.slug}`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    author: { '@type': 'Organization', name: 'MoguMogu' },
    publisher: { '@type': 'Organization', name: 'MoguMogu' },
    datePublished: post.created_at,
    dateModified: post.updated_at || post.created_at,
    mainEntityOfPage: canonical,
  });

  // 関連記事HTML
  let relatedHtml = '';
  if (related && related.length > 0) {
    relatedHtml = `
      <div style="margin:24px 0">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:12px">📖 関連記事</h3>
        ${related
          .map(
            (r) => `
          <a href="/blog/${esc(r.slug)}" class="card">
            <div>${categoryBadge(r.category)}${stageBadge(r.baby_stage)}</div>
            <div class="card-title">${esc(r.title)}</div>
          </a>`
          )
          .join('')}
      </div>`;
  }

  const html = pageShell({
    title: `${post.title} | MoguMogu 離乳食ガイド`,
    description: post.description || post.content.slice(0, 140),
    canonicalUrl: canonical,
    jsonLd,
    body: `
      <div class="header">
        <div class="wrap">
          <a href="/blog">← 記事一覧</a>
          <h1>📚 離乳食ガイド</h1>
        </div>
      </div>

      <div class="wrap">
        <div style="padding:20px 0 0">
          <div style="margin-bottom:10px">${categoryBadge(post.category)}${stageBadge(post.baby_stage)}</div>
          <h1 style="font-size:22px;font-weight:900;line-height:1.4;margin:0 0 8px">${esc(post.title)}</h1>
          <div style="font-size:12px;color:#A8977F">${dateStr} 公開</div>
        </div>

        <div class="article-content">
          ${contentHtml}
        </div>

        <div class="cta-box">
          <h3>🍼 MoguMogu で離乳食レシピを検索</h3>
          <p>月齢に合わせたレシピ検索、AI相談、離乳食動画が無料で使えます</p>
          <a href="${APP_URL}" class="cta-btn">アプリを使ってみる →</a>
        </div>

        <div class="line-box">
          <div style="font-size:15px;font-weight:700;margin-bottom:6px">💬 LINE で離乳食情報を受け取る</div>
          <div style="font-size:12px;color:#8B7355;margin-bottom:10px">週2回、おすすめレシピやTipsを配信中</div>
          <a href="${APP_URL}" class="line-btn">友だち追加はアプリから</a>
        </div>

        ${relatedHtml}

        <div class="footer">
          <a href="/blog" style="font-weight:700">📚 記事一覧</a>
          <span style="margin:0 12px;color:#FFE0C2">|</span>
          <a href="${APP_URL}" style="font-weight:700">🍼 アプリトップ</a>
          <div style="margin-top:12px;font-size:11px;color:#A8977F">© MoguMogu - 離乳食サポートアプリ</div>
        </div>
      </div>`,
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.send(html);
}

// ===== 記事一覧 =====
async function handleList(req, res) {
  const cat = req.query.cat || 'all';

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
        <div class="cat-bar">${catTabsHtml}</div>

        <div style="padding-bottom:24px">
          ${listHtml}
        </div>

        <div class="cta-box">
          <h3>🍼 MoguMogu アプリで離乳食をもっとラクに</h3>
          <p>レシピ検索、離乳食動画、AI相談が全部無料！</p>
          <a href="${APP_URL}" class="cta-btn">アプリを使ってみる →</a>
        </div>

        <div class="footer">
          <a href="${APP_URL}" style="font-weight:700">🍼 アプリトップ</a>
          <div style="margin-top:12px;font-size:11px;color:#A8977F">© MoguMogu - 離乳食サポートアプリ</div>
        </div>
      </div>`,
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  res.send(html);
}

// ===== メインハンドラ =====
module.exports = async (req, res) => {
  try {
    const action = req.query.action;
    if (action === 'sitemap') return await handleSitemap(req, res);

    const slug = req.query.slug;
    if (slug) return await handleArticle(req, res, slug);

    return await handleList(req, res);
  } catch (err) {
    console.error('blog error:', err);
    res.status(500).json({ error: err.message });
  }
};
