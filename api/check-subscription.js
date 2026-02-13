const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Authorization ヘッダーからユーザーを検証
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // subscriptions テーブルを確認（service role key で RLS バイパス）
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status, plan, trial_end, current_period_end, cancel_at_period_end')
      .eq('user_id', user.id)
      .single();

    if (sub) {
      const isPremium = sub.status === 'active' || sub.status === 'trialing';
      return res.status(200).json({ isPremium, subscription: sub });
    }

    // フォールバック: users テーブル
    const { data: profile } = await supabase
      .from('users')
      .select('is_premium')
      .eq('id', user.id)
      .single();

    return res.status(200).json({
      isPremium: profile?.is_premium === true,
      subscription: null,
    });
  } catch (err) {
    console.error('check-subscription error:', err);
    return res.status(500).json({ error: err.message });
  }
};
