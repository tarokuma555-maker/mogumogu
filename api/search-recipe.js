/*
Supabase テーブル作成SQL:

CREATE TABLE cached_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  emoji TEXT DEFAULT '🍽️',
  stage TEXT,
  time INT DEFAULT 15,
  difficulty INT DEFAULT 1,
  ingredients TEXT[] DEFAULT '{}',
  ingredients_text TEXT,
  steps TEXT[] DEFAULT '{}',
  nutrition JSONB DEFAULT '{}',
  tip TEXT,
  tags TEXT[] DEFAULT '{}',
  baby_month_min INT DEFAULT 5,
  baby_month_max INT DEFAULT 18,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cached_recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cached_recipes_service_all" ON cached_recipes FOR ALL USING (true) WITH CHECK (true);
*/

const { supabase, verifyUser, getIsPremium, getTodaySearchCount, recordSearch } = require('./_lib/auth');

const SEARCH_LIMIT_FREE = 3;

const STAGE_MAP = { 5: 'ゴックン期', 6: 'ゴックン期', 7: 'モグモグ期', 8: 'モグモグ期', 9: 'カミカミ期', 10: 'カミカミ期', 11: 'カミカミ期', 12: 'パクパク期', 13: 'パクパク期', 14: 'パクパク期', 15: 'パクパク期', 16: 'パクパク期', 17: 'パクパク期', 18: 'パクパク期' };
const MONTH_FOR_STAGE = { 'ゴックン期': { min: 5, max: 6 }, 'モグモグ期': { min: 7, max: 8 }, 'カミカミ期': { min: 9, max: 11 }, 'パクパク期': { min: 12, max: 18 } };

const EMOJI_MAP = {
  'にんじん': '🥕', 'かぼちゃ': '🎃', '豆腐': '🫧', 'バナナ': '🍌', 'しらす': '🐟',
  'さつまいも': '🍠', 'ほうれん草': '🥬', 'トマト': '🍅', 'りんご': '🍎', 'おかゆ': '🍚',
  'うどん': '🍜', '鮭': '🐟', 'ヨーグルト': '🥛', '卵': '🥚', 'パン': '🍞',
  'ブロッコリー': '🥦', 'じゃがいも': '🥔', 'コーン': '🌽', 'チーズ': '🧀', '鶏': '🍗',
  'ひき肉': '🥩', '白身魚': '🐟', '納豆': '🫘', 'オートミール': '🥣', 'アボカド': '🥑',
};

const SYSTEM_PROMPT = `あなたは離乳食の専門家です。
ユーザーが入力した食材を使った離乳食レシピを提案してください。

ルール:
1. 赤ちゃんの月齢に適した硬さ・大きさにすること
2. 指定されたアレルゲン食材は絶対に使わないこと
3. 調味料は月齢に応じて最小限にすること
4. 栄養バランスを考慮すること
5. 調理時間は15分以内を目安にすること

月齢→ステージ対応:
- 5〜6ヶ月 → ゴックン期（ペースト状、1食材ずつ）
- 7〜8ヶ月 → モグモグ期（舌でつぶせる硬さ、2〜3食材）
- 9〜11ヶ月 → カミカミ期（歯ぐきでつぶせる硬さ、味付け薄め）
- 12〜18ヶ月 → パクパク期（歯ぐきで噛める硬さ、大人の取り分けOK）

必ず以下のJSON形式で回答してください:
{
  "recipes": [
    {
      "title": "レシピ名",
      "emoji": "🥕（メイン食材に合った絵文字1つ）",
      "stage": "モグモグ期（上記の対応表から選ぶ）",
      "time": 10,
      "difficulty": 1,
      "ingredients": ["にんじん 30g", "豆腐 40g", "だし汁 大さじ2"],
      "steps": ["にんじんを柔らかく茹でてみじん切りにする", "..."],
      "nutrition": { "kcal": 50, "protein": 2.0, "iron": 0.5, "vitA": "◎", "vitC": "○" },
      "tip": "にんじんは電子レンジ加熱でもOK",
      "tags": ["にんじん", "豆腐"]
    }
  ]
}

注意:
- emoji: メイン食材の絵文字を1つ
- stage: ゴックン期/モグモグ期/カミカミ期/パクパク期 のいずれか
- time: 数値（分）
- difficulty: 1（簡単）、2（普通）、3（やや手間）の数値
- nutrition: kcal(数値), protein(数値g), iron(数値mg), vitA(◎/○/△/−), vitC(◎/○/△/−)
- 各レシピは必ず異なるタイトルにすること`;

// ===== 正規化 =====
function normalizeRecipe(r, babyMonth) {
  const firstIng = (r.ingredients?.[0] || '').replace(/[\d\s０-９.]+[gｇ個本枚切片適量少々大さじ小ml]*/gi, '').trim();
  const emoji = r.emoji || EMOJI_MAP[firstIng] || Object.entries(EMOJI_MAP).find(([k]) => (r.title || '').includes(k))?.[1] || '🍽️';
  const stage = r.stage && Object.keys(MONTH_FOR_STAGE).includes(r.stage) ? r.stage : (STAGE_MAP[babyMonth] || 'モグモグ期');
  const time = typeof r.time === 'number' ? r.time : parseInt(r.cooking_time || r.time) || 15;
  const diff = typeof r.difficulty === 'number' ? Math.min(Math.max(r.difficulty, 1), 3)
    : r.difficulty === '簡単' ? 1 : r.difficulty === 'やや手間' ? 3 : r.difficulty === '普通' ? 2 : 1;
  const nut = (typeof r.nutrition === 'object' && r.nutrition !== null && 'kcal' in r.nutrition)
    ? r.nutrition
    : { kcal: 0, protein: 0, iron: 0, vitA: '−', vitC: '−' };

  return {
    id: r.id || `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: r.title || '離乳食レシピ',
    emoji, stage, time, difficulty: diff,
    ingredients: r.ingredients || [],
    steps: r.steps || [],
    nutrition: nut,
    tip: r.tip || r.tips || '',
    tags: r.tags || [],
  };
}

// ===== キャッシュ検索 =====
async function searchCache(ingredients, babyMonth, excludeTitles, limit) {
  try {
    const orConditions = ingredients.map(i => `ingredients_text.ilike.%${i}%`).join(',');
    const { data, error } = await supabase
      .from('cached_recipes')
      .select('*')
      .or(orConditions)
      .lte('baby_month_min', babyMonth)
      .gte('baby_month_max', babyMonth)
      .order('created_at', { ascending: false })
      .limit(limit + excludeTitles.length + 10);

    if (error || !data) return [];

    return data
      .filter(r => !excludeTitles.includes(r.title))
      .slice(0, limit)
      .map(r => ({
        id: r.id,
        title: r.title,
        emoji: r.emoji || '🍽️',
        stage: r.stage || STAGE_MAP[babyMonth] || 'モグモグ期',
        time: r.time || 15,
        difficulty: r.difficulty || 1,
        ingredients: r.ingredients || [],
        steps: r.steps || [],
        nutrition: r.nutrition || { kcal: 0, protein: 0, iron: 0, vitA: '−', vitC: '−' },
        tip: r.tip || '',
        tags: r.tags || [],
      }));
  } catch (e) {
    console.error('Cache search error:', e.message);
    return [];
  }
}

// ===== キャッシュ保存 =====
async function cacheRecipes(recipes, babyMonth) {
  const stageRange = MONTH_FOR_STAGE[recipes[0]?.stage] || MONTH_FOR_STAGE[STAGE_MAP[babyMonth]] || { min: 5, max: 18 };
  const rows = recipes.map(r => ({
    title: r.title,
    emoji: r.emoji,
    stage: r.stage,
    time: r.time,
    difficulty: r.difficulty,
    ingredients: r.ingredients,
    ingredients_text: r.ingredients.map(i => i.replace(/[\d\s０-９.]+[gｇ個本枚切片適量少々大さじ小ml]*/gi, '').trim()).filter(Boolean).join(' '),
    steps: r.steps,
    nutrition: r.nutrition,
    tip: r.tip,
    tags: r.tags,
    baby_month_min: stageRange.min,
    baby_month_max: stageRange.max,
  }));

  try {
    await supabase.from('cached_recipes').insert(rows);
  } catch (e) {
    console.error('Cache insert failed:', e.message);
  }
}

// ===== AI 生成 =====
async function generateRecipesAI(ingredients, babyMonth, allergens, count, excludeTitles) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
  if (!apiKey) return [];

  const allergenText = Array.isArray(allergens) && allergens.length > 0
    ? `\n除外アレルゲン: ${allergens.join('、')}` : '';
  const excludeText = excludeTitles.length > 0
    ? `\n以下のレシピ名は既出なので別のレシピにしてください: ${excludeTitles.join('、')}` : '';

  const userMessage = [
    `食材: ${ingredients.join('、')}`,
    `赤ちゃんの月齢: ${babyMonth}ヶ月`,
    allergenText,
    `${count}品のレシピを提案してください。バリエーション豊かにお願いします。`,
    excludeText,
  ].filter(Boolean).join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
      temperature: 0.85,
      max_tokens: 3000,
    }),
  });

  if (!response.ok) { console.error('OpenAI error:', response.status); return []; }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return [];

  try {
    const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const raw = Array.isArray(parsed) ? parsed : (parsed.recipes || []);
    return raw.map(r => normalizeRecipe(r, babyMonth));
  } catch (e) {
    console.error('JSON parse failed:', e.message);
    return [];
  }
}

// ===== POST: レシピ検索 =====
async function handleSearch(req, res) {
  const { user, error: authError } = await verifyUser(req);
  if (!user) return res.status(401).json({ error: authError || '認証が必要です' });

  const { ingredients, baby_month, allergens, count, exclude_titles } = req.body;

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients は1つ以上の食材を含む配列で指定してください' });
  }
  if (!baby_month || typeof baby_month !== 'number' || baby_month < 5 || baby_month > 18) {
    return res.status(400).json({ error: 'baby_month は 5〜18 の数値で指定してください' });
  }

  const recipeCount = Math.min(Math.max(count || 5, 1), 10);
  const excludeTitles = Array.isArray(exclude_titles) ? exclude_titles : [];
  const isPremium = await getIsPremium(user.id);

  // Step 1: キャッシュから検索
  const cached = await searchCache(ingredients, baby_month, excludeTitles, recipeCount);

  if (cached.length >= recipeCount) {
    return res.json({ recipes: cached.slice(0, recipeCount), from_cache: true, has_more: true });
  }

  // Step 2: AI 生成（レート制限チェック）
  if (!isPremium) {
    const used = await getTodaySearchCount(user.id);
    if (used >= SEARCH_LIMIT_FREE) {
      if (cached.length > 0) {
        return res.json({ recipes: cached, from_cache: true, has_more: false, usage: { used, limit: SEARCH_LIMIT_FREE } });
      }
      return res.status(429).json({ error: '本日の検索回数の上限（3回）に達しました', limit: SEARCH_LIMIT_FREE, used });
    }
  }

  const allExclude = [...excludeTitles, ...cached.map(r => r.title)];
  const needed = recipeCount - cached.length;
  const aiRecipes = await generateRecipesAI(ingredients, baby_month, allergens, needed, allExclude);

  // キャッシュに保存
  if (aiRecipes.length > 0) {
    await cacheRecipes(aiRecipes, baby_month);
  }

  // 使用量記録（AI を使った場合のみ）
  await recordSearch(user.id, ingredients.join('、'));
  const used = isPremium ? 0 : await getTodaySearchCount(user.id);

  const combined = [...cached, ...aiRecipes];
  return res.json({
    recipes: combined,
    has_more: true,
    usage: { used, limit: isPremium ? null : SEARCH_LIMIT_FREE },
  });
}

// ===== GET: バッチ生成（Cron） =====
async function handleBatch(req, res) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
  if (!apiKey) return res.json({ error: 'No AI key' });

  const ALL_INGREDIENTS = [
    'にんじん', 'かぼちゃ', 'さつまいも', 'ほうれん草', 'ブロッコリー',
    'バナナ', 'りんご', '豆腐', 'しらす', '鶏ささみ', 'うどん',
    'トマト', 'じゃがいも', '大根', 'キャベツ', 'たまねぎ', '鮭',
    'ヨーグルト', 'オートミール', '納豆', 'ツナ', 'コーン', '枝豆',
    '卵', 'パン', '白身魚', 'ひき肉', 'チーズ', 'きゅうり', 'アボカド',
  ];
  const MONTHS = [5, 6, 7, 8, 9, 10, 12, 15, 18];

  const shuffled = [...ALL_INGREDIENTS].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 1 + Math.floor(Math.random() * 2));
  const month = MONTHS[Math.floor(Math.random() * MONTHS.length)];

  const recipes = await generateRecipesAI(selected, month, [], 5, []);
  if (recipes.length > 0) {
    await cacheRecipes(recipes, month);
  }

  return res.json({ success: true, cached: recipes.length, ingredients: selected, month });
}

// ===== メインハンドラ =====
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET' && req.query.action === 'batch') {
      return await handleBatch(req, res);
    }
    if (req.method === 'POST') {
      return await handleSearch(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('search-recipe error:', err);
    return res.status(500).json({ error: 'サーバー内部エラーが発生しました' });
  }
};
