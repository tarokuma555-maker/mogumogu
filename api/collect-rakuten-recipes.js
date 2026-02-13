const { supabase } = require('./_lib/auth');

const BABY_FOOD_CATEGORIES = [
  { id: '41-554', name: '離乳食初期（5～6ヶ月）', stage: '初期' },
  { id: '41-555', name: '離乳食中期（7～8ヶ月）', stage: '中期' },
  { id: '41-556', name: '離乳食後期（9～11ヶ月）', stage: '後期' },
  { id: '41-557', name: '離乳食完了期（12ヶ月以降）', stage: '完了期' },
  { id: '41-558', name: '幼児食(1歳半頃～2歳頃)', stage: '完了期' },
  { id: '41-559', name: '幼児食(3歳頃～6歳頃)', stage: '完了期' },
];

const fetchRakutenRecipes = async (categoryId) => {
  const appId = process.env.RAKUTEN_APP_ID;
  if (!appId) return [];

  try {
    const url = `https://app.rakuten.co.jp/services/api/Recipe/CategoryRanking/20170426?applicationId=${appId}&categoryId=${categoryId}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.result || [];
  } catch (err) {
    console.error(`Rakuten API error for ${categoryId}:`, err);
    return [];
  }
};

const convertToPost = (recipe, stage) => {
  const ingredients = recipe.recipeMaterial
    ? recipe.recipeMaterial.slice(0, 5).join('、')
    : '';

  return {
    post_type: 'recipe',
    title: recipe.recipeTitle,
    content: ingredients
      ? `【材料】${ingredients}\n\n${recipe.recipeDescription || recipe.recipeTitle}`
      : recipe.recipeDescription || recipe.recipeTitle,
    image_url: recipe.foodImageUrl || recipe.mediumImageUrl || recipe.smallImageUrl,
    source_name: '楽天レシピ',
    source_url: recipe.recipeUrl,
    baby_stage: stage,
    tags: [
      stage,
      '楽天レシピ',
      ...(recipe.recipeMaterial ? recipe.recipeMaterial.slice(0, 2) : []),
    ],
    likes_count: Math.floor(Math.random() * 300) + 50,
    comments_count: Math.floor(Math.random() * 40) + 5,
  };
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.query.refresh === 'true') {
      await supabase
        .from('share_posts')
        .delete()
        .eq('source_name', '楽天レシピ');
    }

    const { count } = await supabase
      .from('share_posts')
      .select('*', { count: 'exact', head: true })
      .eq('source_name', '楽天レシピ');

    if (count >= 16 && req.query.refresh !== 'true') {
      return res.json({
        message: '楽天レシピデータは既に十分あります',
        count,
      });
    }

    const allPosts = [];

    for (const category of BABY_FOOD_CATEGORIES) {
      console.log(`Fetching: ${category.name}`);
      const recipes = await fetchRakutenRecipes(category.id);

      for (const recipe of recipes) {
        allPosts.push(convertToPost(recipe, category.stage));
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    if (allPosts.length === 0) {
      return res.status(400).json({
        error: '楽天レシピからデータを取得できませんでした。RAKUTEN_APP_ID が正しく設定されているか確認してください。',
      });
    }

    const { data, error } = await supabase
      .from('share_posts')
      .insert(allPosts)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      categories: BABY_FOOD_CATEGORIES.map(c => c.name),
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
};
