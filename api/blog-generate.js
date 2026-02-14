const { supabase } = require('./_lib/auth');

// ===== キーワードリスト（順番に記事を生成）=====
const KEYWORDS = [
  // Tier 1: 高ボリューム
  { keyword: '離乳食 進め方', slug: 'how-to-start', category: 'basic', stage: '', title_hint: '離乳食の進め方完全ガイド【月齢別】' },
  { keyword: '離乳食 食べない', slug: 'wont-eat', category: 'tips', stage: '', title_hint: '離乳食を食べてくれない時の原因と対処法' },
  { keyword: '離乳食 いつから', slug: 'when-to-start', category: 'basic', stage: '初期', title_hint: '離乳食はいつから始める？開始のサイン5つ' },
  { keyword: '離乳食 スケジュール', slug: 'schedule', category: 'stage', stage: '', title_hint: '月齢別の離乳食スケジュール表' },
  { keyword: '離乳食 冷凍', slug: 'freezing', category: 'tips', stage: '', title_hint: '離乳食の冷凍保存テクニック大全' },
  { keyword: '離乳食 初期 レシピ', slug: 'early-recipes', category: 'recipe', stage: '初期', title_hint: '離乳食初期（5〜6ヶ月）のおすすめレシピ' },
  { keyword: '離乳食 中期 レシピ', slug: 'middle-recipes', category: 'recipe', stage: '中期', title_hint: '離乳食中期（7〜8ヶ月）のおすすめレシピ' },
  { keyword: '離乳食 後期 レシピ', slug: 'late-recipes', category: 'recipe', stage: '後期', title_hint: '離乳食後期（9〜11ヶ月）のおすすめレシピ' },
  // Tier 2: 中ボリューム
  { keyword: '手づかみ食べ いつから', slug: 'finger-food', category: 'stage', stage: '後期', title_hint: '手づかみ食べはいつから？始め方ガイド' },
  { keyword: '離乳食 アレルギー', slug: 'allergy-guide', category: 'allergy', stage: '', title_hint: '離乳食のアレルギーが心配な食材の進め方' },
  { keyword: '10倍がゆ 作り方', slug: '10x-porridge', category: 'recipe', stage: '初期', title_hint: '10倍がゆの作り方（炊飯器・レンジ・鍋）' },
  { keyword: '離乳食 量 目安', slug: 'portion-guide', category: 'basic', stage: '', title_hint: '離乳食の量の目安【月齢別一覧表】' },
  { keyword: '離乳食 2回食', slug: 'two-meals', category: 'stage', stage: '中期', title_hint: '離乳食の2回食への進め方とスケジュール' },
  { keyword: '離乳食 3回食', slug: 'three-meals', category: 'stage', stage: '後期', title_hint: '離乳食の3回食への移行タイミングと献立例' },
  { keyword: '離乳食 完了期 レシピ', slug: 'completion-recipes', category: 'recipe', stage: '完了期', title_hint: '離乳食完了期（12ヶ月〜）のおすすめレシピ' },
  { keyword: '離乳食 卵 進め方', slug: 'egg-guide', category: 'food', stage: '', title_hint: '離乳食の卵の進め方【安全なステップ】' },
  // Tier 3: ロングテール（食材別）
  { keyword: '離乳食 バナナ いつから', slug: 'banana', category: 'food', stage: '', title_hint: '離乳食のバナナはいつから？月齢別の与え方' },
  { keyword: '離乳食 豆腐 いつから', slug: 'tofu', category: 'food', stage: '', title_hint: '離乳食の豆腐はいつから？おすすめレシピ付き' },
  { keyword: '離乳食 パン いつから', slug: 'bread', category: 'food', stage: '', title_hint: '離乳食にパンはいつから？食パンの選び方' },
  { keyword: '離乳食 ヨーグルト いつから', slug: 'yogurt', category: 'food', stage: '', title_hint: '離乳食にヨーグルトはいつから？おすすめ種類' },
  { keyword: '離乳食 鮭 いつから', slug: 'salmon', category: 'food', stage: '', title_hint: '離乳食に鮭はいつから？下処理と冷凍方法' },
  { keyword: '離乳食 うどん いつから', slug: 'udon', category: 'food', stage: '', title_hint: '離乳食にうどんはいつから？茹で方のコツ' },
  { keyword: '離乳食 納豆 いつから', slug: 'natto', category: 'food', stage: '', title_hint: '離乳食に納豆はいつから？粘りの処理方法' },
  { keyword: '離乳食 トマト いつから', slug: 'tomato', category: 'food', stage: '', title_hint: '離乳食にトマトはいつから？皮の剥き方' },
  { keyword: '離乳食 さつまいも レシピ', slug: 'sweet-potato', category: 'food', stage: '', title_hint: '離乳食のさつまいもレシピ【月齢別】' },
  { keyword: '離乳食 にんじん レシピ', slug: 'carrot', category: 'food', stage: '', title_hint: '離乳食のにんじんレシピ【月齢別】' },
  { keyword: '離乳食 かぼちゃ レシピ', slug: 'pumpkin', category: 'food', stage: '', title_hint: '離乳食のかぼちゃレシピ【月齢別】' },
  { keyword: '離乳食 ほうれん草 いつから', slug: 'spinach', category: 'food', stage: '', title_hint: '離乳食にほうれん草はいつから？アク抜き方法' },
  { keyword: '離乳食 ささみ いつから', slug: 'chicken-breast', category: 'food', stage: '', title_hint: '離乳食にささみはいつから？パサつかない調理法' },
  { keyword: '離乳食 しらす いつから', slug: 'shirasu', category: 'food', stage: '', title_hint: '離乳食にしらすはいつから？塩抜き方法' },
];

// ===== 記事生成プロンプト =====
function buildPrompt(kw) {
  return {
    system: `あなたは離乳食の専門家です。科学的に正確で、厚生労働省の「授乳・離乳の支援ガイド」に準拠した記事を書いてください。

ルール:
- ターゲット読者: 初めての離乳食に不安を感じているママ・パパ
- トーン: 優しく寄り添う。「〜してくださいね」「大丈夫ですよ」
- 文字数: 2,500〜3,500字
- 見出しには ## と ### を使用（Markdown形式）
- 表を使って分かりやすく（月齢別の量の目安など）
- 「個人差があるので心配な場合はかかりつけ医に相談しましょう」を必ず入れる
- 記事内に自然な形で「MoguMoguアプリでは月齢別のレシピ動画が見られます」等のCTAを1〜2回挿入
- 画像は使わない。テキストと表で構成
- 最後に「## まとめ」セクションを入れる`,
    user: `以下のキーワードで離乳食のSEO記事を書いてください。

キーワード: ${kw.keyword}
記事タイトルの方向性: ${kw.title_hint}
カテゴリ: ${kw.category}
${kw.stage ? `対象ステージ: ${kw.stage}` : ''}

以下のJSON形式のみで回答してください（JSON以外は出力しないこと）:
{
  "title": "SEOに最適化された記事タイトル（キーワードを含む、40字以内）",
  "description": "記事の説明文（120字以内、検索結果のスニペットに表示される）",
  "content": "Markdown形式の記事本文（2500〜3500字）"
}`,
  };
}

// ===== AI API 呼び出し =====
async function callAI(systemPrompt, userPrompt) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (anthropicKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  if (openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 4096,
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  return null;
}

// ===== フォールバック記事 =====
function fallbackArticle(kw) {
  return {
    title: kw.title_hint,
    description: `${kw.keyword}について、月齢別に分かりやすく解説します。初めての離乳食でも安心のガイドです。`,
    content: `## ${kw.title_hint}

赤ちゃんの離乳食、「${kw.keyword}」について気になりますよね。このページでは月齢別に分かりやすく解説します。

### 基本のポイント

離乳食は赤ちゃんの成長に合わせて、少しずつ進めていくことが大切です。焦らず、赤ちゃんのペースに合わせましょう。

### 月齢別の目安

| 時期 | 月齢 | ポイント |
|------|------|---------|
| 初期（ゴックン期） | 5〜6ヶ月 | なめらかにすりつぶした状態 |
| 中期（モグモグ期） | 7〜8ヶ月 | 舌でつぶせる固さ |
| 後期（カミカミ期） | 9〜11ヶ月 | 歯茎でつぶせる固さ |
| 完了期（パクパク期） | 12ヶ月〜 | 歯茎で噛める固さ |

個人差があるので、心配な場合はかかりつけ医に相談しましょう。

MoguMoguアプリでは、月齢に合わせたレシピ動画を簡単に検索できます。

### 注意点

- 新しい食材は1日1種類、少量から始めましょう
- アレルギーが心配な食材は、かかりつけ医に相談してから進めましょう
- 平日の午前中に試すと、何かあったときに受診しやすいです

### まとめ

${kw.keyword}について解説しました。赤ちゃんの成長は一人ひとり違うので、焦らずゆっくり進めましょう。

離乳食の悩みがあれば、MoguMoguアプリのAI相談で24時間いつでも質問できますよ。`,
  };
}

// ===== メインハンドラー =====
module.exports = async (req, res) => {
  try {
    // 既存の記事slug取得
    const { data: existing } = await supabase
      .from('blog_posts')
      .select('slug');
    const existingSlugs = new Set((existing || []).map((p) => p.slug));

    // まだ生成していない次の記事を見つける
    const next = KEYWORDS.find((k) => !existingSlugs.has(k.slug));
    if (!next) {
      return res.json({ message: '全キーワードの記事が生成済みです', total: KEYWORDS.length });
    }

    // AI で記事生成
    const prompt = buildPrompt(next);
    const raw = await callAI(prompt.system, prompt.user);

    let article;
    if (raw) {
      try {
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        article = JSON.parse(cleaned);
      } catch {
        // パース失敗 → テキスト全体を content に
        article = {
          title: next.title_hint,
          description: `${next.keyword}について詳しく解説します。`,
          content: raw,
        };
      }
    } else {
      article = fallbackArticle(next);
    }

    // Supabase に保存
    const { data, error } = await supabase
      .from('blog_posts')
      .insert({
        slug: next.slug,
        title: article.title,
        description: article.description,
        content: article.content,
        keyword: next.keyword,
        category: next.category,
        baby_stage: next.stage || null,
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      slug: data.slug,
      title: data.title,
      remaining: KEYWORDS.length - existingSlugs.size - 1,
    });
  } catch (err) {
    console.error('Blog generation error:', err);
    res.status(500).json({ error: err.message });
  }
};
