const { supabase } = require('./_lib/auth');
const { APP_URL, CATEGORY_MAP, mdToHtml, pageShell, esc, categoryBadge, stageBadge } = require('./_lib/blog-template');

// ===== キーワードリスト（順番に記事を生成）=====
const KEYWORDS = [
  { keyword: '離乳食 進め方', slug: 'how-to-start', category: 'basic', stage: '', title_hint: '離乳食の進め方完全ガイド【月齢別】' },
  { keyword: '離乳食 食べない', slug: 'wont-eat', category: 'tips', stage: '', title_hint: '離乳食を食べてくれない時の原因と対処法' },
  { keyword: '離乳食 いつから', slug: 'when-to-start', category: 'basic', stage: '初期', title_hint: '離乳食はいつから始める？開始のサイン5つ' },
  { keyword: '離乳食 スケジュール', slug: 'schedule', category: 'stage', stage: '', title_hint: '月齢別の離乳食スケジュール表' },
  { keyword: '離乳食 冷凍', slug: 'freezing', category: 'tips', stage: '', title_hint: '離乳食の冷凍保存テクニック大全' },
  { keyword: '離乳食 初期 レシピ', slug: 'early-recipes', category: 'recipe', stage: '初期', title_hint: '離乳食初期（5〜6ヶ月）のおすすめレシピ' },
  { keyword: '離乳食 中期 レシピ', slug: 'middle-recipes', category: 'recipe', stage: '中期', title_hint: '離乳食中期（7〜8ヶ月）のおすすめレシピ' },
  { keyword: '離乳食 後期 レシピ', slug: 'late-recipes', category: 'recipe', stage: '後期', title_hint: '離乳食後期（9〜11ヶ月）のおすすめレシピ' },
  { keyword: '手づかみ食べ いつから', slug: 'finger-food', category: 'stage', stage: '後期', title_hint: '手づかみ食べはいつから？始め方ガイド' },
  { keyword: '離乳食 アレルギー', slug: 'allergy-guide', category: 'allergy', stage: '', title_hint: '離乳食のアレルギーが心配な食材の進め方' },
  { keyword: '10倍がゆ 作り方', slug: '10x-porridge', category: 'recipe', stage: '初期', title_hint: '10倍がゆの作り方（炊飯器・レンジ・鍋）' },
  { keyword: '離乳食 量 目安', slug: 'portion-guide', category: 'basic', stage: '', title_hint: '離乳食の量の目安【月齢別一覧表】' },
  { keyword: '離乳食 2回食', slug: 'two-meals', category: 'stage', stage: '中期', title_hint: '離乳食の2回食への進め方とスケジュール' },
  { keyword: '離乳食 3回食', slug: 'three-meals', category: 'stage', stage: '後期', title_hint: '離乳食の3回食への移行タイミングと献立例' },
  { keyword: '離乳食 完了期 レシピ', slug: 'completion-recipes', category: 'recipe', stage: '完了期', title_hint: '離乳食完了期（12ヶ月〜）のおすすめレシピ' },
  { keyword: '離乳食 卵 進め方', slug: 'egg-guide', category: 'food', stage: '', title_hint: '離乳食の卵の進め方【安全なステップ】' },
  { keyword: '離乳食 バナナ いつから', slug: 'banana', category: 'food', stage: '', title_hint: '離乳食のバナナはいつから？月齢別の与え方' },
  { keyword: '離乳食 豆腐 いつから', slug: 'tofu', category: 'food', stage: '', title_hint: '離乳食の豆腐はいつから？おすすめレシピ付き' },
  { keyword: '離乳食 パン いつから', slug: 'bread', category: 'food', stage: '', title_hint: '離乳食にパンはいつから？食パンの選び方' },
  { keyword: '離乳食 ヨーグルト いつから', slug: 'yogurt', category: 'food', stage: '', title_hint: '離乳食にヨーグルトはいつから？おすすめ種類' },
  { keyword: '離乳食 鮭 いつから', slug: 'salmon', category: 'food', stage: '', title_hint: '離乳食に鮭はいつから？下処理と冷凍方法' },
  { keyword: '離乳食 うどん いつから', slug: 'udon', category: 'food', stage: '', title_hint: '離乳食にうどんはいつから？茹で方のコツ' },
  { keyword: '離乳食 納豆 いつから', slug: 'natto', category: 'food', stage: '', title_hint: '離乳食に納豆はいつから？粘りの処理方法' },
  { keyword: '離乳食 トマト いつから', slug: 'tomato', category: 'food', stage: '', title_hint: '離乳食にトマトはいつから？皮の剥き方' },
  { keyword: '離乳食 さつまいも レシピ', slug: 'sweet-potato', category: 'food', stage: '', title_hint: '離乳食のさつまいもレシピ【月齢別】' },
  { keyword: '離乳食 にんじん レシピ', slug: 'carrot', category: 'food', stage: '', title_hint: '離乳食のにんじんレシピ【月齢別】' },
  { keyword: '離乳食 かぼちゃ レシピ', slug: 'pumpkin', category: 'food', stage: '', title_hint: '離乳食のかぼちゃレシピ【月齢別】' },
  { keyword: '離乳食 ほうれん草 いつから', slug: 'spinach', category: 'food', stage: '', title_hint: '離乳食にほうれん草はいつから？アク抜き方法' },
  { keyword: '離乳食 ささみ いつから', slug: 'chicken-breast', category: 'food', stage: '', title_hint: '離乳食にささみはいつから？パサつかない調理法' },
  { keyword: '離乳食 しらす いつから', slug: 'shirasu', category: 'food', stage: '', title_hint: '離乳食にしらすはいつから？塩抜き方法' },
];

// ===== 記事生成プロンプト =====
function buildPrompt(kw) {
  return {
    system: `あなたは離乳食の専門家です。科学的に正確で、厚生労働省の「授乳・離乳の支援ガイド」に準拠した記事を書いてください。

ルール:
- ターゲット読者: 初めての離乳食に不安を感じているママ・パパ
- トーン: 優しく寄り添う。「〜してくださいね」「大丈夫ですよ」
- 文字数: 2,500〜3,500字
- 見出しには ## と ### を使用（Markdown形式）
- 表を使って分かりやすく（月齢別の量の目安など）
- 「個人差があるので心配な場合はかかりつけ医に相談しましょう」を必ず入れる
- 記事内に自然な形で「MoguMoguアプリでは月齢別のレシピ動画が見られます」等のCTAを1〜2回挿入
- 画像は使わない。テキストと表で構成
- 最後に「## まとめ」セクションを入れる`,
    user: `以下のキーワードで離乳食のSEO記事を書いてください。

キーワード: ${kw.keyword}
記事タイトルの方向性: ${kw.title_hint}
カテゴリ: ${kw.category}
${kw.stage ? `対象ステージ: ${kw.stage}` : ''}

以下のJSON形式のみで回答してください（JSON以外は出力しないこと）:
{
  "title": "SEOに最適化された記事タイトル（キーワードを含む、40字以内）",
  "description": "記事の説明文（120字以内、検索結果のスニペットに表示される）",
  "content": "Markdown形式の記事本文（2500〜3500字）"
}`,
  };
}

// ===== AI API 呼び出し =====
async function callAI(systemPrompt, userPrompt) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (anthropicKey) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    });
    const data = await r.json();
    return data.content?.[0]?.text || '';
  }

  if (openaiKey) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 4096 }),
    });
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  }

  return null;
}

// ===== フォールバック記事 =====
function fallbackArticle(kw) {
  return {
    title: kw.title_hint,
    description: `${kw.keyword}について、月齢別に分かりやすく解説します。初めての離乳食でも安心のガイドです。`,
    content: `## ${kw.title_hint}\n\n赤ちゃんの離乳食、「${kw.keyword}」について気になりますよね。このページでは月齢別に分かりやすく解説します。\n\n### 基本のポイント\n\n離乳食は赤ちゃんの成長に合わせて、少しずつ進めていくことが大切です。焦らず、赤ちゃんのペースに合わせましょう。\n\n### 月齢別の目安\n\n| 時期 | 月齢 | ポイント |\n|------|------|----------|\n| 初期（ゴックン期） | 5〜6ヶ月 | なめらかにすりつぶした状態 |\n| 中期（モグモグ期） | 7〜8ヶ月 | 舌でつぶせる固さ |\n| 後期（カミカミ期） | 9〜11ヶ月 | 歯茎でつぶせる固さ |\n| 完了期（パクパク期） | 12ヶ月〜 | 歯茎で噛める固さ |\n\n個人差があるので、心配な場合はかかりつけ医に相談しましょう。\n\nMoguMoguアプリでは、月齢に合わせたレシピ動画を簡単に検索できます。\n\n### 注意点\n\n- 新しい食材は1日1種類、少量から始めましょう\n- アレルギーが心配な食材は、かかりつけ医に相談してから進めましょう\n- 平日の午前中に試すと、何かあったときに受診しやすいです\n\n### まとめ\n\n${kw.keyword}について解説しました。赤ちゃんの成長は一人ひとり違うので、焦らずゆっくり進めましょう。\n\n離乳食の悩みがあれば、MoguMoguアプリのAI相談で24時間いつでも質問できますよ。`,
  };
}

// ===== action=generate: 記事自動生成 =====
async function handleGenerate(req, res) {
  const { data: existing } = await supabase.from('blog_posts').select('slug');
  const existingSlugs = new Set((existing || []).map((p) => p.slug));

  const next = KEYWORDS.find((k) => !existingSlugs.has(k.slug));
  if (!next) {
    return res.json({ message: '全キーワードの記事が生成済みです', total: KEYWORDS.length });
  }

  const prompt = buildPrompt(next);
  const raw = await callAI(prompt.system, prompt.user);

  let article;
  if (raw) {
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      article = JSON.parse(cleaned);
    } catch {
      article = { title: next.title_hint, description: `${next.keyword}について詳しく解説します。`, content: raw };
    }
  } else {
    article = fallbackArticle(next);
  }

  const { data, error } = await supabase
    .from('blog_posts')
    .insert({ slug: next.slug, title: article.title, description: article.description, content: article.content, keyword: next.keyword, category: next.category, baby_stage: next.stage || null })
    .select()
    .single();

  if (error) throw error;

  res.json({ success: true, slug: data.slug, title: data.title, remaining: KEYWORDS.length - existingSlugs.size - 1 });
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

// ===== action=sitemap: 動的サイトマップXML =====
async function handleSitemap(req, res) {
  const base = 'https://mogumogu-omega.vercel.app';
  const { data: posts } = await supabase.from('blog_posts').select('slug, updated_at').eq('published', true).order('created_at', { ascending: false });
  const staticPages = [{ url: '/', priority: '1.0', freq: 'daily' }, { url: '/blog', priority: '0.8', freq: 'weekly' }];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticPages.map(p => `  <url>\n    <loc>${base}${p.url}</loc>\n    <changefreq>${p.freq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`).join('\n')}
${(posts || []).map(p => `  <url>\n    <loc>${base}/blog/${p.slug}</loc>\n    <lastmod>${new Date(p.updated_at).toISOString().split('T')[0]}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`).join('\n')}
</urlset>`;
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, s-maxage=86400');
  res.send(xml);
}

// ===== メインハンドラ =====
module.exports = async (req, res) => {
  try {
    const action = req.query.action;
    if (action === 'generate') return await handleGenerate(req, res);
    if (action === 'sitemap') return await handleSitemap(req, res);

    const slug = req.query.slug;
    if (slug) return await handleArticle(req, res, slug);

    return await handleList(req, res);
  } catch (err) {
    console.error('blog error:', err);
    res.status(500).json({ error: err.message });
  }
};
