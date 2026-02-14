/*
Supabase テーブル作成SQL:

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

-- LINE配信履歴テーブル
CREATE TABLE IF NOT EXISTS line_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_type TEXT,
  content TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE line_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "line_broadcasts_service_all" ON line_broadcasts FOR ALL USING (true) WITH CHECK (true);
*/

const crypto = require('crypto');
const { supabase } = require('./_lib/auth');

// ===== OAuth 1.0a 署名 =====
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

// ===== X API v2 投稿 =====
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

// ===== AI 生成 =====
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

// ===== フォールバック =====
const FALLBACK = {
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

// ===== メインハンドラ =====
module.exports = async (req, res) => {
  try {
    if (!process.env.X_API_KEY) {
      return res.status(200).json({ error: 'X_API_KEY is not configured' });
    }

    // 投稿タイプ判定
    let type = req.query.type;
    if (!type) {
      const hour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours(); // JST
      if (hour >= 6 && hour < 10) type = 'tip';
      else if (hour >= 10 && hour < 15) type = 'stage';
      else if (hour >= 19 && hour < 23) type = 'relatable';
      else type = 'promo';
    }

    // 過去の投稿を取得（重複回避）
    let pastContents = [];
    try {
      const { data } = await supabase
        .from('x_posts')
        .select('content')
        .eq('post_type', type)
        .order('posted_at', { ascending: false })
        .limit(10);
      pastContents = (data || []).map(p => p.content);
    } catch (e) {
      console.error('x_posts query failed:', e.message);
    }

    // AI で投稿テキスト生成
    let tweetText = null;
    const raw = await generateTweetText(type, pastContents);
    if (raw) {
      try {
        const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        tweetText = parsed.text;
      } catch {
        // JSON パース失敗 → テキストをそのまま使用（140字以内に切る）
        tweetText = raw.replace(/^["']|["']$/g, '').trim();
        if (tweetText.length > 140) tweetText = tweetText.slice(0, 137) + '…';
      }
    }

    // フォールバック
    if (!tweetText) {
      const pool = FALLBACK[type] || FALLBACK.tip;
      const unused = pool.filter(t => !pastContents.includes(t));
      tweetText = (unused.length > 0 ? unused : pool)[Math.floor(Math.random() * (unused.length > 0 ? unused : pool).length)];
    }

    // X に投稿
    const result = await postTweet(tweetText);

    // 履歴保存
    try {
      await supabase.from('x_posts').insert({
        post_type: type,
        content: tweetText,
        tweet_id: result.data?.id || null,
      });
    } catch (e) {
      console.error('x_posts insert failed:', e.message);
    }

    if (result.data?.id) {
      return res.json({ success: true, tweet_id: result.data.id, text: tweetText });
    } else {
      return res.status(200).json({ error: result.detail || result.title || 'Post failed', text: tweetText, raw: result });
    }
  } catch (err) {
    console.error('auto-post-x error:', err);
    return res.status(500).json({ error: err.message });
  }
};
