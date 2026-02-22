/*
セットアップ:

1. Supabase テーブル作成SQL:

-- X投稿履歴テーブル
CREATE TABLE IF NOT EXISTS x_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_type TEXT,
  content TEXT NOT NULL,
  tweet_id TEXT,
  posted_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE x_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "x_posts_service_all" ON x_posts FOR ALL USING (true) WITH CHECK (true);

-- Instagram投稿履歴テーブル
CREATE TABLE IF NOT EXISTS instagram_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_type TEXT,
  caption TEXT NOT NULL,
  image_url TEXT,
  ig_media_id TEXT,
  posted_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE instagram_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "instagram_posts_service_all" ON instagram_posts FOR ALL USING (true) WITH CHECK (true);

2. Supabase Storage:
- 「instagram-images」バケットを public で作成
- 任意: フォールバック画像をアップロード（recipe/, tip/, stage/, relatable/, promo/ フォルダ）

3. 環境変数:
X投稿:       X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
Instagram:   INSTAGRAM_ACCESS_TOKEN（60日ごとに更新必要）, INSTAGRAM_BUSINESS_ACCOUNT_ID
画像生成:    OPENAI_API_KEY（DALL-E 3 用）
テキスト生成: ANTHROPIC_API_KEY または OPENAI_API_KEY

4. Instagram アクセストークン取得手順:
   a. Instagram をビジネスアカウントに切り替え
   b. Facebook ページを作成し Instagram とリンク
   c. Meta Developer Portal でアプリ作成
   d. instagram_basic, instagram_content_publish, pages_read_engagement 権限を取得
   e. 長期トークンを生成して INSTAGRAM_ACCESS_TOKEN に設定
*/

const crypto = require('crypto');
const { supabase } = require('./_lib/auth');

// =============================================================
// ===== X (Twitter) セクション =====
// =============================================================

function encodeRFC3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function createOAuthHeader(method, url, params, consumerKey, consumerSecret, token, tokenSecret) {
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: token,
    oauth_version: '1.0',
  };

  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map(k => `${encodeRFC3986(k)}=${encodeRFC3986(allParams[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    encodeRFC3986(url),
    encodeRFC3986(paramString),
  ].join('&');

  const signingKey = `${encodeRFC3986(consumerSecret)}&${encodeRFC3986(tokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  oauthParams.oauth_signature = signature;

  return 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${encodeRFC3986(k)}="${encodeRFC3986(oauthParams[k])}"`)
    .join(', ');
}

async function postTweet(text) {
  const url = 'https://api.twitter.com/2/tweets';
  const authHeader = createOAuthHeader(
    'POST', url, {},
    process.env.X_API_KEY,
    process.env.X_API_SECRET,
    process.env.X_ACCESS_TOKEN,
    process.env.X_ACCESS_TOKEN_SECRET
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return res.json();
}

async function generateTweetText(type, pastContents) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
  if (!anthropicKey && !openaiKey) return null;

  const systemPrompt = `あなたは離乳食の情報を発信するX（Twitter）アカウントの運営者です。
フォロワーは0〜2歳の子を持つママ・パパです。
ルール:
- 140字以内（日本語）
- 絵文字を適度に使う
- ハッシュタグは2〜3個
- 改行を使って読みやすく
- 医学的に正確な情報のみ
- 温かく共感的なトーン
- JSON形式で回答: {"text":"投稿テキスト"}`;

  const typePrompts = {
    tip: '離乳食の実用的なTips（冷凍保存、調理テクニック、食材の下処理など）を1つツイートしてください。「💡 離乳食Tips」で始めてください。',
    stage: 'ランダムな月齢（5〜18ヶ月のいずれか）の離乳食チェックリストや情報をツイートしてください。「📋 ○ヶ月の離乳食」で始めてください。',
    relatable: '離乳食あるあるネタを1つ、共感を呼ぶ温かいトーンでツイートしてください。最後にポジティブな一言を添えてください。「離乳食あるある」で始めてください。',
    promo: 'MoguMoguアプリの紹介ツイートを書いてください。URL: https://mogumogu-omega.vercel.app を必ず含めてください。機能: 月齢別レシピ動画、AI相談、完全無料。',
  };

  const pastText = pastContents.length > 0
    ? `\n\n過去の投稿（重複を避けてください）:\n${pastContents.slice(0, 10).join('\n---\n')}`
    : '';
  const userPrompt = (typePrompts[type] || typePrompts.tip) + pastText;

  if (anthropicKey) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 512, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    });
    const data = await r.json();
    return data.content?.[0]?.text || null;
  }

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 512 }),
  });
  const data = await r.json();
  return data.choices?.[0]?.message?.content || null;
}

const FALLBACK_X = {
  tip: [
    '💡 離乳食Tips\nにんじんは「すりおろして冷凍」しておくとおかゆに混ぜるだけで1品完成！\n冷凍保存の目安は1週間。\n#離乳食 #離乳食レシピ',
    '💡 離乳食Tips\nかぼちゃは電子レンジ3分で柔らかくなります。\nマッシュして製氷皿で冷凍すれば離乳食ストックに！\n#離乳食 #時短レシピ',
    '💡 離乳食Tips\nしらすの塩抜きは熱湯をかけるだけでOK。\nタンパク質と鉄分が摂れる優秀食材です。\n#離乳食 #しらす',
    '💡 離乳食Tips\nほうれん草はアク抜きが大事！\n茹でた後に水にさらしてからペーストにしましょう。\n#離乳食 #ほうれん草',
    '💡 離乳食Tips\nバナナは加熱すると甘みが増して赤ちゃんが食べやすくなります🍌\nレンジで20秒でOK！\n#離乳食 #バナナ',
  ],
  stage: [
    '📋 7ヶ月の離乳食チェックリスト\n☑ 2回食スタート\n☑ 舌でつぶせる固さ\n☑ 新しい食材にチャレンジ\n#離乳食中期 #7ヶ月 #離乳食',
    '📋 9ヶ月の離乳食チェックリスト\n☑ 3回食に慣れてきた\n☑ 手づかみ食べの練習\n☑ 歯ぐきでつぶせる固さ\n#離乳食後期 #9ヶ月 #離乳食',
    '📋 5ヶ月の離乳食スタート\n☑ スプーンを口に近づけて嫌がらない\n☑ 食べ物に興味を示す\n☑ 首がすわっている\n#離乳食初期 #5ヶ月 #離乳食',
    '📋 12ヶ月の離乳食\n☑ 大人の取り分けOK\n☑ 薄味で調理\n☑ 手づかみ食べが上手に\n#離乳食完了期 #1歳 #離乳食',
    '📋 8ヶ月の離乳食ポイント\n☑ タンパク質を増やす\n☑ 豆腐・白身魚にチャレンジ\n☑ 食感のバリエーション\n#離乳食中期 #8ヶ月 #離乳食',
  ],
  relatable: [
    '離乳食あるある\n「1時間かけて作ったおかゆ、3口で終了」\nでもその3口を食べてくれただけで今日は100点💮\n#離乳食 #育児あるある #ママパパ応援',
    '離乳食あるある\n「昨日パクパク食べたのに今日は全拒否」\n赤ちゃんの気分は日替わりメニューです🫠\n#離乳食 #育児あるある',
    '離乳食あるある\n「床に落ちた食材で今日のメニューがわかる」\n片付けお疲れさまです…！✨\n#離乳食 #育児あるある #お疲れさま',
    '離乳食あるある\n「ベビーフードの方が食いつきがいい問題」\nプロの味付けには勝てない…でもOK！🙆‍♀️\n#離乳食 #育児あるある',
    '離乳食あるある\n「スプーンを奪い取って自分で食べたがる」\n成長の証ですね👶✨（掃除は大変だけど）\n#離乳食 #育児あるある',
  ],
  promo: [
    '離乳食のレシピに困ったらMoguMogu使ってみて🍼\n✅ 月齢に合わせたレシピ動画\n✅ AIに24時間相談できる\n✅ 完全無料\nhttps://mogumogu-omega.vercel.app\n#離乳食 #離乳食アプリ',
    '離乳食の悩み、AIに相談してみませんか？🤖\nMoguMoguなら24時間いつでも相談OK！\nレシピ検索も動画も全部無料✨\nhttps://mogumogu-omega.vercel.app\n#離乳食 #育児',
    '月齢に合ったレシピがすぐ見つかる📱\nMoguMoguは離乳食に特化した無料アプリです🍙\nhttps://mogumogu-omega.vercel.app\n#離乳食 #離乳食レシピ #無料アプリ',
    '「今日の離乳食どうしよう…」\nそんな時はMoguMoguでレシピ検索🔍\nAIが月齢に合わせて提案してくれます✨\nhttps://mogumogu-omega.vercel.app\n#離乳食 #離乳食アプリ',
    '離乳食の動画が見放題📹\n初期〜完了期まで月齢別にチェックできます！\nMoguMogu - 完全無料🍼\nhttps://mogumogu-omega.vercel.app\n#離乳食 #離乳食動画',
  ],
};

async function handleX(req, res) {
  if (!process.env.X_API_KEY) {
    return res.status(200).json({ error: 'X_API_KEY is not configured' });
  }

  let type = req.query.type;
  if (!type) {
    const hour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
    if (hour >= 6 && hour < 10) type = 'tip';
    else if (hour >= 10 && hour < 15) type = 'stage';
    else if (hour >= 19 && hour < 23) type = 'relatable';
    else type = 'promo';
  }

  let pastContents = [];
  try {
    const { data } = await supabase
      .from('x_posts').select('content')
      .eq('post_type', type).order('posted_at', { ascending: false }).limit(10);
    pastContents = (data || []).map(p => p.content);
  } catch (e) { console.error('x_posts query failed:', e.message); }

  let tweetText = null;
  const raw = await generateTweetText(type, pastContents);
  if (raw) {
    try {
      const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      tweetText = JSON.parse(cleaned).text;
    } catch {
      tweetText = raw.replace(/^["']|["']$/g, '').trim();
      if (tweetText.length > 140) tweetText = tweetText.slice(0, 137) + '…';
    }
  }
  if (!tweetText) {
    const pool = FALLBACK_X[type] || FALLBACK_X.tip;
    const unused = pool.filter(t => !pastContents.includes(t));
    const src = unused.length > 0 ? unused : pool;
    tweetText = src[Math.floor(Math.random() * src.length)];
  }

  const result = await postTweet(tweetText);

  try {
    await supabase.from('x_posts').insert({
      post_type: type, content: tweetText, tweet_id: result.data?.id || null,
    });
  } catch (e) { console.error('x_posts insert failed:', e.message); }

  if (result.data?.id) {
    return res.json({ success: true, platform: 'x', tweet_id: result.data.id, text: tweetText });
  }
  return res.status(200).json({ error: result.detail || result.title || 'Post failed', text: tweetText, raw: result });
}

// =============================================================
// ===== Instagram セクション =====
// =============================================================

async function generateInstagramContent(type, pastCaptions) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
  if (!anthropicKey && !openaiKey) return null;

  const systemPrompt = `あなたはInstagramで離乳食の情報を発信するアカウント「MoguMogu」の運営者です。
フォロワーは0〜2歳の子を持つママ・パパです。
ルール:
- キャプションは500字以内（日本語）
- 絵文字を多めに使って温かい雰囲気
- ハッシュタグは10〜15個（キャプション末尾にまとめる）
- 改行を使って読みやすく
- 医学的に正確な情報のみ
- 共感的で親しみやすいトーン
- 最後にアプリURL https://mogumogu-omega.vercel.app を含める
- 必ずJSON形式で回答:
{
  "caption": "投稿キャプション全文",
  "image_prompt": "English prompt for DALL-E. Style: bright, clean, pastel colors, professional baby food photography, overhead shot, warm natural lighting. Never include text, watermarks, logos, or human faces."
}`;

  const typePrompts = {
    recipe: '離乳食の簡単レシピを1つ紹介する投稿を書いてください。材料と簡単な手順を含めてください。「🍳 今日の離乳食レシピ」で始めてください。',
    tip: '離乳食の実用的なTips（冷凍保存、調理テクニックなど）を1つ紹介する投稿を書いてください。「💡 離乳食のコツ」で始めてください。',
    stage: 'ランダムな月齢（5〜18ヶ月のいずれか）の離乳食ガイドを投稿してください。食べられる食材や注意点を含めてください。「📋 ○ヶ月の離乳食ガイド」で始めてください。',
    relatable: '離乳食あるあるネタを1つ、共感を呼ぶ温かいトーンで投稿してください。最後にポジティブな一言を添えてください。',
    promo: 'MoguMoguアプリの紹介投稿を書いてください。機能: 月齢別レシピ動画、AI相談、完全無料。URL: https://mogumogu-omega.vercel.app を含めてください。',
  };

  const pastText = pastCaptions.length > 0
    ? `\n\n過去の投稿（重複を避けてください）:\n${pastCaptions.slice(0, 5).join('\n---\n')}`
    : '';
  const userPrompt = (typePrompts[type] || typePrompts.recipe) + pastText;

  if (anthropicKey) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    });
    const data = await r.json();
    return data.content?.[0]?.text || null;
  }

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 1024 }),
  });
  const data = await r.json();
  return data.choices?.[0]?.message?.content || null;
}

// ===== DALL-E 画像生成 =====
async function generateImage(prompt, apiKey) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'standard' }),
  });
  const data = await r.json();
  return data.data?.[0]?.url || null;
}

// ===== Supabase Storage にアップロード =====
async function uploadImageToStorage(imageUrl) {
  const imgRes = await fetch(imageUrl);
  const arrayBuf = await imgRes.arrayBuffer();
  const imgBuffer = Buffer.from(arrayBuf);

  const filename = `ig_${Date.now()}.png`;
  const { error } = await supabase.storage
    .from('instagram-images')
    .upload(filename, imgBuffer, { contentType: 'image/png', upsert: false });

  if (error) {
    console.error('Storage upload error:', error.message);
    return null;
  }

  const { data: { publicUrl } } = supabase.storage
    .from('instagram-images')
    .getPublicUrl(filename);

  return publicUrl;
}

// ===== フォールバック画像取得 =====
async function getRandomStorageImage(type) {
  try {
    const { data: typeFiles } = await supabase.storage
      .from('instagram-images')
      .list(type, { limit: 50 });

    if (typeFiles && typeFiles.length > 0) {
      const valid = typeFiles.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f.name));
      if (valid.length > 0) {
        const file = valid[Math.floor(Math.random() * valid.length)];
        const { data: { publicUrl } } = supabase.storage
          .from('instagram-images')
          .getPublicUrl(`${type}/${file.name}`);
        return publicUrl;
      }
    }

    const { data: rootFiles } = await supabase.storage
      .from('instagram-images')
      .list('', { limit: 50 });
    const valid = (rootFiles || []).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f.name));
    if (valid.length === 0) return null;

    const file = valid[Math.floor(Math.random() * valid.length)];
    const { data: { publicUrl } } = supabase.storage
      .from('instagram-images')
      .getPublicUrl(file.name);
    return publicUrl;
  } catch (e) {
    console.error('Storage image fetch failed:', e.message);
    return null;
  }
}

// ===== Instagram Graph API 投稿 =====
async function postToInstagram(imageUrl, caption, igUserId, igToken) {
  // Step 1: メディアコンテナ作成
  const containerRes = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ image_url: imageUrl, caption, access_token: igToken }),
    }
  );
  const containerData = await containerRes.json();

  if (!containerData.id) {
    return { error: { message: containerData.error?.message || 'Container creation failed' }, raw: containerData };
  }

  // Step 2: 処理待ち
  await new Promise(r => setTimeout(r, 2000));

  // Step 3: 公開
  const publishRes = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: containerData.id, access_token: igToken }),
    }
  );
  return publishRes.json();
}

// ===== デフォルト画像プロンプト =====
function getDefaultImagePrompt(type) {
  const prompts = {
    recipe: 'Beautiful overhead photograph of colorful homemade baby food in small cute ceramic bowls on a light wooden table, fresh vegetables around, soft natural lighting, pastel kitchen, clean and bright, professional food photography, no text no watermarks',
    tip: 'Clean bright photograph of baby food preparation scene, small portions in ice cube trays, fresh ingredients on cutting board, pastel kitchen towel, warm natural lighting, minimalist style, no text no watermarks',
    stage: 'Cute colorful baby food portions arranged neatly in small bowls on a pastel colored tray, soft bokeh background, warm inviting atmosphere, overhead shot, professional photography, no text no watermarks',
    relatable: 'Warm cozy kitchen scene with baby food preparation, cheerful pastel colors, cute bowls and spoons, soft warm lighting, lifestyle photography style, no text no watermarks',
    promo: 'Modern smartphone on a clean white desk next to cute baby food dishes in pastel bowls, bright airy photography, lifestyle flat lay, professional product photography, no text no watermarks',
  };
  return prompts[type] || prompts.recipe;
}

// ===== Instagram フォールバックキャプション =====
const FALLBACK_IG = {
  recipe: [
    '🍳 今日の離乳食レシピ\n\n【にんじんとおかゆのペースト】\n\n📝 材料:\n・ごはん 大さじ2\n・にんじん 1/4本\n・お湯 適量\n\n👩‍🍳 作り方:\n1️⃣ にんじんを薄切りにして柔らかく茹でる\n2️⃣ ブレンダーでなめらかにする\n3️⃣ おかゆに混ぜて完成！\n\n💡 冷凍保存もOK！製氷皿で1週間分作れます✨\n\nレシピ動画はアプリでチェック👇\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食レシピ #離乳食初期 #赤ちゃんごはん #ベビーフード #手作り離乳食 #離乳食記録 #育児 #子育て #ママライフ',
    '🍳 今日の離乳食レシピ\n\n【かぼちゃの甘煮マッシュ】\n\n📝 材料:\n・かぼちゃ 50g\n・お湯 適量\n\n👩‍🍳 作り方:\n1️⃣ かぼちゃの皮をむいて一口大に切る\n2️⃣ レンジで3分加熱\n3️⃣ フォークでマッシュして完成！\n\n💡 自然な甘みで赤ちゃん大好き🎃\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食レシピ #かぼちゃ #赤ちゃんごはん #離乳食初期 #離乳食中期 #手作り離乳食 #育児 #ママライフ #離乳食記録',
    '🍳 今日の離乳食レシピ\n\n【バナナオートミールパンケーキ】\n\n📝 材料:\n・バナナ 1/2本\n・オートミール 大さじ3\n・牛乳 大さじ2\n\n👩‍🍳 作り方:\n1️⃣ バナナをフォークでつぶす\n2️⃣ オートミールと牛乳を混ぜる\n3️⃣ フライパンで両面焼く\n\n💡 手づかみ食べの練習にも最適🥞✨\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食後期 #手づかみ食べ #バナナ #赤ちゃんごはん #離乳食レシピ #育児 #子育て #ママライフ #離乳食記録',
  ],
  tip: [
    '💡 離乳食のコツ\n\n【冷凍ストック術で毎日ラクラク】\n\n✅ 製氷皿で小分け冷凍\n✅ 1〜2週間以内に使い切る\n✅ 解凍はレンジで しっかり加熱\n✅ ラベルに日付と食材名を記入\n\nまとめて作って冷凍すれば\n平日の離乳食がグッとラクになりますよ🙌\n\nもっとコツを知りたい方はこちら👇\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食レシピ #冷凍ストック #離乳食作り #時短育児 #赤ちゃんごはん #育児 #ママライフ #離乳食記録 #子育て',
    '💡 離乳食のコツ\n\n【野菜の下ごしらえを時短！】\n\nにんじん🥕 → すりおろして冷凍\nかぼちゃ🎃 → レンチン3分でマッシュ\nほうれん草🥬 → 茹でて水にさらしアク抜き\nしらす → 茶こしで熱湯かけるだけ\n\n日曜日にまとめて仕込めば\n1週間分の離乳食準備が完了✨\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食作り #下ごしらえ #時短レシピ #赤ちゃんごはん #育児 #ママライフ #離乳食記録 #子育て #離乳食レシピ',
    '💡 離乳食のコツ\n\n【初めての食材は「1さじから」】\n\n新しい食材を試すときのルール📝\n\n1️⃣ 午前中に試す（アレルギー対応のため）\n2️⃣ 1さじから始める\n3️⃣ 2〜3日同じ食材を続ける\n4️⃣ 体調が良い日に試す\n\n焦らずゆっくりで大丈夫👶💕\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食初期 #アレルギー #赤ちゃんごはん #育児 #新米ママ #ママライフ #離乳食記録 #子育て #離乳食デビュー',
  ],
  stage: [
    '📋 7ヶ月の離乳食ガイド\n\n【モグモグ期スタート！】\n\n✅ 2回食に進む時期\n✅ 舌でつぶせる固さが目安\n✅ 新しい食材にチャレンジ\n\n🆕 この時期に始められる食材:\n・豆腐\n・白身魚\n・ヨーグルト\n・パン粥\n\nゆっくりペースで大丈夫🌱\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食中期 #7ヶ月 #モグモグ期 #赤ちゃんごはん #育児 #ママライフ #離乳食記録 #子育て #離乳食メモ',
    '📋 9ヶ月の離乳食ガイド\n\n【カミカミ期到来！】\n\n✅ 3回食に慣れてきた頃\n✅ 歯ぐきでつぶせる固さ\n✅ 手づかみ食べの練習開始\n\n🍴 おすすめ手づかみメニュー:\n・やわらかスティック野菜\n・小さめおにぎり\n・蒸しパン\n\n食べる意欲を大切に👶✨\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食後期 #9ヶ月 #カミカミ期 #手づかみ食べ #赤ちゃんごはん #育児 #ママライフ #離乳食記録 #子育て',
    '📋 12ヶ月の離乳食ガイド\n\n【パクパク期！もうすぐ完了】\n\n✅ 大人の取り分けOK（薄味で）\n✅ 自分で食べたがる時期\n✅ コップ飲みの練習も\n\n🎉 食べられるものが増えた！:\n・薄味の煮物\n・やわらかいお肉\n・果物いろいろ\n\nここまで頑張ったママパパ最高👏\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食完了期 #1歳 #パクパク期 #赤ちゃんごはん #育児 #ママライフ #離乳食記録 #子育て #離乳食卒業',
  ],
  relatable: [
    '離乳食あるある😂\n\n「1時間かけて作った力作、3口で終了」\n\n…ってなりますよね💦\n\nでも大丈夫！\nその3口を食べてくれただけで\n今日は💯点満点です💮\n\n頑張ってるママパパ、\n自分を褒めてあげてくださいね🫶\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食あるある #育児あるある #ママあるある #赤ちゃんごはん #育児 #ママライフ #子育て #離乳食記録 #ママパパ応援',
    '離乳食あるある😂\n\n「昨日パクパク食べたのに\n今日は一口も食べない」\n\n赤ちゃんの気分は\n日替わりメニューです🫠\n\nそんな日もあるさ！\n食べなかった日は\nまた明日チャレンジすればOK👍\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食あるある #育児あるある #赤ちゃんごはん #育児 #ママライフ #子育て #離乳食記録 #ママパパ応援 #離乳食拒否',
    '離乳食あるある😂\n\n「スプーンを奪い取って\n自分で食べたがる👶」\n\n周りは大惨事だけど…\n実はこれ、すごい成長の証なんです✨\n\n自分で食べる意欲＝自立の第一歩🌱\n（掃除は…頑張りましょう😇）\n\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食あるある #育児あるある #手づかみ食べ #赤ちゃんごはん #育児 #ママライフ #子育て #離乳食記録 #赤ちゃん成長',
  ],
  promo: [
    '📱 離乳食アプリ MoguMogu\n\n毎日の離乳食に悩んでいませんか？\n\nMoguMoguなら全部解決✨\n\n✅ 月齢に合わせたレシピ動画\n✅ AIに24時間いつでも相談\n✅ アレルギー食材チェック\n✅ 完全無料で使い放題！\n\n10万人のママパパが使ってます🍼\n\n今すぐチェック👇\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食アプリ #離乳食レシピ #赤ちゃんごはん #育児 #ママライフ #子育て #無料アプリ #離乳食記録 #AI育児',
    '🍼 MoguMoguで離乳食をもっとラクに\n\n「今日の離乳食どうしよう…」\nそんな毎日のお悩み、解決します！\n\n🎬 レシピ動画が見放題\n🤖 AIが24時間相談に乗ります\n📋 月齢別の食材チェック\n💰 全部無料！\n\nダウンロード不要✨\nブラウザですぐ使えます👇\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食アプリ #育児 #ママライフ #離乳食レシピ #赤ちゃんごはん #子育て #無料 #離乳食記録 #新米ママ',
    '✨ 離乳食の強い味方！MoguMogu\n\n初期〜完了期まで\n月齢に合ったレシピが すぐ見つかる📱\n\n🔍 食材から レシピ検索\n📹 動画で わかりやすい\n💬 困ったら AIに質問\n🆓 全機能 完全無料\n\n離乳食ライフを もっと楽しく🌈\nhttps://mogumogu-omega.vercel.app\n\n#離乳食 #離乳食レシピ #離乳食アプリ #赤ちゃんごはん #育児 #ママライフ #子育て #無料アプリ #離乳食記録 #離乳食動画',
  ],
};

async function handleInstagram(req, res) {
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igUserId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!igToken || !igUserId) {
    return res.status(200).json({ error: 'INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_BUSINESS_ACCOUNT_ID not configured' });
  }

  // 投稿タイプ判定（曜日ベース: 月=recipe, 火=tip, 水=stage, 木=relatable, 金=promo）
  let type = req.query.type;
  if (!type) {
    const day = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();
    const weekdayTypes = { 1: 'recipe', 2: 'tip', 3: 'stage', 4: 'relatable', 5: 'promo' };
    type = weekdayTypes[day] || 'recipe';
  }

  // 過去の投稿を取得（重複回避）
  let pastCaptions = [];
  try {
    const { data } = await supabase
      .from('instagram_posts').select('caption')
      .eq('post_type', type).order('posted_at', { ascending: false }).limit(5);
    pastCaptions = (data || []).map(p => p.caption);
  } catch (e) { console.error('instagram_posts query failed:', e.message); }

  // AI キャプション + 画像プロンプト生成
  let caption = null;
  let imagePrompt = null;
  const raw = await generateInstagramContent(type, pastCaptions);
  if (raw) {
    try {
      const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      caption = parsed.caption;
      imagePrompt = parsed.image_prompt;
    } catch {
      caption = raw.replace(/^["']|["']$/g, '').trim();
      if (caption.length > 2200) caption = caption.slice(0, 2197) + '…';
    }
  }

  // キャプションフォールバック
  if (!caption) {
    const pool = FALLBACK_IG[type] || FALLBACK_IG.recipe;
    const unused = pool.filter(t => !pastCaptions.includes(t));
    const src = unused.length > 0 ? unused : pool;
    caption = src[Math.floor(Math.random() * src.length)];
  }

  // 画像生成
  let publicImageUrl = null;
  const openaiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;

  if (openaiKey) {
    try {
      const prompt = imagePrompt || getDefaultImagePrompt(type);
      const tempUrl = await generateImage(prompt, openaiKey);
      if (tempUrl) {
        publicImageUrl = await uploadImageToStorage(tempUrl);
      }
    } catch (e) {
      console.error('Image generation failed:', e.message);
    }
  }

  // フォールバック: Supabase Storage から画像取得
  if (!publicImageUrl) {
    publicImageUrl = await getRandomStorageImage(type);
  }

  if (!publicImageUrl) {
    return res.status(200).json({
      error: 'No image available. Set OPENAI_API_KEY for DALL-E or upload images to instagram-images bucket in Supabase Storage.',
      type,
      caption_preview: caption.slice(0, 100),
    });
  }

  // Instagram Graph API で投稿
  const result = await postToInstagram(publicImageUrl, caption, igUserId, igToken);

  // 履歴保存
  try {
    await supabase.from('instagram_posts').insert({
      post_type: type,
      caption,
      image_url: publicImageUrl,
      ig_media_id: result.id || null,
    });
  } catch (e) { console.error('instagram_posts insert failed:', e.message); }

  if (result.id) {
    return res.json({ success: true, platform: 'instagram', ig_media_id: result.id, type, caption_length: caption.length });
  }
  return res.status(200).json({ error: result.error?.message || 'Instagram post failed', type, raw: result });
}

// =============================================================
// ===== メインハンドラ =====
// =============================================================

module.exports = async (req, res) => {
  const platform = req.query.platform || 'instagram';
  try {
    switch (platform) {
      case 'x': return await handleX(req, res);
      case 'instagram': return await handleInstagram(req, res);
      default: return res.status(400).json({ error: 'Invalid platform. Use ?platform=x or ?platform=instagram' });
    }
  } catch (err) {
    console.error(`auto-post [${platform}] error:`, err);
    return res.status(500).json({ error: err.message });
  }
};
