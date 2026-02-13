const { supabase } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    // 除外IDリストを解析
    let excludeIds = [];
    if (req.query.exclude) {
      try {
        excludeIds = JSON.parse(req.query.exclude);
      } catch {
        // パースエラーは無視
      }
    }

    // service role key でクエリ（RLS バイパス）
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .not('youtube_id', 'is', null)
      .neq('youtube_id', '')
      .limit(limit + excludeIds.length);

    if (error) {
      console.error('random-videos query error:', error);
      return res.status(500).json({ error: 'Database query failed' });
    }

    // 除外IDをフィルタ
    let videos = (data || []).filter(v => !excludeIds.includes(v.id));

    // Fisher-Yates シャッフル
    for (let i = videos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [videos[i], videos[j]] = [videos[j], videos[i]];
    }

    return res.status(200).json({
      videos: videos.slice(0, limit),
    });
  } catch (err) {
    console.error('random-videos error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
