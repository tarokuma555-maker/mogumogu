const { supabase } = require('./_lib/auth');

// ===== AI 生成 =====
async function generateBroadcastText(type, pastContents) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;
  if (!anthropicKey && !openaiKey) return null;

  const systemPrompt = `あなたはLINE公式アカウント「MoguMogu」の配信担当です。
友だちは離乳食中の赤ちゃんを持つママ・パパです。
ルール:
- 500字以内
- 絵文字を多めに使って親しみやすく
- 番号付きリストで見やすく
- 最後にアプリURLを入れる: https://mogumogu-omega.vercel.app
- 医学的に正確な情報のみ
- 「今週の」で始める
- JSON形式で回答: {"text":"配信テキスト"}`;

  const typePrompts = {
    tip: '離乳食の実用的なTips（冷凍保存術、調理テクニック、食材の下処理など）を1つ紹介する配信メッセージを書いてください。手順は番号付きリストで。',
    recipe: '今週のおすすめ離乳食レシピ3選を紹介する配信メッセージを書いてください。レシピ名だけでOK、作り方はアプリに誘導。',
  };

  const pastText = pastContents.length > 0
    ? `\n\n過去の配信（重複を避けてください）:\n${pastContents.slice(0, 5).join('\n---\n')}`
    : '';

  const userPrompt = (typePrompts[type] || typePrompts.tip) + pastText;

  if (anthropicKey) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    });
    const data = await r.json();
    return data.content?.[0]?.text || null;
  }

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 1024 }),
  });
  const data = await r.json();
  return data.choices?.[0]?.message?.content || null;
}

// ===== フォールバック =====
const FALLBACK_TIPS = [
  '🍼 今週の離乳食Tips\n\n【にんじんペーストの作り方】\n1. にんじんを薄切りにする\n2. 柔らかくなるまで茹でる（15分）\n3. ブレンダーでなめらかに\n4. 製氷皿で冷凍保存\n\n💡 2週間以内に使い切ってくださいね！\n\nhttps://mogumogu-omega.vercel.app',
  '🍼 今週の離乳食Tips\n\n【かぼちゃの冷凍ストック術】\n1. かぼちゃを一口大に切る\n2. 電子レンジで3分加熱\n3. マッシュして製氷皿へ\n\n💡 1〜2週間保存OK！\n\nMoguMoguアプリでもっとレシピを見る👇\nhttps://mogumogu-omega.vercel.app',
  '🍼 今週の離乳食Tips\n\n【しらすの塩抜き方法】\n1. 茶こしにしらすを入れる\n2. 熱湯をまわしかける\n3. 水気を切って完了！\n\n💡 タンパク質と鉄分が摂れます✨\n\nhttps://mogumogu-omega.vercel.app',
  '🍼 今週の離乳食Tips\n\n【豆腐の下ごしらえ】\n1. 絹ごし豆腐を使う\n2. さっと茹でて殺菌\n3. すりつぶしてなめらかに\n\n💡 初期から使える万能食材です！\n\nhttps://mogumogu-omega.vercel.app',
  '🍼 今週の離乳食Tips\n\n【バナナの離乳食活用法】\n1. 皮をむいてラップに包む\n2. 冷凍庫で保存\n3. 使う時にすりおろすだけ\n\n💡 自然な甘みで赤ちゃんも大好き🍌\n\nhttps://mogumogu-omega.vercel.app',
];

const FALLBACK_RECIPES = [
  '📖 今週のおすすめレシピ\n\n1️⃣ 10倍がゆ（基本のおかゆ）\n2️⃣ かぼちゃペースト\n3️⃣ しらすとブロッコリーのおかゆ\n\n作り方はアプリで検索🔍\nhttps://mogumogu-omega.vercel.app',
  '📖 今週のおすすめレシピ\n\n1️⃣ バナナとオートミールのパンケーキ\n2️⃣ しらすとほうれん草のおかゆ\n3️⃣ 豆腐のトマト煮\n\n作り方はアプリで検索🔍\nhttps://mogumogu-omega.vercel.app',
  '📖 今週のおすすめレシピ\n\n1️⃣ さつまいもスティック（手づかみ用）\n2️⃣ 鮭とにんじんのおかゆ\n3️⃣ ほうれん草の白和え\n\n作り方はアプリで検索🔍\nhttps://mogumogu-omega.vercel.app',
  '📖 今週のおすすめレシピ\n\n1️⃣ にんじんとりんごのペースト\n2️⃣ 納豆おかゆ\n3️⃣ かぼちゃと豆腐のスープ\n\n作り方はアプリで検索🔍\nhttps://mogumogu-omega.vercel.app',
  '📖 今週のおすすめレシピ\n\n1️⃣ トマトリゾット風おかゆ\n2️⃣ ささみと野菜のうどん\n3️⃣ バナナヨーグルト\n\n作り方はアプリで検索🔍\nhttps://mogumogu-omega.vercel.app',
];

// ===== メインハンドラ =====
module.exports = async (req, res) => {
  try {
    const token = process.env.LINE_MESSAGING_CHANNEL_TOKEN;
    if (!token) {
      return res.status(200).json({ error: 'LINE_MESSAGING_CHANNEL_TOKEN is not configured' });
    }

    // 配信タイプ判定
    let type = req.query.type;
    if (!type) {
      const dayOfWeek = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay(); // JST
      type = dayOfWeek === 4 ? 'recipe' : 'tip'; // 木曜=recipe、それ以外=tip
    }

    // 過去の配信を取得（重複回避）
    let pastContents = [];
    try {
      const { data } = await supabase
        .from('line_broadcasts')
        .select('content')
        .eq('broadcast_type', type)
        .order('sent_at', { ascending: false })
        .limit(5);
      pastContents = (data || []).map(p => p.content);
    } catch (e) {
      console.error('line_broadcasts query failed:', e.message);
    }

    // AI で配信テキスト生成
    let messageText = null;
    const raw = await generateBroadcastText(type, pastContents);
    if (raw) {
      try {
        const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        messageText = parsed.text;
      } catch {
        messageText = raw.replace(/^["']|["']$/g, '').trim();
        if (messageText.length > 500) messageText = messageText.slice(0, 497) + '…';
      }
    }

    // フォールバック
    if (!messageText) {
      const pool = type === 'recipe' ? FALLBACK_RECIPES : FALLBACK_TIPS;
      const unused = pool.filter(t => !pastContents.includes(t));
      messageText = (unused.length > 0 ? unused : pool)[Math.floor(Math.random() * (unused.length > 0 ? unused : pool).length)];
    }

    // LINE broadcast 送信
    const broadcastRes = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [{ type: 'text', text: messageText }],
      }),
    });

    const success = broadcastRes.ok;
    if (!success) {
      const errBody = await broadcastRes.text();
      console.error('LINE broadcast failed:', broadcastRes.status, errBody);
    }

    // 履歴保存
    try {
      await supabase.from('line_broadcasts').insert({
        broadcast_type: type,
        content: messageText,
      });
    } catch (e) {
      console.error('line_broadcasts insert failed:', e.message);
    }

    if (success) {
      return res.json({ success: true, type, message_length: messageText.length });
    } else {
      return res.status(200).json({ error: 'LINE broadcast failed', type, message_length: messageText.length });
    }
  } catch (err) {
    console.error('line-broadcast error:', err);
    return res.status(500).json({ error: err.message });
  }
};
