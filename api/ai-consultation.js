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

// 月齢に応じたフォールバック応答
function getFallbackReply(message, babyMonth) {
  const stage = babyMonth <= 6 ? '初期' : babyMonth <= 8 ? '中期' : babyMonth <= 11 ? '後期' : '完了期';
  const stageInfo = {
    '初期': 'ゴックン期（5〜6ヶ月）は、10倍がゆやなめらかにすりつぶした野菜ペーストから始めましょう。1日1回、小さじ1杯から少しずつ増やしていきます。',
    '中期': 'モグモグ期（7〜8ヶ月）は、舌でつぶせる硬さが目安です。おかゆは7倍がゆに。タンパク質（豆腐、白身魚、しらす）も取り入れましょう。',
    '後期': 'カミカミ期（9〜11ヶ月）は、歯ぐきでつぶせる硬さが目安。手づかみ食べもOK！バナナやスティック野菜がおすすめです。',
    '完了期': 'パクパク期（12ヶ月〜）は、大人の食事から取り分けもできます。薄味を心がけて、いろいろな食材を試してみましょう。',
  };

  return `ご質問ありがとうございます！🍙

${babyMonth}ヶ月の赤ちゃんの離乳食についてですね。

${stageInfo[stage]}

離乳食で困ったことがあれば、かかりつけの小児科や地域の保健センターにも相談してみてくださいね。

※ 現在AIサービスに接続できないため、一般的なアドバイスをお伝えしています。しばらく経ってからもう一度お試しください。`;
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

  // --- レート制限（テーブルが無くてもスキップ） ---
  let isPremium = false;
  try {
    isPremium = await getIsPremium(user.id);
  } catch (e) {
    console.error('getIsPremium error:', e);
  }

  if (!isPremium) {
    try {
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
    } catch (e) {
      // ai_consultations テーブルが無い場合はスキップ
      console.error('Rate limit check skipped:', e.message);
    }
  }

  // --- OpenAI APIキーチェック ---
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set');
    // フォールバック応答を返す
    return res.status(200).json({
      reply: getFallbackReply(message, babyMonth),
      usage: { used: 0, limit: isPremium ? null : CONSULTATION_LIMIT_FREE },
    });
  }

  // --- プロンプト組み立て ---
  const systemPrompt = buildSystemPrompt(babyMonth, allergens);
  const messages = [{ role: 'system', content: systemPrompt }];

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
        'Authorization': `Bearer ${apiKey}`,
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
      // OpenAIエラー時もフォールバック応答を返す
      return res.status(200).json({
        reply: getFallbackReply(message, babyMonth),
        usage: { used: 0, limit: isPremium ? null : CONSULTATION_LIMIT_FREE },
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      return res.status(200).json({
        reply: getFallbackReply(message, babyMonth),
        usage: { used: 0, limit: isPremium ? null : CONSULTATION_LIMIT_FREE },
      });
    }

    // --- 使用量を記録（テーブルが無くてもエラーにしない） ---
    try {
      await supabase.from('ai_consultations').insert({
        user_id: user.id,
        message: message.trim().slice(0, 500),
        reply: reply.slice(0, 2000),
      });
    } catch (e) {
      console.error('Failed to record consultation:', e.message);
    }

    let usedCount = 0;
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from('ai_consultations')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', todayStart.toISOString());
      usedCount = count || 0;
    } catch (e) {
      // テーブルが無い場合はスキップ
    }

    return res.status(200).json({
      reply,
      usage: {
        used: usedCount,
        limit: isPremium ? null : CONSULTATION_LIMIT_FREE,
      },
    });
  } catch (err) {
    console.error('ai-consultation error:', err);
    // 最後のフォールバック
    return res.status(200).json({
      reply: getFallbackReply(message, babyMonth),
      usage: { used: 0, limit: isPremium ? null : CONSULTATION_LIMIT_FREE },
    });
  }
};
