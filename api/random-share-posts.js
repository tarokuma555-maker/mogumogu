const { supabase } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const { data, error } = await supabase
      .from('share_posts')
      .select('*')
      .limit(200);

    if (error) {
      console.error('random-share-posts query error:', error);
      return res.status(500).json({ error: 'Database query failed' });
    }

    let posts = data || [];

    // Fisher-Yates シャッフル
    for (let i = posts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [posts[i], posts[j]] = [posts[j], posts[i]];
    }

    return res.status(200).json({
      posts: posts.slice(0, limit),
    });
  } catch (err) {
    console.error('random-share-posts error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
