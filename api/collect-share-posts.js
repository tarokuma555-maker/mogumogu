const { supabase } = require('./_lib/auth');

const FOOD_IMAGES = [
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1547592180-85f173990554?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1543352634-a1c51d9f1fa7?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1505576399279-0d754c0ce1ae?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1494390248081-4e521a5940db?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=400&h=400&fit=crop',
];

const SEED_POSTS = [
  {
    post_type: 'recipe',
    title: '10倍がゆの基本の作り方',
    content: 'お米大さじ1に水150mlを加えて、弱火で20分ほど煮ます。最初はすり潰してなめらかにしてからあげてくださいね。冷凍ストックなら製氷皿が便利です！',
    source_name: '離乳食の基本',
    source_url: 'https://www.youtube.com/results?search_query=10倍がゆ+作り方',
    baby_stage: '初期',
    tags: ['離乳食初期', 'おかゆ', '基本レシピ'],
  },
  {
    post_type: 'tip',
    title: '冷凍ストックで時短！離乳食の作り置きテク',
    content: '週末にまとめて作って製氷皿で冷凍するのがおすすめ。にんじん、かぼちゃ、ほうれん草のペーストは2週間以内に使い切ってくださいね。解凍は電子レンジでOK！',
    source_name: '時短離乳食',
    source_url: 'https://www.youtube.com/results?search_query=離乳食+冷凍ストック',
    baby_stage: '初期',
    tags: ['冷凍ストック', '時短', '作り置き'],
  },
  {
    post_type: 'recipe',
    title: 'かぼちゃとさつまいもの甘煮',
    content: 'かぼちゃ50gとさつまいも50gを一口大に切って、やわらかくなるまで茹でます。フォークで潰して、少量のだし汁でのばせば完成。自然の甘さで赤ちゃんが大好きな味です！',
    source_name: 'モグモグレシピ',
    source_url: 'https://www.youtube.com/results?search_query=離乳食+かぼちゃ+さつまいも',
    baby_stage: '中期',
    tags: ['かぼちゃ', 'さつまいも', '中期レシピ'],
  },
  {
    post_type: 'photo',
    title: '今日の離乳食プレート',
    content: 'おかゆ、にんじんペースト、しらす、かぼちゃ。彩りよく盛り付けると赤ちゃんも興味を持ってくれます。100均のシリコンプレートが使いやすくておすすめ！',
    source_name: 'ママの離乳食日記',
    source_url: 'https://www.youtube.com/results?search_query=離乳食+プレート+盛り付け',
    baby_stage: '中期',
    tags: ['盛り付け', '離乳食プレート', '100均'],
  },
  {
    post_type: 'tip',
    title: '手づかみ食べにおすすめの食材リスト',
    content: 'バナナ、食パン（耳を取る）、蒸しさつまいも、おやき、豆腐ハンバーグ。最初は大きめにカットして、握りやすい形にしてあげると食べやすいです。床が汚れるのは成長の証！',
    source_name: '手づかみ離乳食',
    source_url: 'https://www.youtube.com/results?search_query=手づかみ食べ+離乳食',
    baby_stage: '後期',
    tags: ['手づかみ食べ', '後期', 'おすすめ食材'],
  },
  {
    post_type: 'recipe',
    title: 'しらすとブロッコリーのおかゆ',
    content: '7倍がゆにしらす（塩抜き済み）とブロッコリーの穂先を混ぜるだけ！タンパク質と鉄分が一度に摂れる栄養満点レシピです。しらすは熱湯をかけて塩抜きしてからあげてください。',
    source_name: '栄養たっぷりレシピ',
    source_url: 'https://www.youtube.com/results?search_query=離乳食+しらす+ブロッコリー',
    baby_stage: '初期',
    tags: ['しらす', 'ブロッコリー', '鉄分'],
  },
  {
    post_type: 'question',
    title: '離乳食を食べてくれない時どうしてますか？',
    content: 'うちの子（7ヶ月）がここ数日離乳食を嫌がって泣きます。無理にあげない方がいいと聞きますが、栄養面が心配で...先輩ママさん、アドバイスお願いします！',
    source_name: 'みんなの相談室',
    source_url: 'https://www.youtube.com/results?search_query=離乳食+食べない+対策',
    baby_stage: '中期',
    tags: ['食べない', '相談', '7ヶ月'],
  },
  {
    post_type: 'recipe',
    title: '豆腐ハンバーグ（卵不使用）',
    content: '絹豆腐100g、鶏ひき肉50g、片栗粉大さじ1を混ぜてフライパンで焼くだけ。卵なしでもふわふわに仕上がります。まとめて作って冷凍もOK！',
    source_name: 'アレルギー対応レシピ',
    source_url: 'https://www.youtube.com/results?search_query=離乳食+豆腐ハンバーグ+卵なし',
    baby_stage: '後期',
    tags: ['豆腐ハンバーグ', '卵なし', 'アレルギー対応'],
  },
  {
    post_type: 'tip',
    title: '離乳食のアレルギーチェック、こう進めました',
    content: '新しい食材は平日の午前中に少量から！かかりつけ医が開いている時間帯にあげるのが安心です。我が家は1食材につき3日間同じものをあげて様子を見ています。',
    source_name: 'アレルギー対策',
    source_url: 'https://www.youtube.com/results?search_query=離乳食+アレルギー+進め方',
    baby_stage: '初期',
    tags: ['アレルギー', '進め方', '安全'],
  },
  {
    post_type: 'photo',
    title: '1歳のバースデーケーキ作りました',
    content: '食パン、水切りヨーグルト、いちごで作ったスマッシュケーキ。砂糖不使用で安心！ヨーグルトは一晩水切りするとクリームみたいになります。記念撮影もバッチリでした',
    source_name: 'お祝い離乳食',
    source_url: 'https://www.youtube.com/results?search_query=1歳+バースデーケーキ+離乳食',
    baby_stage: '完了期',
    tags: ['バースデー', 'スマッシュケーキ', '1歳'],
  },
  {
    post_type: 'recipe',
    title: 'にんじんスティック（手づかみ用）',
    content: 'にんじんを5cm×1cmのスティック状に切って、やわらかくなるまで蒸します（15分くらい）。指で軽く潰せるくらいが目安。甘くて赤ちゃんが喜ぶ手づかみメニューです！',
    source_name: '手づかみレシピ',
    source_url: 'https://www.youtube.com/results?search_query=離乳食+にんじんスティック',
    baby_stage: '後期',
    tags: ['にんじん', '手づかみ', '蒸し野菜'],
  },
  {
    post_type: 'tip',
    title: 'ブレンダーvs裏ごし器、どっちが便利？',
    content: '結論：初期はブレンダー一択！裏ごし器は少量向けには良いけど、まとめて作るならブレンダーが圧倒的にラク。我が家はブラウンのハンドブレンダーを愛用中。お粥もペーストも30秒で完成します。',
    source_name: '離乳食グッズ比較',
    source_url: 'https://www.youtube.com/results?search_query=離乳食+ブレンダー+おすすめ',
    baby_stage: '初期',
    tags: ['ブレンダー', '調理器具', '便利グッズ'],
  },
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { count } = await supabase
      .from('share_posts')
      .select('*', { count: 'exact', head: true });

    if (count > 0 && req.query.refresh !== 'true') {
      return res.json({ message: '投稿データは既に存在します', count });
    }

    if (req.query.refresh === 'true') {
      await supabase.from('share_posts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }

    const posts = SEED_POSTS.map((post, i) => ({
      ...post,
      image_url: FOOD_IMAGES[i % FOOD_IMAGES.length],
      likes_count: Math.floor(Math.random() * 200) + 10,
      comments_count: Math.floor(Math.random() * 30),
    }));

    const { data, error } = await supabase
      .from('share_posts').insert(posts).select();

    if (error) throw error;

    res.json({ success: true, count: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
