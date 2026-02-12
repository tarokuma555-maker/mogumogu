const { verifyUser, getIsPremium, getTodayRecipeGenCount, recordRecipeGen } = require('./_lib/auth');

const RECIPE_GEN_LIMIT_FREE = 1;

function buildSystemPrompt({ baby_month, allergens, preference, meal_type, count }) {
  const allergenText = Array.isArray(allergens) && allergens.length > 0
    ? allergens.join('、')
    : 'なし';

  return `あなたは管理栄養士資格を持つ離乳食の専門家です。
指定された条件に合わせて、オリジナルの離乳食レシピを
${count}品 考案してください。

条件:
- 赤ちゃんの月齢: ${baby_month}ヶ月
- 除外アレルゲン: ${allergenText}
- 好み: ${preference || '特になし'}
- 食事タイプ: ${meal_type || '指定なし'}

必ず以下のJSON形式で回答:
{
  "recipes": [
    {
      "title": "レシピ名",
      "catch_copy": "キャッチコピー（例: ふわふわ食感で笑顔に）",
      "description": "このレシピのポイント",
      "baby_month_range": "対象月齢",
      "cooking_time": "調理時間",
      "ingredients": ["食材名 分量", ...],
      "steps": ["手順1", "手順2", ...],
      "nutrition_info": {
        "main": "主な栄養素",
        "calories_approx": "おおよそのカロリー"
      },
      "tips": "調理のコツ",
      "storage": "保存方法と保存期間",
      "freezable": true,
      "difficulty": "簡単/普通/やや手間"
    }
  ]
}`;
}

module.exports = async function handler(req, res) {
  // CORS
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

  // --- リクエストボディ検証 ---
  const { baby_month, allergens, preference, meal_type, count } = req.body;

  if (!baby_month || typeof baby_month !== 'number' || baby_month < 5 || baby_month > 18) {
    return res.status(400).json({ error: 'baby_month は 5〜18 の数値で指定してください' });
  }

  const recipeCount = Math.min(Math.max(count || 3, 1), 10);

  // --- レート制限 ---
  const isPremium = await getIsPremium(user.id);
  if (!isPremium) {
    const used = await getTodayRecipeGenCount(user.id);
    if (used >= RECIPE_GEN_LIMIT_FREE) {
      return res.status(429).json({
        error: '本日のAIレシピ生成回数の上限（1回）に達しました',
        limit: RECIPE_GEN_LIMIT_FREE,
        used,
      });
    }
  }

  // --- プロンプト組み立て ---
  const systemPrompt = buildSystemPrompt({
    baby_month,
    allergens,
    preference,
    meal_type,
    count: recipeCount,
  });

  const userMessage = `${baby_month}ヶ月の赤ちゃん向けに${meal_type ? meal_type + 'の' : ''}離乳食レシピを${recipeCount}品お願いします。${preference ? '好み: ' + preference + '。' : ''}バリエーション豊かに提案してください。`;

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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.8,
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('OpenAI API error:', response.status, errBody);
      return res.status(502).json({ error: 'AIサービスでエラーが発生しました' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('OpenAI returned empty content');
      return res.status(502).json({ error: 'AIから応答を取得できませんでした' });
    }

    // --- JSONパース（コードブロック記法を除去してからパース） ---
    let parsed;
    try {
      const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('JSON parse failed:', e.message, '\nRaw content:', content);
      return res.status(502).json({ error: 'AIの応答を解析できませんでした' });
    }

    // recipes が配列直接 or { recipes: [...] } どちらでも対応
    const recipes = Array.isArray(parsed) ? parsed : (parsed.recipes || []);

    // --- 使用量を記録 ---
    await recordRecipeGen(user.id);

    const used = isPremium ? 0 : await getTodayRecipeGenCount(user.id);

    return res.status(200).json({
      recipes,
      usage: {
        used,
        limit: isPremium ? null : RECIPE_GEN_LIMIT_FREE,
      },
    });

  } catch (err) {
    console.error('generate-recipe error:', err);
    return res.status(500).json({ error: 'サーバー内部エラーが発生しました' });
  }
};
