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

// ===== action=collect: YouTube検索→DB保存（旧 collect-videos.js） =====
const COLLECT_KEYWORDS = [
  '離乳食 作り方 #shorts', '離乳食 初期 レシピ #shorts', '離乳食 中期 #shorts',
  '離乳食 後期 手づかみ #shorts', '離乳食 完了期 #shorts', '離乳食 冷凍ストック #shorts',
  '離乳食 簡単 時短 #shorts', '10倍がゆ #shorts', '赤ちゃん ごはん #shorts', '離乳食 おすすめ #shorts',
];
const BABY_FOOD_KW = [
  '離乳食','ベビーフード','10倍がゆ','7倍がゆ','5倍がゆ','赤ちゃん','ごっくん','もぐもぐ',
  'かみかみ','ぱくぱく','手づかみ','おかゆ','野菜ペースト','初期','中期','後期','完了期',
];
function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return (parseInt(m?.[1]||'0'))*3600 + (parseInt(m?.[2]||'0'))*60 + (parseInt(m?.[3]||'0'));
}
function guessStage(title, desc) {
  const t = `${title} ${desc}`;
  if (/初期|ゴックン|5.?6.?ヶ月|ペースト/.test(t)) return 'ゴックン期';
  if (/中期|モグモグ|7.?8.?ヶ月/.test(t)) return 'モグモグ期';
  if (/後期|カミカミ|9.?11.?ヶ月|手づかみ/.test(t)) return 'カミカミ期';
  if (/完了期|パクパク|12.?18.?ヶ月|取り分け/.test(t)) return 'パクパク期';
  return null;
}
function hasBabyKw(title, desc) { return BABY_FOOD_KW.some(k => `${title} ${desc}`.includes(k)); }

async function handleCollect(req, res) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'YOUTUBE_API_KEY is not set' });
  if (req.query.refresh === 'true') await supabase.from('videos').delete().neq('youtube_id', '');

  const shuffled = [...COLLECT_KEYWORDS].sort(() => Math.random() - 0.5).slice(0, 2);
  const allItems = [];
  for (const kw of shuffled) {
    const sr = await fetch(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
      part:'snippet',type:'video',videoDuration:'short',maxResults:'25',order:'relevance',regionCode:'JP',relevanceLanguage:'ja',q:kw,key:apiKey
    })}`);
    if (!sr.ok) continue;
    const sd = await sr.json();
    allItems.push(...(sd.items||[]).filter(i=>i.id?.videoId).map(i=>({videoId:i.id.videoId,snippet:i.snippet})));
  }
  if (allItems.length===0) return res.json({collected:0,message:'No videos found'});

  const uids = [...new Set(allItems.map(v=>v.videoId))];
  const dr = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({part:'contentDetails,status',id:uids.join(','),key:apiKey})}`);
  if (!dr.ok) return res.status(502).json({error:'YouTube videos.list API failed'});
  const dd = await dr.json();
  const dm = {};
  for (const i of (dd.items||[])) dm[i.id]={embeddable:i.status?.embeddable===true,duration:parseDuration(i.contentDetails?.duration||'PT0S')};

  const seen = new Set();
  const rows = allItems.filter(v=>{
    if(seen.has(v.videoId))return false; seen.add(v.videoId);
    const d=dm[v.videoId]; return d&&d.embeddable&&d.duration<=60&&hasBabyKw(v.snippet.title,v.snippet.description);
  }).map(v=>({youtube_id:v.videoId,title:v.snippet.title,description:v.snippet.description,channel_name:v.snippet.channelTitle,baby_month_stage:guessStage(v.snippet.title,v.snippet.description),tags:[],likes_count:0,views_count:0}));

  if (rows.length>0) {
    const {data:ex}=await supabase.from('videos').select('youtube_id').in('youtube_id',rows.map(r=>r.youtube_id));
    const eids=new Set((ex||[]).map(e=>e.youtube_id));
    const nr=rows.filter(r=>!eids.has(r.youtube_id));
    if(nr.length>0){const{error:ie}=await supabase.from('videos').insert(nr);if(ie)console.error('Insert error:',ie);}
  }
  return res.json({collected:rows.length,keywords:shuffled,total_searched:allItems.length});
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
      case 'collect': return await handleCollect(req, res);
      default: return await handleRandom(req, res);
    }
  } catch (err) {
    console.error('videos API error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
