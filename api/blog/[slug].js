const { supabase } = require('../_lib/auth');
const { APP_URL, mdToHtml, pageShell, esc, categoryBadge, stageBadge } = require('../_lib/blog-template');

module.exports = async (req, res) => {
  const { slug } = req.query;
  if (!slug) return res.redirect('/blog');

  // 記事を取得
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
        <!-- 記事ヘッダー -->
        <div style="padding:20px 0 0">
          <div style="margin-bottom:10px">${categoryBadge(post.category)}${stageBadge(post.baby_stage)}</div>
          <h1 style="font-size:22px;font-weight:900;line-height:1.4;margin:0 0 8px">${esc(post.title)}</h1>
          <div style="font-size:12px;color:#A8977F">${dateStr} 公開</div>
        </div>

        <!-- 記事本文 -->
        <div class="article-content">
          ${contentHtml}
        </div>

        <!-- CTA: アプリ -->
        <div class="cta-box">
          <h3>🍼 MoguMogu で離乳食レシピを検索</h3>
          <p>月齢に合わせたレシピ検索、AI相談、離乳食動画が無料で使えます</p>
          <a href="${APP_URL}" class="cta-btn">アプリを使ってみる →</a>
        </div>

        <!-- CTA: LINE -->
        <div class="line-box">
          <div style="font-size:15px;font-weight:700;margin-bottom:6px">💬 LINE で離乳食情報を受け取る</div>
          <div style="font-size:12px;color:#8B7355;margin-bottom:10px">週2回、おすすめレシピやTipsを配信中</div>
          <a href="${APP_URL}" class="line-btn">友だち追加はアプリから</a>
        </div>

        <!-- 関連記事 -->
        ${relatedHtml}

        <!-- フッター -->
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
};
