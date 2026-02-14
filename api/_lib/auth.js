const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * リクエストからSupabase JWTを検証し、ユーザーを返す
 */
async function verifyUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, error: 'Authorization header missing' };
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { user: null, error: 'Invalid or expired token' };
  }

  return { user, error: null };
}

/**
 * ユーザーのプレミアムステータスを取得
 */
async function getIsPremium(userId) {
  const { data } = await supabase
    .from('users')
    .select('is_premium')
    .eq('id', userId)
    .single();

  return data?.is_premium === true;
}

/**
 * 本日の検索回数を取得
 */
async function getTodaySearchCount(userId) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('search_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('searched_at', todayStart.toISOString());

  return count || 0;
}

/**
 * 本日のレシピ生成回数を取得
 */
async function getTodayRecipeGenCount(userId) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('recipe_generations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('generated_at', todayStart.toISOString());

  return count || 0;
}

/**
 * 検索履歴を記録
 */
async function recordSearch(userId, query) {
  await supabase
    .from('search_history')
    .insert({ user_id: userId, query });
}

/**
 * レシピ生成を記録
 */
async function recordRecipeGen(userId) {
  await supabase
    .from('recipe_generations')
    .insert({ user_id: userId });
}

module.exports = {
  supabase,
  verifyUser,
  getIsPremium,
  getTodaySearchCount,
  getTodayRecipeGenCount,
  recordSearch,
  recordRecipeGen,
};
