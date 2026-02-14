const { verifyUser, getIsPremium, getTodaySearchCount, recordSearch } = require('./_lib/auth');

const SEARCH_LIMIT_FREE = 3;

const SYSTEM_PROMPT = `あなたは離乳食の専門家です。
ユーザーが入力した食材を使った離乳食レシピを提案してください。

ルール:
1. 赤ちゃんの月齢に適した硬さ・大きさにすること
2. 指定されたアレルゲン食材は絶対に使わないこと
3. 調味料は月齢に応じて最小限にすること
4. 栄養バランスを考慮すること
5. 調理時間は15分以内を目安にすること

月齢の目安:
- 5〜6ヶ月（初期）: ペースト状、1食材ずつ
- 7〜8ヶ月（中期）: 舌でつぶせる硬さ、2〜3食材の組み合わせ
- 9〜11ヶ月（後期）: 歯ぐきでつぶせる硬さ、味付け薄め
- 12〜18ヶ月（完了期）: 歯ぐきで噛める硬さ、大人の取り分けOK

必ず以下のJSON形式で回答してください:
{
  "recipes": [
    {
      "title": "レシピ名",
      "description": "一言説明",
      "baby_month_range": "7〜8ヶ月",
      "cooking_time": "10分",
      "ingredients": ["にんじん 30g", "豆腐 40g", "だし汁 大さじ2"],
      "steps": ["にんじんを柔らかく茹でてみじん切りにする"],
      "nutrition": "ビタミンA、タンパク質、カルシウム",
      "tips": "にんじんは電子レンジ加熱でもOK",
      "difficulty": "簡単"
    }
  ]
}`;

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
  const { ingredients, baby_month, allergens, count } = req.body;

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients は1つ以上の食材を含む配列で指定してください' });
  }
  if (!baby_month || typeof baby_month !== 'number' || baby_month < 5 || baby_month > 18) {
    return res.status(400).json({ error: 'baby_month は 5〜18 の数値で指定してください' });
  }

  const recipeCount = Math.min(Math.max(count || 5, 1), 10);

  // --- レート制限 ---
  const isPremium = await getIsPremium(user.id);
  if (!isPremium) {
    const used = await getTodaySearchCount(user.id);
    if (used >= SEARCH_LIMIT_FREE) {
      return res.status(429).json({
        error: '本日の検索回数の上限（3回）に達しました',
        limit: SEARCH_LIMIT_FREE,
        used,
      });
    }
  }

  // --- ユーザープロンプト組み立て ---
  const ingredientText = ingredients.join('、');
  const allergenText = Array.isArray(allergens) && allergens.length > 0
    ? `\n除外アレルゲン: ${allergens.join('、')}`
    : '';

  const userMessage = [
    `食材: ${ingredientText}`,
    `赤ちゃんの月齢: ${baby_month}ヶ月`,
    allergenText,
    `${recipeCount}品のレシピを提案してください。`,
  ].filter(Boolean).join('\n');

  // --- OpenAI API 呼び出し ---
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 2500,
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

    // recipes が配列直接 or { recipes: [...] } どちらの形式でも対応
    const recipes = Array.isArray(parsed) ? parsed : (parsed.recipes || []);

    // --- 使用量を記録 ---
    await recordSearch(user.id, ingredientText);

    const used = isPremium ? 0 : await getTodaySearchCount(user.id);

    return res.status(200).json({
      recipes,
      usage: {
        used,
        limit: isPremium ? null : SEARCH_LIMIT_FREE,
      },
    });

  } catch (err) {
    console.error('search-recipe error:', err);
    return res.status(500).json({ error: 'サーバー内部エラーが発生しました' });
  }
};
