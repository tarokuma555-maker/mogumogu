const { verifyUser, getIsPremium } = require('./_lib/auth');
const { supabase } = require('./_lib/auth');

const CONSULTATION_LIMIT_FREE = 3;

function buildSystemPrompt(babyMonth, allergens) {
  const allergenText = Array.isArray(allergens) && allergens.length > 0
    ? allergens.join('、')
    : 'なし';

  return `あなたは離乳食と育児の専門家（管理栄養士・保育士資格保持）です。
ママ・パパからの離乳食や育児に関する相談に、やさしく丁寧に回答してください。

赤ちゃんの情報:
- 月齢: ${babyMonth}ヶ月
- アレルギー除外食材: ${allergenText}

回答のルール:
- 日本語で回答
- 簡潔で分かりやすい表現を使う（200〜400文字程度）
- 具体的なアドバイスや例を含める
- 月齢に適した食材・調理法を提案
- アレルギーに配慮した回答をする
- 医療的な判断が必要な場合は「かかりつけ医に相談してください」と伝える
- 絵文字を適度に使って親しみやすい回答にする`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- 認証 ---
  const { user, error: authError } = await verifyUser(req);
  if (!user) {
    return res.status(401).json({ error: authError || '認証が必要です' });
  }

  const { message, baby_month, allergens, history } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'メッセージを入力してください' });
  }

  const babyMonth = baby_month || 6;

  // --- レート制限 ---
  const isPremium = await getIsPremium(user.id);
  if (!isPremium) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('ai_consultations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', todayStart.toISOString());

    const used = count || 0;
    if (used >= CONSULTATION_LIMIT_FREE) {
      return res.status(429).json({
        error: '本日のAI相談回数の上限（3回）に達しました',
        limit: CONSULTATION_LIMIT_FREE,
        used,
      });
    }
  }

  // --- プロンプト組み立て ---
  const systemPrompt = buildSystemPrompt(babyMonth, allergens);
  const messages = [{ role: 'system', content: systemPrompt }];

  // 会話履歴を追加（最新10往復まで）
  if (Array.isArray(history)) {
    const recentHistory = history.slice(-20);
    for (const h of recentHistory) {
      if (h.role === 'user' || h.role === 'assistant') {
        messages.push({ role: h.role, content: h.content });
      }
    }
  }

  messages.push({ role: 'user', content: message.trim() });

  // --- OpenAI API 呼び出し ---
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('OpenAI API error:', response.status, errBody);
      return res.status(502).json({ error: 'AIサービスでエラーが発生しました' });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      return res.status(502).json({ error: 'AIから応答を取得できませんでした' });
    }

    // --- 使用量を記録 ---
    await supabase.from('ai_consultations').insert({
      user_id: user.id,
      message: message.trim().slice(0, 500),
      reply: reply.slice(0, 2000),
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: usedCount } = await supabase
      .from('ai_consultations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', todayStart.toISOString());

    return res.status(200).json({
      reply,
      usage: {
        used: usedCount || 0,
        limit: isPremium ? null : CONSULTATION_LIMIT_FREE,
      },
    });
  } catch (err) {
    console.error('ai-consultation error:', err);
    return res.status(500).json({ error: 'サーバー内部エラーが発生しました' });
  }
};
