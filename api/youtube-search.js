const { supabase } = require('./_lib/auth');

const SEARCH_QUERIES = [
  '離乳食 初期 作り方',
  '離乳食 中期 レシピ',
  '離乳食 後期 手づかみ',
  '離乳食 おかゆ 簡単',
  '赤ちゃん 離乳食 レシピ',
  '離乳食 冷凍 ストック',
  '離乳食 野菜 ペースト',
  '離乳食 完了期 取り分け',
];

const CACHE_HOURS = 24;

/**
 * baby_month_stage をタイトル・クエリから推定
 */
function guessStage(title, query) {
  const text = `${title} ${query}`;
  if (/初期|ゴックン|5.?6.?ヶ月|ペースト/.test(text)) return 'ゴックン期';
  if (/中期|モグモグ|7.?8.?ヶ月/.test(text)) return 'モグモグ期';
  if (/後期|カミカミ|9.?11.?ヶ月|手づかみ/.test(text)) return 'カミカミ期';
  if (/完了期|パクパク|12.?18.?ヶ月|取り分け/.test(text)) return 'パクパク期';
  return null;
}

/**
 * タイトルからタグを抽出
 */
function extractTags(title, query) {
  const tags = [];
  const keywords = ['離乳食', 'おかゆ', '野菜', 'ペースト', '手づかみ', '冷凍', 'ストック', '取り分け', '簡単', 'レシピ'];
  const text = `${title} ${query}`;
  for (const kw of keywords) {
    if (text.includes(kw)) tags.push(kw);
  }
  return tags.slice(0, 4);
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // --- キャッシュ確認 ---
    const { data: cached, error: cacheError } = await supabase
      .from('videos')
      .select('*')
      .order('cached_at', { ascending: false })
      .limit(20);

    if (!cacheError && cached && cached.length > 0) {
      // 最古の cached_at を確認
      const oldest = cached.reduce((min, v) => {
        const t = v.cached_at ? new Date(v.cached_at).getTime() : 0;
        return t < min ? t : min;
      }, Date.now());

      const ageHours = (Date.now() - oldest) / (1000 * 60 * 60);

      if (ageHours < CACHE_HOURS) {
        return res.status(200).json({
          videos: cached,
          source: 'cache',
        });
      }
    }

    // --- YouTube Data API v3 で検索 ---
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      // APIキー未設定ならキャッシュがあればそれを返す
      if (cached && cached.length > 0) {
        return res.status(200).json({ videos: cached, source: 'cache_stale' });
      }
      return res.status(500).json({ error: 'YOUTUBE_API_KEY が設定されていません' });
    }

    // ランダムにクエリを選択
    const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];

    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoDuration: 'short',
      maxResults: '10',
      order: 'relevance',
      regionCode: 'JP',
      relevanceLanguage: 'ja',
      q: query,
      key: apiKey,
    });

    const ytResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params.toString()}`
    );

    if (!ytResponse.ok) {
      const errBody = await ytResponse.text();
      console.error('YouTube API error:', ytResponse.status, errBody);
      // API エラー時はキャッシュがあれば返す
      if (cached && cached.length > 0) {
        return res.status(200).json({ videos: cached, source: 'cache_fallback' });
      }
      return res.status(502).json({ error: 'YouTube APIでエラーが発生しました' });
    }

    const ytData = await ytResponse.json();
    const items = ytData.items || [];

    if (items.length === 0) {
      if (cached && cached.length > 0) {
        return res.status(200).json({ videos: cached, source: 'cache_empty_result' });
      }
      return res.status(200).json({ videos: [], source: 'empty' });
    }

    // --- Supabase に upsert ---
    const now = new Date().toISOString();
    const rows = items
      .filter(item => item.id?.videoId)
      .map(item => ({
        youtube_id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        channel_name: item.snippet.channelTitle,
        thumbnail_url: item.snippet.thumbnails?.high?.url
          || item.snippet.thumbnails?.medium?.url
          || item.snippet.thumbnails?.default?.url
          || null,
        baby_month_stage: guessStage(item.snippet.title, query),
        tags: extractTags(item.snippet.title, query),
        likes_count: 0,
        views_count: 0,
        cached_at: now,
      }));

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('videos')
        .upsert(rows, { onConflict: 'youtube_id' });

      if (upsertError) {
        console.error('Supabase upsert error:', upsertError);
      }
    }

    // --- 最新データを返す ---
    const { data: freshData } = await supabase
      .from('videos')
      .select('*')
      .order('cached_at', { ascending: false })
      .limit(20);

    return res.status(200).json({
      videos: freshData || rows,
      source: 'youtube_api',
      query,
    });

  } catch (err) {
    console.error('youtube-search error:', err);
    return res.status(500).json({ error: 'サーバー内部エラーが発生しました' });
  }
};
