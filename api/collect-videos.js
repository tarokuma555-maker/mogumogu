const { supabase } = require('./_lib/auth');

const SEARCH_KEYWORDS = [
  '離乳食 作り方 #shorts',
  '離乳食 初期 レシピ #shorts',
  '離乳食 中期 #shorts',
  '離乳食 後期 手づかみ #shorts',
  '離乳食 完了期 #shorts',
  '離乳食 冷凍ストック #shorts',
  '離乳食 簡単 時短 #shorts',
  '10倍がゆ #shorts',
  '赤ちゃん ごはん #shorts',
  '離乳食 おすすめ #shorts',
];

const BABY_FOOD_KEYWORDS = [
  '離乳食', 'ベビーフード', '10倍がゆ', '7倍がゆ', '5倍がゆ',
  '赤ちゃん', 'ごっくん', 'もぐもぐ', 'かみかみ', 'ぱくぱく',
  '手づかみ', 'おかゆ', '野菜ペースト', '初期', '中期', '後期', '完了期',
];

const parseDuration = (iso8601) => {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const h = parseInt(match?.[1] || '0');
  const m = parseInt(match?.[2] || '0');
  const s = parseInt(match?.[3] || '0');
  return h * 3600 + m * 60 + s;
};

function guessStage(title, description) {
  const text = `${title} ${description}`;
  if (/初期|ゴックン|5.?6.?ヶ月|ペースト/.test(text)) return 'ゴックン期';
  if (/中期|モグモグ|7.?8.?ヶ月/.test(text)) return 'モグモグ期';
  if (/後期|カミカミ|9.?11.?ヶ月|手づかみ/.test(text)) return 'カミカミ期';
  if (/完了期|パクパク|12.?18.?ヶ月|取り分け/.test(text)) return 'パクパク期';
  return null;
}

function hasBabyFoodKeyword(title, description) {
  const text = `${title} ${description}`;
  return BABY_FOOD_KEYWORDS.some(kw => text.includes(kw));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'YOUTUBE_API_KEY is not set' });

    // ?refresh=true で古いデータを削除してから収集
    if (req.query.refresh === 'true') {
      await supabase.from('videos').delete().neq('youtube_id', '');
    }

    // ランダムに2キーワード選んで検索
    const shuffled = [...SEARCH_KEYWORDS].sort(() => Math.random() - 0.5);
    const selectedKeywords = shuffled.slice(0, 2);
    const allItems = [];

    for (const keyword of selectedKeywords) {
      const searchParams = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoDuration: 'short',
        maxResults: '25',
        order: 'relevance',
        regionCode: 'JP',
        relevanceLanguage: 'ja',
        q: keyword,
        key: apiKey,
      });

      const searchRes = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${searchParams}`
      );
      if (!searchRes.ok) continue;

      const searchData = await searchRes.json();
      const items = (searchData.items || [])
        .filter(item => item.id?.videoId)
        .map(item => ({ videoId: item.id.videoId, snippet: item.snippet }));
      allItems.push(...items);
    }

    if (allItems.length === 0) {
      return res.status(200).json({ collected: 0, message: 'No videos found' });
    }

    // videos.list で詳細取得（embeddable, duration）
    const uniqueIds = [...new Set(allItems.map(v => v.videoId))];
    const detailParams = new URLSearchParams({
      part: 'contentDetails,status',
      id: uniqueIds.join(','),
      key: apiKey,
    });

    const detailRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${detailParams}`
    );
    if (!detailRes.ok) {
      return res.status(502).json({ error: 'YouTube videos.list API failed' });
    }

    const detailData = await detailRes.json();
    const detailMap = {};
    for (const item of (detailData.items || [])) {
      detailMap[item.id] = {
        embeddable: item.status?.embeddable === true,
        duration: parseDuration(item.contentDetails?.duration || 'PT0S'),
      };
    }

    // フィルタリング: embeddable + 60秒以下 + 離乳食キーワード
    const now = new Date().toISOString();
    const seen = new Set();
    const rows = allItems
      .filter(v => {
        if (seen.has(v.videoId)) return false;
        seen.add(v.videoId);
        const detail = detailMap[v.videoId];
        if (!detail) return false;
        if (!detail.embeddable) return false;
        if (detail.duration > 60) return false;
        if (!hasBabyFoodKeyword(v.snippet.title, v.snippet.description)) return false;
        return true;
      })
      .map(v => ({
        youtube_id: v.videoId,
        title: v.snippet.title,
        description: v.snippet.description,
        channel_name: v.snippet.channelTitle,
        thumbnail_url: v.snippet.thumbnails?.high?.url
          || v.snippet.thumbnails?.medium?.url
          || v.snippet.thumbnails?.default?.url
          || null,
        baby_month_stage: guessStage(v.snippet.title, v.snippet.description),
        tags: [],
        likes_count: 0,
        views_count: 0,
        cached_at: now,
      }));

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('videos')
        .upsert(rows, { onConflict: 'youtube_id' });
      if (upsertError) console.error('Upsert error:', upsertError);
    }

    return res.status(200).json({
      collected: rows.length,
      keywords: selectedKeywords,
      total_searched: allItems.length,
    });
  } catch (err) {
    console.error('collect-videos error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
