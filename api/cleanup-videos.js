const { supabase } = require('./_lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, youtube_id');

    if (!videos || videos.length === 0) {
      return res.json({ message: 'No videos to check', checked: 0, removed: 0 });
    }

    const youtubeKey = process.env.YOUTUBE_API_KEY;
    if (!youtubeKey) {
      return res.json({ message: 'No YouTube API key', checked: 0, removed: 0 });
    }

    const batchSize = 50;
    const brokenIds = [];

    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      const ids = batch.map(v => v.youtube_id).filter(Boolean).join(',');
      if (!ids) continue;

      const url = `https://www.googleapis.com/youtube/v3/videos?` +
        new URLSearchParams({
          part: 'status',
          id: ids,
          key: youtubeKey,
        });

      const r = await fetch(url);
      const d = await r.json();

      const foundIds = new Set(
        (d.items || []).map(item => item.id)
      );

      const nonEmbeddable = new Set(
        (d.items || [])
          .filter(item => !item.status?.embeddable)
          .map(item => item.id)
      );

      for (const v of batch) {
        if (v.youtube_id && (!foundIds.has(v.youtube_id) || nonEmbeddable.has(v.youtube_id))) {
          brokenIds.push(v.id);
        }
      }

      await new Promise(r => setTimeout(r, 200));
    }

    if (brokenIds.length > 0) {
      await supabase
        .from('videos')
        .delete()
        .in('id', brokenIds);
    }

    res.json({
      success: true,
      checked: videos.length,
      removed: brokenIds.length,
    });
  } catch (err) {
    console.error('cleanup-videos error:', err);
    res.status(500).json({ error: err.message });
  }
};
