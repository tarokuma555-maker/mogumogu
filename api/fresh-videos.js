const { supabase } = require('./_lib/auth');

// タイトルからステージを自動判定
function detectStage(title) {
  if (/初期|5ヶ月|6ヶ月|ゴックン/.test(title)) return '初期';
  if (/中期|7ヶ月|8ヶ月|モグモグ/.test(title)) return '中期';
  if (/後期|9ヶ月|10ヶ月|11ヶ月|カミカミ/.test(title)) return '後期';
  if (/完了|12ヶ月|1歳|パクパク|幼児食/.test(title)) return '完了期';
  return '';
}

const KEYWORDS_BY_STAGE = {
  '初期': [
    '離乳食 初期 レシピ #shorts',
    '離乳食 5ヶ月 6ヶ月 #shorts',
    '10倍がゆ 作り方 #shorts',
  ],
  '中期': [
    '離乳食 中期 レシピ #shorts',
    '離乳食 7ヶ月 8ヶ月 #shorts',
    '離乳食 中期 簡単 #shorts',
  ],
  '後期': [
    '離乳食 後期 レシピ #shorts',
    '手づかみ食べ 離乳食 #shorts',
    '離乳食 9ヶ月 #shorts',
  ],
  '完了期': [
    '離乳食 完了期 レシピ #shorts',
    '1歳 ごはん レシピ #shorts',
    '幼児食 簡単 #shorts',
  ],
};

const DEFAULT_KEYWORDS = [
  '離乳食 レシピ 簡単 #shorts',
  '離乳食 作り方 #shorts',
  '赤ちゃん ごはん #shorts',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const youtubeKey = process.env.YOUTUBE_API_KEY;
  if (!youtubeKey) {
    return res.json({ videos: [] });
  }

  const stage = req.query.stage || '';

  const keywords = stage && KEYWORDS_BY_STAGE[stage]
    ? KEYWORDS_BY_STAGE[stage]
    : DEFAULT_KEYWORDS;
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];

  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?` +
      new URLSearchParams({
        part: 'snippet',
        q: keyword,
        type: 'video',
        videoDuration: 'short',
        maxResults: '10',
        regionCode: 'JP',
        relevanceLanguage: 'ja',
        order: 'date',
        key: youtubeKey,
      });

    const r = await fetch(searchUrl);
    const d = await r.json();

    if (!d.items || d.items.length === 0) {
      return res.json({ videos: [] });
    }

    // 動画IDリストで詳細情報を取得（embeddable チェック）
    const videoIds = d.items.map(i => i.id.videoId).filter(Boolean).join(',');
    if (!videoIds) return res.json({ videos: [] });

    const detailUrl = `https://www.googleapis.com/youtube/v3/videos?` +
      new URLSearchParams({
        part: 'status,contentDetails',
        id: videoIds,
        key: youtubeKey,
      });

    const dr = await fetch(detailUrl);
    const dd = await dr.json();

    // 埋め込み可能な動画のみフィルタ
    const embeddableIds = new Set(
      (dd.items || [])
        .filter(item => item.status?.embeddable)
        .map(item => item.id)
    );

    const videos = d.items
      .filter(item => item.id?.videoId && embeddableIds.has(item.id.videoId))
      .map(item => ({
        youtube_id: item.id.videoId,
        title: item.snippet.title,
        thumbnail_url: item.snippet.thumbnails?.high?.url
          || item.snippet.thumbnails?.medium?.url,
        channel_name: item.snippet.channelTitle,
        baby_stage: stage || detectStage(item.snippet.title),
        source: 'fresh',
      }));

    res.json({ videos });
  } catch (err) {
    console.error('Fresh videos error:', err);
    res.json({ videos: [] });
  }
};
