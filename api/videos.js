const { supabase } = require('./_lib/auth');

// ===== ステージ判定 =====
function detectStage(title) {
  if (/初期|5ヶ月|6ヶ月|ゴックン/.test(title)) return '初期';
  if (/中期|7ヶ月|8ヶ月|モグモグ/.test(title)) return '中期';
  if (/後期|9ヶ月|10ヶ月|11ヶ月|カミカミ/.test(title)) return '後期';
  if (/完了|12ヶ月|1歳|パクパク|幼児食/.test(title)) return '完了期';
  return '';
}

// ===== action=random: DBからランダム取得 =====
async function handleRandom(req, res) {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  let excludeIds = [];
  if (req.query.exclude) {
    try { excludeIds = JSON.parse(req.query.exclude); } catch {}
  }

  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .not('youtube_id', 'is', null)
    .neq('youtube_id', '')
    .limit(limit + excludeIds.length);

  if (error) return res.status(500).json({ error: 'Database query failed' });

  let videos = (data || []).filter(v => !excludeIds.includes(v.id));
  for (let i = videos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [videos[i], videos[j]] = [videos[j], videos[i]];
  }

  return res.status(200).json({ videos: videos.slice(0, limit) });
}

// ===== action=fresh: YouTube APIから直接取得 =====
const KEYWORDS_BY_STAGE = {
  '初期': ['離乳食 初期 レシピ #shorts', '離乳食 5ヶ月 6ヶ月 #shorts', '10倍がゆ 作り方 #shorts'],
  '中期': ['離乳食 中期 レシピ #shorts', '離乳食 7ヶ月 8ヶ月 #shorts', '離乳食 中期 簡単 #shorts'],
  '後期': ['離乳食 後期 レシピ #shorts', '手づかみ食べ 離乳食 #shorts', '離乳食 9ヶ月 #shorts'],
  '完了期': ['離乳食 完了期 レシピ #shorts', '1歳 ごはん レシピ #shorts', '幼児食 簡単 #shorts'],
};
const DEFAULT_KEYWORDS = ['離乳食 レシピ 簡単 #shorts', '離乳食 作り方 #shorts', '赤ちゃん ごはん #shorts'];

async function handleFresh(req, res) {
  const youtubeKey = process.env.YOUTUBE_API_KEY;
  if (!youtubeKey) return res.json({ videos: [] });

  const stage = req.query.stage || '';
  const keywords = stage && KEYWORDS_BY_STAGE[stage] ? KEYWORDS_BY_STAGE[stage] : DEFAULT_KEYWORDS;
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?` +
    new URLSearchParams({
      part: 'snippet', q: keyword, type: 'video', videoDuration: 'short',
      maxResults: '10', regionCode: 'JP', relevanceLanguage: 'ja', order: 'date', key: youtubeKey,
    });

  const r = await fetch(searchUrl);
  const d = await r.json();
  if (!d.items || d.items.length === 0) return res.json({ videos: [] });

  const videoIds = d.items.map(i => i.id.videoId).filter(Boolean).join(',');
  if (!videoIds) return res.json({ videos: [] });

  const detailUrl = `https://www.googleapis.com/youtube/v3/videos?` +
    new URLSearchParams({ part: 'status,contentDetails', id: videoIds, key: youtubeKey });
  const dr = await fetch(detailUrl);
  const dd = await dr.json();

  const embeddableIds = new Set(
    (dd.items || []).filter(item => item.status?.embeddable).map(item => item.id)
  );

  const videos = d.items
    .filter(item => item.id?.videoId && embeddableIds.has(item.id.videoId))
    .map(item => ({
      youtube_id: item.id.videoId,
      title: item.snippet.title,
      thumbnail_url: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url,
      channel_name: item.snippet.channelTitle,
      baby_stage: stage || detectStage(item.snippet.title),
      source: 'fresh',
    }));

  res.json({ videos });
}

// ===== action=cleanup: 壊れた動画を削除 =====
async function handleCleanup(req, res) {
  const { data: videos } = await supabase.from('videos').select('id, youtube_id');
  if (!videos || videos.length === 0) return res.json({ checked: 0, removed: 0 });

  const youtubeKey = process.env.YOUTUBE_API_KEY;
  if (!youtubeKey) return res.json({ message: 'No YouTube API key', checked: 0, removed: 0 });

  const batchSize = 50;
  const brokenIds = [];

  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    const ids = batch.map(v => v.youtube_id).filter(Boolean).join(',');
    if (!ids) continue;

    const url = `https://www.googleapis.com/youtube/v3/videos?` +
      new URLSearchParams({ part: 'status', id: ids, key: youtubeKey });
    const r = await fetch(url);
    const d = await r.json();

    const foundIds = new Set((d.items || []).map(item => item.id));
    const nonEmbeddable = new Set(
      (d.items || []).filter(item => !item.status?.embeddable).map(item => item.id)
    );

    for (const v of batch) {
      if (v.youtube_id && (!foundIds.has(v.youtube_id) || nonEmbeddable.has(v.youtube_id))) {
        brokenIds.push(v.id);
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (brokenIds.length > 0) {
    await supabase.from('videos').delete().in('id', brokenIds);
  }

  res.json({ success: true, checked: videos.length, removed: brokenIds.length });
}

// ===== メインハンドラ =====
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const action = req.query.action || 'random';
    switch (action) {
      case 'fresh': return await handleFresh(req, res);
      case 'cleanup': return await handleCleanup(req, res);
      default: return await handleRandom(req, res);
    }
  } catch (err) {
    console.error('videos API error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
