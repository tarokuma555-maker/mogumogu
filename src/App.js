import React, { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';

// ============================================================
// MoguMogu - 離乳食サポートアプリ
// ============================================================

// ---------- プレミアム課金システム ----------
const PremiumContext = createContext();

function PremiumProvider({ children }) {
  const [isPremium, setIsPremium] = useState(() => {
    try { return localStorage.getItem('mogumogu_premium') === 'true'; } catch { return false; }
  });
  const [searchCount, setSearchCount] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem('mogumogu_usage') || '{}');
      return d.date === new Date().toDateString() ? (d.search || 0) : 0;
    } catch { return 0; }
  });
  const [recipeGenCount, setRecipeGenCount] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem('mogumogu_usage') || '{}');
      return d.recipeGen || 0;
    } catch { return 0; }
  });
  const [commentCount, setCommentCount] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem('mogumogu_usage') || '{}');
      return d.date === new Date().toDateString() ? (d.comment || 0) : 0;
    } catch { return 0; }
  });
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallReason, setPaywallReason] = useState('');

  const saveUsage = (s, r, c) => {
    localStorage.setItem('mogumogu_usage', JSON.stringify({
      date: new Date().toDateString(), search: s, recipeGen: r, comment: c,
    }));
  };

  const togglePremium = () => {
    const next = !isPremium;
    setIsPremium(next);
    localStorage.setItem('mogumogu_premium', next.toString());
  };

  const trySearch = () => {
    if (isPremium) return true;
    if (searchCount >= 3) {
      setPaywallReason('search');
      setShowPaywall(true);
      return false;
    }
    const n = searchCount + 1;
    setSearchCount(n);
    saveUsage(n, recipeGenCount, commentCount);
    return true;
  };

  const tryRecipeGen = () => {
    if (isPremium) return true;
    if (recipeGenCount >= 1) {
      setPaywallReason('recipe');
      setShowPaywall(true);
      return false;
    }
    const n = recipeGenCount + 1;
    setRecipeGenCount(n);
    saveUsage(searchCount, n, commentCount);
    return true;
  };

  const tryPost = () => {
    if (isPremium) return true;
    setPaywallReason('post');
    setShowPaywall(true);
    return false;
  };

  const tryComment = () => {
    if (isPremium) return true;
    if (commentCount >= 3) {
      setPaywallReason('comment');
      setShowPaywall(true);
      return false;
    }
    const n = commentCount + 1;
    setCommentCount(n);
    saveUsage(searchCount, recipeGenCount, n);
    return true;
  };

  return (
    <PremiumContext.Provider value={{
      isPremium, togglePremium,
      searchCount, recipeGenCount, commentCount,
      trySearch, tryRecipeGen, tryPost, tryComment,
      showPaywall, setShowPaywall, paywallReason, setPaywallReason,
    }}>
      {children}
    </PremiumContext.Provider>
  );
}

function usePremium() {
  return useContext(PremiumContext);
}

// ---------- Paywallモーダル ----------
const PAYWALL_REASONS = {
  search: { icon: '🔍', title: '検索回数の上限に達しました', desc: '無料プランは1日3回まで。プレミアムで無制限に！' },
  recipe: { icon: '🍳', title: 'AIレシピ生成の上限に達しました', desc: '無料プランは1回のみ。プレミアムで無制限に！' },
  post: { icon: '📷', title: 'SNS投稿はプレミアム限定です', desc: '無料プランは閲覧のみ。投稿するにはプレミアムへ！' },
  comment: { icon: '💬', title: 'コメント回数の上限に達しました', desc: '無料プランは1日3回まで。プレミアムで無制限に！' },
  general: { icon: '👑', title: 'プレミアムにアップグレード', desc: 'すべての機能を制限なく使えます' },
};

function PaywallModal() {
  const { showPaywall, setShowPaywall, paywallReason, togglePremium } = usePremium();
  const [selectedPlan, setSelectedPlan] = useState('yearly');
  if (!showPaywall) return null;
  const reason = PAYWALL_REASONS[paywallReason] || PAYWALL_REASONS.general;

  const handlePurchase = () => {
    togglePremium();
    setShowPaywall(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget) setShowPaywall(false); }}>
      <div style={{
        background: '#fff', borderRadius: '28px 28px 0 0', width: '100%', maxWidth: 480,
        maxHeight: '92vh', overflow: 'auto',
        padding: '0 0 env(safe-area-inset-bottom, 20px)',
      }}>
        {/* ハンドル */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#DDD' }} />
        </div>

        <div style={{ padding: '12px 20px 20px' }}>
          {/* ヘッダー */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>{reason.icon}</div>
            <div style={{ fontSize: FONT.xl - 2, fontWeight: 900, color: COLORS.text, marginBottom: SPACE.xs }}>
              {reason.title}
            </div>
            <div style={{ fontSize: FONT.sm, color: COLORS.textLight, lineHeight: 1.6 }}>{reason.desc}</div>
          </div>

          {/* 特典一覧 */}
          <div style={{
            background: `linear-gradient(135deg, #FFF8F0, #FFF0E0)`,
            borderRadius: 18, padding: 16, marginBottom: 16,
            border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ fontSize: FONT.base, fontWeight: 900, color: COLORS.primaryDark, marginBottom: SPACE.md, textAlign: 'center' }}>
              👑 プレミアム特典
            </div>
            {[
              { icon: '🚫', label: '全広告の完全除去', free: '広告あり' },
              { icon: '🔍', label: '食材検索 無制限', free: '1日3回' },
              { icon: '🤖', label: 'AIレシピ生成 無制限', free: '1回のみ' },
              { icon: '📷', label: 'SNS投稿 し放題', free: '閲覧のみ' },
              { icon: '💬', label: 'コメント 無制限', free: '1日3回' },
              { icon: '🎁', label: '7日間の無料トライアル', free: '−' },
            ].map((item) => (
              <div key={item.label} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                borderBottom: `1px solid ${COLORS.border}`,
              }}>
                <span style={{ fontSize: 18, width: 28, textAlign: 'center' }}>{item.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text }}>{item.label}</div>
                </div>
                <div style={{
                  fontSize: FONT.xs, color: COLORS.textLight, background: '#fff',
                  padding: `2px ${SPACE.sm}px`, borderRadius: 6, fontWeight: 600,
                }}>無料: {item.free}</div>
              </div>
            ))}
          </div>

          {/* プラン選択 */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            {/* 年額プラン */}
            <button onClick={() => setSelectedPlan('yearly')} style={{
              flex: 1, borderRadius: 16, padding: '14px 10px', cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'center', position: 'relative',
              border: selectedPlan === 'yearly' ? `3px solid ${COLORS.primaryDark}` : `2px solid ${COLORS.border}`,
              background: selectedPlan === 'yearly' ? '#FFF8F0' : '#fff',
              transition: 'all 0.2s',
            }}>
              <div style={{
                position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                background: COLORS.danger, color: '#fff', fontSize: 10, fontWeight: 900,
                padding: '2px 10px', borderRadius: 10, whiteSpace: 'nowrap',
              }}>34% OFF</div>
              <div style={{ fontSize: 11, color: COLORS.textLight, fontWeight: 600, marginBottom: 4, marginTop: 4 }}>年額プラン</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.primaryDark }}>¥3,800</div>
              <div style={{ fontSize: 10, color: COLORS.textLight }}>¥317/月</div>
              <div style={{ fontSize: 10, color: COLORS.textLight, textDecoration: 'line-through', marginTop: 2 }}>通常 ¥5,760/年</div>
            </button>
            {/* 月額プラン */}
            <button onClick={() => setSelectedPlan('monthly')} style={{
              flex: 1, borderRadius: 16, padding: '14px 10px', cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'center',
              border: selectedPlan === 'monthly' ? `3px solid ${COLORS.primaryDark}` : `2px solid ${COLORS.border}`,
              background: selectedPlan === 'monthly' ? '#FFF8F0' : '#fff',
              transition: 'all 0.2s',
            }}>
              <div style={{ fontSize: 11, color: COLORS.textLight, fontWeight: 600, marginBottom: 4, marginTop: 14 }}>月額プラン</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.text }}>¥480</div>
              <div style={{ fontSize: 10, color: COLORS.textLight }}>/月</div>
              <div style={{ fontSize: 10, color: 'transparent', marginTop: 2 }}>.</div>
            </button>
          </div>

          {/* 購入ボタン（デモ） */}
          <button onClick={handlePurchase} style={{
            width: '100%', padding: '16px', borderRadius: 16, border: 'none',
            background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
            color: '#fff', fontSize: FONT.lg, fontWeight: 900, cursor: 'pointer',
            fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(255,107,53,0.35)',
            marginBottom: SPACE.sm,
          }}>
            7日間無料で始める
          </button>
          <div style={{ textAlign: 'center', fontSize: FONT.sm, color: COLORS.textLight, lineHeight: 1.5, marginBottom: SPACE.sm }}>
            トライアル終了後 {selectedPlan === 'yearly' ? '¥3,800/年' : '¥480/月'}
            ・いつでも解約OK
          </div>

          <button onClick={() => setShowPaywall(false)} style={{
            width: '100%', padding: '12px', borderRadius: 12, border: 'none',
            background: 'none', color: COLORS.textLight, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            あとで
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 定数 ----------
const COLORS = {
  primary: '#FF8C42',
  primaryDark: '#FF6B35',
  bg: '#FFF8F0',
  card: '#FFFFFF',
  text: '#3D2C1E',
  textLight: '#8B7355',
  textMuted: '#A8977F',
  border: '#FFE0C2',
  danger: '#FF4757',
  success: '#2ED573',
  tagBg: '#FFF0E0',
};

const FONT = { xs: 10, sm: 12, base: 14, lg: 16, xl: 20, xxl: 28 };
const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };

const MONTH_STAGES = [
  { label: 'ゴックン期', range: '5〜6ヶ月', emoji: '🍼', months: [5, 6] },
  { label: 'モグモグ期', range: '7〜8ヶ月', emoji: '🥄', months: [7, 8] },
  { label: 'カミカミ期', range: '9〜11ヶ月', emoji: '🦷', months: [9, 10, 11] },
  { label: 'パクパク期', range: '12〜18ヶ月', emoji: '🍽️', months: [12, 13, 14, 15, 16, 17, 18] },
];

const ALLERGENS = [
  { id: 'egg', name: '卵', emoji: '🥚' },
  { id: 'milk', name: '乳', emoji: '🥛' },
  { id: 'wheat', name: '小麦', emoji: '🌾' },
  { id: 'shrimp', name: 'えび', emoji: '🦐' },
  { id: 'crab', name: 'かに', emoji: '🦀' },
  { id: 'peanut', name: '落花生', emoji: '🥜' },
  { id: 'soba', name: 'そば', emoji: '🍜' },
  { id: 'soy', name: '大豆', emoji: '🫘' },
];

const SHORTS_DATA = [
  {
    id: 1,
    title: 'にんじんペースト',
    stage: 'ゴックン期',
    stageEmoji: '🍼',
    thumbnail: '🥕',
    gradientFrom: '#FF6B35',
    gradientTo: '#FF8C42',
    author: 'もぐもぐママ',
    authorAvatar: '👩‍🍳',
    likes: 1243,
    comments: 89,
    description: 'やわらかく茹でてブレンダーでなめらかに♪\n初めての野菜にぴったり！',
    tags: ['#初期離乳食', '#にんじん', '#簡単レシピ'],
    steps: ['にんじんを薄くスライス', '柔らかくなるまで茹でる（15分）', 'ブレンダーでペースト状に', 'だし汁で伸ばして完成！'],
  },
  {
    id: 2,
    title: 'かぼちゃのマッシュ',
    stage: 'ゴックン期',
    stageEmoji: '🍼',
    thumbnail: '🎃',
    gradientFrom: '#F39C12',
    gradientTo: '#FDCB6E',
    author: 'パパごはん',
    authorAvatar: '👨‍🍳',
    likes: 892,
    comments: 56,
    description: '甘くてクリーミー！赤ちゃん大好き♡\n自然の甘さで食べやすい',
    tags: ['#かぼちゃ', '#離乳食初期', '#甘い'],
    steps: ['かぼちゃの種を取り除く', 'レンジで5分加熱', 'スプーンで実をすくう', 'なめらかになるまで潰す'],
  },
  {
    id: 3,
    title: 'おかゆ + しらす',
    stage: 'モグモグ期',
    stageEmoji: '🥄',
    thumbnail: '🐟',
    gradientFrom: '#0984E3',
    gradientTo: '#74B9FF',
    author: 'ばぁばの知恵',
    authorAvatar: '👵',
    likes: 2051,
    comments: 134,
    description: 'タンパク質もしっかり！\nしらすの塩抜きがポイント',
    tags: ['#モグモグ期', '#しらす', '#タンパク質'],
    steps: ['しらすを熱湯で塩抜き（2分）', '7倍がゆを準備', 'しらすを細かく刻む', 'おかゆに混ぜて完成！'],
  },
  {
    id: 4,
    title: 'バナナパンケーキ',
    stage: 'カミカミ期',
    stageEmoji: '🦷',
    thumbnail: '🍌',
    gradientFrom: '#A29BFE',
    gradientTo: '#6C5CE7',
    author: 'おやつ研究家',
    authorAvatar: '🧑‍🔬',
    likes: 3210,
    comments: 201,
    description: '卵・牛乳不使用で安心♪\n手づかみ食べの練習にも◎',
    tags: ['#手づかみ食べ', '#バナナ', '#アレルギー対応'],
    steps: ['バナナをフォークで潰す', '米粉大さじ3を加えて混ぜる', '豆乳を少しずつ加える', '弱火でじっくり焼く'],
  },
  {
    id: 5,
    title: '豆腐ハンバーグ',
    stage: 'カミカミ期',
    stageEmoji: '🦷',
    thumbnail: '🍔',
    gradientFrom: '#E17055',
    gradientTo: '#FAB1A0',
    author: 'もぐもぐママ',
    authorAvatar: '👩‍🍳',
    likes: 1876,
    comments: 145,
    description: 'ふわふわ食感で食べやすい！\n野菜もたっぷり入れられます',
    tags: ['#豆腐', '#ハンバーグ', '#鉄分'],
    steps: ['豆腐を水切りする', 'みじん切り野菜を炒める', '材料を全部混ぜる', '両面こんがり焼いて完成'],
  },
  {
    id: 6,
    title: 'トマトリゾット',
    stage: 'パクパク期',
    stageEmoji: '🍽️',
    thumbnail: '🍅',
    gradientFrom: '#D63031',
    gradientTo: '#FF7675',
    author: 'イタリアンパパ',
    authorAvatar: '👨‍🍳',
    likes: 1534,
    comments: 98,
    description: '大人と取り分けOK！\nトマトの酸味がクセになる♪',
    tags: ['#パクパク期', '#取り分け', '#トマト'],
    steps: ['玉ねぎをみじん切りにする', 'ご飯とトマト缶を煮る', '粉チーズをひとふり', '冷ましてから盛り付け'],
  },
];

// ---------- リッチレシピデータベース ----------
const FULL_RECIPES = [
  // ===== ゴックン期 =====
  {
    id: 'r01', title: 'にんじんペースト', emoji: '🥕', stage: 'ゴックン期',
    ingredients: ['にんじん 1/3本', 'だし汁 大さじ2'],
    allergens: [],
    steps: ['にんじんを薄くスライスする', 'やわらかくなるまで15分茹でる', 'ブレンダーでなめらかにする', 'だし汁で食べやすい固さに伸ばす'],
    nutrition: { kcal: 15, protein: 0.3, iron: 0.1, vitA: '◎', vitC: '○' },
    tip: '初めての野菜にぴったり！加熱すると甘みが増します。冷凍ストック可。',
    time: 20, difficulty: 1, tags: ['にんじん', '野菜'],
  },
  {
    id: 'r02', title: 'かぼちゃマッシュ', emoji: '🎃', stage: 'ゴックン期',
    ingredients: ['かぼちゃ 30g', 'お湯 大さじ1〜2'],
    allergens: [],
    steps: ['かぼちゃの種とワタを取る', 'レンジ600Wで3分加熱', 'スプーンで実をすくう', 'お湯でなめらかに伸ばす'],
    nutrition: { kcal: 25, protein: 0.5, iron: 0.2, vitA: '◎', vitC: '◎' },
    tip: '自然な甘さで赤ちゃんに大人気。皮は取り除いてください。',
    time: 10, difficulty: 1, tags: ['かぼちゃ', '野菜'],
  },
  {
    id: 'r03', title: '10倍がゆ', emoji: '🍚', stage: 'ゴックン期',
    ingredients: ['ご飯 大さじ1', '水 150ml'],
    allergens: [],
    steps: ['ご飯と水を鍋に入れる', '弱火で20分煮る', '裏ごしする', 'なめらかなペースト状にする'],
    nutrition: { kcal: 20, protein: 0.4, iron: 0.1, vitA: '−', vitC: '−' },
    tip: '離乳食の基本！まとめて作って製氷皿で冷凍が便利。',
    time: 25, difficulty: 1, tags: ['おかゆ', '主食'],
  },
  {
    id: 'r04', title: 'ほうれん草ペースト', emoji: '🥬', stage: 'ゴックン期',
    ingredients: ['ほうれん草（葉先）3枚', 'だし汁 大さじ1'],
    allergens: [],
    steps: ['葉先だけをやわらかく茹でる', '水にさらしてアク抜き', 'すり鉢でなめらかにする', 'だし汁で伸ばす'],
    nutrition: { kcal: 8, protein: 0.3, iron: 0.5, vitA: '◎', vitC: '○' },
    tip: '鉄分豊富！茎は繊維が多いので葉先のみ使いましょう。',
    time: 15, difficulty: 1, tags: ['ほうれん草', '野菜'],
  },
  {
    id: 'r05', title: '豆腐のなめらかペースト', emoji: '🫧', stage: 'ゴックン期',
    ingredients: ['絹ごし豆腐 20g', 'だし汁 小さじ1'],
    allergens: ['soy'],
    steps: ['豆腐を沸騰したお湯で1分茹でる', 'すり鉢でなめらかにする', 'だし汁で伸ばす'],
    nutrition: { kcal: 12, protein: 1.2, iron: 0.3, vitA: '−', vitC: '−' },
    tip: '初めてのタンパク質源に最適。絹ごし豆腐が◎',
    time: 5, difficulty: 1, tags: ['豆腐', 'タンパク質'],
  },
  {
    id: 'r06', title: 'りんごのすりおろし', emoji: '🍎', stage: 'ゴックン期',
    ingredients: ['りんご 1/8個'],
    allergens: [],
    steps: ['りんごの皮をむく', 'すりおろし器でなめらかにする', 'レンジで20秒加熱してもOK'],
    nutrition: { kcal: 14, protein: 0.1, iron: 0, vitA: '−', vitC: '○' },
    tip: '加熱すると甘みUP＆殺菌効果も。生でもOKですがお腹が弱い子は加熱を。',
    time: 5, difficulty: 1, tags: ['りんご', '果物'],
  },
  // ===== モグモグ期 =====
  {
    id: 'r07', title: 'しらすがゆ', emoji: '🐟', stage: 'モグモグ期',
    ingredients: ['7倍がゆ 50g', 'しらす 小さじ1', 'だし汁 小さじ1'],
    allergens: [],
    steps: ['しらすを熱湯で塩抜き（2分）', '細かく刻む', '7倍がゆに混ぜる', 'だし汁で食べやすくする'],
    nutrition: { kcal: 35, protein: 2.5, iron: 0.2, vitA: '−', vitC: '−' },
    tip: 'カルシウムたっぷり！塩抜きは必ず行いましょう。',
    time: 10, difficulty: 1, tags: ['しらす', 'タンパク質', 'おかゆ'],
  },
  {
    id: 'r08', title: 'にんじんと豆腐の煮物', emoji: '🥕', stage: 'モグモグ期',
    ingredients: ['にんじん 20g', '絹ごし豆腐 20g', 'だし汁 大さじ3'],
    allergens: ['soy'],
    steps: ['にんじんを小さくみじん切り', 'だし汁でやわらかく煮る', '豆腐を加えて崩しながら煮る', '2〜3mm角の粒が残る程度に'],
    nutrition: { kcal: 28, protein: 1.8, iron: 0.4, vitA: '◎', vitC: '○' },
    tip: '豆腐がにんじんのパサつきを和らげてくれます。',
    time: 15, difficulty: 2, tags: ['にんじん', '豆腐', '野菜'],
  },
  {
    id: 'r09', title: 'バナナヨーグルト', emoji: '🍌', stage: 'モグモグ期',
    ingredients: ['バナナ 1/4本', 'プレーンヨーグルト 大さじ1'],
    allergens: ['milk'],
    steps: ['バナナをフォークで粗くつぶす', 'ヨーグルトと混ぜる'],
    nutrition: { kcal: 30, protein: 0.8, iron: 0.1, vitA: '−', vitC: '○' },
    tip: '混ぜるだけの超簡単レシピ！おやつにもぴったり。',
    time: 3, difficulty: 1, tags: ['バナナ', '果物', 'ヨーグルト'],
  },
  {
    id: 'r10', title: 'ささみと野菜のとろとろ煮', emoji: '🍗', stage: 'モグモグ期',
    ingredients: ['鶏ささみ 10g', 'にんじん 10g', 'かぼちゃ 10g', 'だし汁 大さじ4', '片栗粉 少々'],
    allergens: [],
    steps: ['ささみを茹でてほぐす', '野菜をみじん切りにしてだし汁で煮る', 'ささみを加えて煮る', '水溶き片栗粉でとろみをつける'],
    nutrition: { kcal: 35, protein: 3.5, iron: 0.3, vitA: '◎', vitC: '○' },
    tip: 'とろみをつけると飲み込みやすく！タンパク質と野菜が一度に摂れます。',
    time: 20, difficulty: 2, tags: ['鶏ささみ', 'にんじん', 'かぼちゃ', 'タンパク質'],
  },
  {
    id: 'r11', title: 'さつまいもとりんごの煮物', emoji: '🍠', stage: 'モグモグ期',
    ingredients: ['さつまいも 20g', 'りんご 15g', '水 大さじ3'],
    allergens: [],
    steps: ['さつまいもとりんごを5mm角に切る', '水と一緒に鍋に入れる', 'やわらかくなるまで10分煮る', 'フォークで粗くつぶす'],
    nutrition: { kcal: 32, protein: 0.3, iron: 0.2, vitA: '○', vitC: '◎' },
    tip: '自然な甘さのコンビ！おやつにもOK。水分が飛んだら足してね。',
    time: 15, difficulty: 1, tags: ['さつまいも', 'りんご', '果物'],
  },
  {
    id: 'r12', title: 'ブロッコリーのおかか和え', emoji: '🥦', stage: 'モグモグ期',
    ingredients: ['ブロッコリー（穂先）2房', 'かつお節 ひとつまみ', 'だし汁 小さじ1'],
    allergens: [],
    steps: ['ブロッコリーの穂先をやわらかく茹でる', 'みじん切りにする', 'かつお節とだし汁を加えて和える'],
    nutrition: { kcal: 10, protein: 0.8, iron: 0.3, vitA: '○', vitC: '◎' },
    tip: '穂先だけなら食べやすい！かつお節のうまみで食いつきUP。',
    time: 10, difficulty: 1, tags: ['ブロッコリー', '野菜'],
  },
  // ===== カミカミ期 =====
  {
    id: 'r13', title: 'バナナ米粉パンケーキ', emoji: '🍌', stage: 'カミカミ期',
    ingredients: ['バナナ 1/2本', '米粉 大さじ3', '豆乳 大さじ2'],
    allergens: ['soy'],
    steps: ['バナナをフォークで潰す', '米粉と豆乳を加えて混ぜる', 'フライパンで弱火で焼く', '小さめに焼いて冷ます'],
    nutrition: { kcal: 85, protein: 1.5, iron: 0.3, vitA: '−', vitC: '○' },
    tip: '卵・乳不使用！手づかみ食べの練習にぴったり。冷凍ストック可。',
    time: 15, difficulty: 2, tags: ['バナナ', '手づかみ', 'おやつ'],
  },
  {
    id: 'r14', title: '豆腐ハンバーグ', emoji: '🍔', stage: 'カミカミ期',
    ingredients: ['木綿豆腐 50g', '鶏ひき肉 20g', 'にんじん（すりおろし）10g', '片栗粉 小さじ1'],
    allergens: ['soy'],
    steps: ['豆腐を水切りする', 'すべての材料を混ぜる', '小判型に成形する', 'フライパンで両面こんがり焼く'],
    nutrition: { kcal: 65, protein: 5.8, iron: 0.8, vitA: '◎', vitC: '−' },
    tip: 'ふわふわ食感！野菜を混ぜ込めるので野菜嫌いの子にも◎',
    time: 20, difficulty: 2, tags: ['豆腐', '鶏肉', 'にんじん', 'タンパク質', '手づかみ'],
  },
  {
    id: 'r15', title: 'かぼちゃおやき', emoji: '🎃', stage: 'カミカミ期',
    ingredients: ['かぼちゃ 40g', '片栗粉 小さじ2', 'きな粉 小さじ1/2'],
    allergens: ['soy'],
    steps: ['かぼちゃをレンジで加熱してつぶす', '片栗粉ときな粉を混ぜる', '小さく丸めて平たくする', 'フライパンで両面焼く'],
    nutrition: { kcal: 50, protein: 1.0, iron: 0.3, vitA: '◎', vitC: '◎' },
    tip: 'もちもち食感で食べやすい！おやつにも主食にも。',
    time: 15, difficulty: 2, tags: ['かぼちゃ', '手づかみ', 'おやつ'],
  },
  {
    id: 'r16', title: 'にんじんスティック', emoji: '🥕', stage: 'カミカミ期',
    ingredients: ['にんじん 1/3本', 'だし汁 100ml'],
    allergens: [],
    steps: ['にんじんをスティック状に切る', 'だし汁でやわらかく煮る（15分）', '歯茎でつぶせる固さに確認', '手で持ちやすいサイズに'],
    nutrition: { kcal: 12, protein: 0.2, iron: 0.1, vitA: '◎', vitC: '○' },
    tip: '手づかみ食べの定番！指で簡単につぶせる固さが目安。',
    time: 20, difficulty: 1, tags: ['にんじん', '手づかみ', '野菜'],
  },
  {
    id: 'r17', title: 'トマトと鶏肉のうどん', emoji: '🍅', stage: 'カミカミ期',
    ingredients: ['ゆでうどん 40g', 'トマト 1/4個', '鶏ささみ 10g', 'だし汁 100ml'],
    allergens: ['wheat'],
    steps: ['うどんを1cm長に切る', 'トマトは湯むきして種を取り刻む', 'ささみは茹でて細かくほぐす', 'だし汁ですべて煮込む'],
    nutrition: { kcal: 70, protein: 4.2, iron: 0.4, vitA: '○', vitC: '◎' },
    tip: 'トマトの酸味でさっぱり！暑い日にもおすすめ。',
    time: 15, difficulty: 2, tags: ['トマト', '鶏ささみ', 'うどん', '麺'],
  },
  {
    id: 'r18', title: 'じゃがいもおやき', emoji: '🥔', stage: 'カミカミ期',
    ingredients: ['じゃがいも 1/2個', 'ほうれん草 2枚', 'しらす 小さじ1', '片栗粉 小さじ1'],
    allergens: [],
    steps: ['じゃがいもをレンジで加熱してつぶす', 'ほうれん草を茹でてみじん切り', 'しらすは塩抜きして刻む', '全て混ぜて焼く'],
    nutrition: { kcal: 55, protein: 2.0, iron: 0.5, vitA: '◎', vitC: '◎' },
    tip: '栄養バランス◎！まとめて作って冷凍すると便利。',
    time: 20, difficulty: 2, tags: ['じゃがいも', 'ほうれん草', 'しらす', '手づかみ'],
  },
  // ===== パクパク期 =====
  {
    id: 'r19', title: 'トマトリゾット', emoji: '🍅', stage: 'パクパク期',
    ingredients: ['ご飯 80g', 'トマト 1/2個', '玉ねぎ 10g', '粉チーズ 少々', 'オリーブオイル 少々'],
    allergens: ['milk'],
    steps: ['玉ねぎをみじん切りにして炒める', 'トマトは湯むきして刻んで加える', 'ご飯と水を加えて煮る', '粉チーズをふりかける'],
    nutrition: { kcal: 120, protein: 3.5, iron: 0.4, vitA: '○', vitC: '◎' },
    tip: '大人と取り分けOK！味付け前に取り分けましょう。',
    time: 15, difficulty: 2, tags: ['トマト', '主食', 'チーズ'],
  },
  {
    id: 'r20', title: '鶏そぼろ丼', emoji: '🍗', stage: 'パクパク期',
    ingredients: ['ご飯 80g', '鶏ひき肉 20g', 'にんじん 10g', 'ほうれん草 2枚', '醤油 少々', 'だし汁 大さじ2'],
    allergens: ['soy'],
    steps: ['にんじんをみじん切りにする', '鶏ひき肉をだし汁で炒め煮', 'にんじんを加えて煮る', 'ほうれん草を茹でて刻みご飯にのせる'],
    nutrition: { kcal: 130, protein: 6.0, iron: 0.8, vitA: '◎', vitC: '○' },
    tip: '彩りキレイで食欲UP！醤油はほんの少しでOK。',
    time: 20, difficulty: 2, tags: ['鶏肉', 'にんじん', 'ほうれん草', '主食'],
  },
  {
    id: 'r21', title: 'かぼちゃグラタン', emoji: '🎃', stage: 'パクパク期',
    ingredients: ['かぼちゃ 40g', 'マカロニ 15g', '牛乳 大さじ3', '粉チーズ 小さじ1', '小麦粉 小さじ1/2', 'バター 少々'],
    allergens: ['milk', 'wheat'],
    steps: ['かぼちゃをレンジで加熱してつぶす', 'マカロニを茹でて小さく切る', 'バターで小麦粉を炒め牛乳を加えホワイトソースに', 'すべて混ぜて粉チーズをかけトースターで焼く'],
    nutrition: { kcal: 110, protein: 3.8, iron: 0.4, vitA: '◎', vitC: '◎' },
    tip: 'クリーミーで大人気！牛乳を豆乳に変えれば乳アレルギー対応に。',
    time: 25, difficulty: 3, tags: ['かぼちゃ', 'マカロニ', 'チーズ'],
  },
  {
    id: 'r22', title: 'さつまいもスティック', emoji: '🍠', stage: 'パクパク期',
    ingredients: ['さつまいも 1/3本', 'きな粉 小さじ1/2'],
    allergens: ['soy'],
    steps: ['さつまいもをスティック状に切る', '水にさらしてアク抜き', '蒸すか茹でてやわらかくする', 'きな粉をまぶす'],
    nutrition: { kcal: 48, protein: 0.6, iron: 0.2, vitA: '○', vitC: '◎' },
    tip: '自然な甘さのおやつ！持ちやすいサイズに切ってあげてね。',
    time: 15, difficulty: 1, tags: ['さつまいも', '手づかみ', 'おやつ'],
  },
  {
    id: 'r23', title: 'ミネストローネ', emoji: '🍅', stage: 'パクパク期',
    ingredients: ['トマト 1/4個', 'じゃがいも 15g', 'にんじん 10g', '玉ねぎ 10g', 'マカロニ 10g', 'だし汁 150ml'],
    allergens: ['wheat'],
    steps: ['すべての野菜を5mm角に切る', 'だし汁で野菜をやわらかく煮る', '刻んだトマトとマカロニを加える', 'マカロニがやわらかくなるまで煮る'],
    nutrition: { kcal: 65, protein: 1.5, iron: 0.3, vitA: '○', vitC: '◎' },
    tip: '野菜たっぷりスープ！大人の分は塩コショウで味を調整。',
    time: 20, difficulty: 2, tags: ['トマト', 'じゃがいも', 'にんじん', 'スープ'],
  },
  {
    id: 'r24', title: 'ブロッコリーチーズおにぎり', emoji: '🥦', stage: 'パクパク期',
    ingredients: ['ご飯 60g', 'ブロッコリー（穂先）1房', 'プロセスチーズ 5g'],
    allergens: ['milk'],
    steps: ['ブロッコリーを茹でてみじん切り', 'チーズを小さく切る', 'ご飯に混ぜ込む', '小さく握る'],
    nutrition: { kcal: 95, protein: 3.2, iron: 0.3, vitA: '○', vitC: '◎' },
    tip: '手づかみおにぎり！お出かけにもぴったりです。',
    time: 10, difficulty: 1, tags: ['ブロッコリー', 'チーズ', '手づかみ', '主食'],
  },
  // ===== コンビネーション向け追加 =====
  {
    id: 'r25', title: 'にんじん×かぼちゃのポタージュ', emoji: '🥕', stage: 'ゴックン期',
    ingredients: ['にんじん 15g', 'かぼちゃ 15g', 'だし汁 大さじ3'],
    allergens: [],
    steps: ['にんじんとかぼちゃを小さく切る', 'やわらかくなるまで茹でる', 'ブレンダーでなめらかにする', 'だし汁で伸ばす'],
    nutrition: { kcal: 20, protein: 0.4, iron: 0.2, vitA: '◎', vitC: '◎' },
    tip: '栄養満点コンビ！色も鮮やかで赤ちゃんの食欲UP。',
    time: 20, difficulty: 1, tags: ['にんじん', 'かぼちゃ', '野菜', 'スープ'],
  },
  {
    id: 'r26', title: 'ほうれん草×しらすの和風パスタ', emoji: '🥬', stage: 'カミカミ期',
    ingredients: ['マカロニ 20g', 'ほうれん草 2枚', 'しらす 小さじ1', 'だし汁 大さじ3', '醤油 1滴'],
    allergens: ['wheat'],
    steps: ['マカロニを茹でて1cmに切る', 'ほうれん草を茹でてみじん切り', 'しらすを塩抜きする', 'だし汁ですべて和える'],
    nutrition: { kcal: 55, protein: 3.0, iron: 0.7, vitA: '◎', vitC: '○' },
    tip: '鉄分たっぷりコンビ！貧血予防におすすめ。',
    time: 15, difficulty: 2, tags: ['ほうれん草', 'しらす', 'マカロニ', '麺'],
  },
  {
    id: 'r27', title: 'バナナ×さつまいもの茶巾', emoji: '🍌', stage: 'カミカミ期',
    ingredients: ['さつまいも 30g', 'バナナ 1/4本'],
    allergens: [],
    steps: ['さつまいもをレンジで加熱してつぶす', 'バナナをフォークでつぶす', '両方を混ぜ合わせる', 'ラップで丸く包んで茶巾にする'],
    nutrition: { kcal: 45, protein: 0.4, iron: 0.2, vitA: '○', vitC: '◎' },
    tip: '砂糖不使用の天然スイーツ！見た目もかわいくてテンションUP。',
    time: 10, difficulty: 1, tags: ['バナナ', 'さつまいも', 'おやつ', '手づかみ'],
  },
  {
    id: 'r28', title: '豆腐×トマトのだし煮', emoji: '🫧', stage: 'モグモグ期',
    ingredients: ['絹ごし豆腐 30g', 'トマト 1/4個', 'だし汁 大さじ3'],
    allergens: ['soy'],
    steps: ['トマトを湯むきして種を取り刻む', '豆腐を1cm角に切る', 'だし汁でトマトを煮る', '豆腐を加えてやさしく煮る'],
    nutrition: { kcal: 22, protein: 1.8, iron: 0.4, vitA: '○', vitC: '◎' },
    tip: 'トマトの酸味で食がすすむ！豆腐は崩れやすいのでやさしく混ぜて。',
    time: 10, difficulty: 1, tags: ['豆腐', 'トマト', 'タンパク質'],
  },
];

// 人気の組み合わせ
const POPULAR_COMBOS = [
  { id: 'c1', items: ['にんじん', 'かぼちゃ'], emoji1: '🥕', emoji2: '🎃', label: 'にんじん × かぼちゃ', description: '甘さダブルで食いつき◎' },
  { id: 'c2', items: ['ほうれん草', 'しらす'], emoji1: '🥬', emoji2: '🐟', label: 'ほうれん草 × しらす', description: '鉄分＆カルシウム最強' },
  { id: 'c3', items: ['バナナ', 'さつまいも'], emoji1: '🍌', emoji2: '🍠', label: 'バナナ × さつまいも', description: '天然の甘さでおやつに' },
  { id: 'c4', items: ['豆腐', 'トマト'], emoji1: '🫧', emoji2: '🍅', label: '豆腐 × トマト', description: 'さっぱりタンパク質' },
];

// ---------- 広告データ（12種） ----------
const AD_BANNERS = [
  { id: 'ad01', brand: 'コープデリ', emoji: '🚚', color: '#00833E', tagline: '子育て家庭に大人気！', desc: '離乳食食材も玄関先にお届け', cta: '無料資料請求はこちら' },
  { id: 'ad02', brand: 'プレミアムウォーター', emoji: '💧', color: '#0077C8', tagline: 'ミルク作りに安心の天然水', desc: '赤ちゃんにやさしい軟水ウォーターサーバー', cta: 'お得に始める' },
  { id: 'ad03', brand: 'トイサブ！', emoji: '🧸', color: '#FF6B9D', tagline: '知育おもちゃのサブスク', desc: '月齢にぴったりのおもちゃが届く', cta: '初月半額キャンペーン' },
  { id: 'ad04', brand: 'カインデスト', emoji: '🍼', color: '#7EC8B0', tagline: '小児科医監修の離乳食', desc: 'オーガニック素材のベビーフード定期便', cta: '初回限定セットを見る' },
  { id: 'ad05', brand: 'Famm出張撮影', emoji: '📸', color: '#F5A623', tagline: '家族の思い出をプロの写真で', desc: '離乳食デビューの記念撮影にも', cta: '撮影を予約する' },
  { id: 'ad06', brand: 'Oisix', emoji: '🥬', color: '#7CB342', tagline: 'Kit Oisixで時短ごはん', desc: '離乳食取り分けレシピ付きミールキット', cta: 'おためしセット1,980円' },
  { id: 'ad07', brand: 'CaSy', emoji: '✨', color: '#6C63FF', tagline: '家事代行で育児に余裕を', desc: '料理・掃除をプロにおまかせ', cta: '初回お試し2,500円〜' },
  { id: 'ad08', brand: 'ほけんの窓口', emoji: '🛡️', color: '#E65100', tagline: '学資保険の無料相談', desc: 'お子さまの将来に備える保険選び', cta: '無料で相談する' },
  { id: 'ad09', brand: 'ブラウン ブレンダー', emoji: '🔧', color: '#333333', tagline: '離乳食作りの必需品', desc: 'ハンドブレンダー マルチクイック', cta: '詳しく見る' },
  { id: 'ad10', brand: 'リッチェル 冷凍容器', emoji: '🧊', color: '#00BCD4', tagline: 'わけわけフリージング', desc: '離乳食の小分け冷凍に便利な容器', cta: '商品をチェック' },
  { id: 'ad11', brand: 'パルシステム', emoji: '🐄', color: '#E8383D', tagline: '産直食材を食卓へ', desc: 'うらごし野菜シリーズが離乳食に便利', cta: '無料おためしセット' },
  { id: 'ad12', brand: 'ユニクロベビー', emoji: '👶', color: '#FF0000', tagline: 'やわらか素材のベビー服', desc: '食べこぼしに強い！洗濯ラクちん', cta: 'オンラインストアへ' },
];

function getAd(index) {
  return AD_BANNERS[Math.floor(index) % AD_BANNERS.length];
}

// ---------- スタイル ----------
const styles = {
  app: {
    fontFamily: '"Zen Maru Gothic", "Rounded Mplus 1c", sans-serif',
    background: COLORS.bg,
    minHeight: '100vh',
    maxWidth: 480,
    margin: '0 auto',
    position: 'relative',
    paddingBottom: 80,
    color: COLORS.text,
    overflowX: 'hidden',
  },
  tabBar: {
    position: 'fixed',
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    width: '100%',
    maxWidth: 480,
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    background: 'rgba(255,255,255,0.92)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderTop: `1px solid ${COLORS.border}`,
    padding: '4px 0 env(safe-area-inset-bottom, 8px)',
    zIndex: 1000,
    boxShadow: '0 -4px 20px rgba(0,0,0,0.04)',
  },
  tabItem: (active) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '8px 14px',
    minHeight: 44,
    minWidth: 44,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: FONT.xs,
    fontWeight: active ? 700 : 500,
    color: active ? COLORS.primaryDark : COLORS.textLight,
    fontFamily: 'inherit',
    transition: 'color 0.25s ease, transform 0.25s ease',
    WebkitTapHighlightColor: 'transparent',
    position: 'relative',
  }),
  tabIcon: (active) => ({
    fontSize: 24,
    opacity: active ? 1 : 0.5,
    transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease',
    transform: active ? 'scale(1.18) translateY(-1px)' : 'scale(1)',
  }),
  tabIndicator: {
    width: 20,
    height: 3,
    borderRadius: 2,
    background: COLORS.primaryDark,
    marginTop: 2,
  },
  header: {
    background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
    color: '#fff',
    padding: `${SPACE.md}px ${SPACE.lg}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    boxShadow: '0 2px 12px rgba(255,107,53,0.3)',
  },
  headerTitle: {
    fontSize: FONT.xl,
    fontWeight: 900,
    letterSpacing: 1,
  },
};

// ---------- タブバー ----------
const TABS = [
  { id: 'home', label: 'ホーム', icon: '🏠' },
  { id: 'search', label: '検索', icon: '🔍' },
  { id: 'share', label: 'シェア', icon: '📷' },
  { id: 'recipe', label: 'レシピ', icon: '🍳' },
  { id: 'settings', label: '設定', icon: '⚙️' },
];

// ============================================================
// コンポーネント
// ============================================================

// ---------- ヘッダー ----------
function Header({ title, subtitle }) {
  return (
    <div style={styles.header}>
      <div>
        <div style={styles.headerTitle}>{title}</div>
        {subtitle && <div style={{ fontSize: FONT.sm, opacity: 0.9, marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ fontSize: 28 }}>🍙</div>
    </div>
  );
}

// ---------- 広告コンポーネント ----------
function BannerAd({ ad, style: extraStyle }) {
  const { isPremium } = usePremium();
  const [dismissed, setDismissed] = useState(false);
  if (isPremium || dismissed || !ad) return null;
  return (
    <div className="tap-scale" style={{
      background: '#fff', borderRadius: 18, border: `1px solid ${COLORS.border}`,
      padding: `${SPACE.md}px ${SPACE.lg}px`, display: 'flex', alignItems: 'center', gap: SPACE.md,
      position: 'relative', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', ...extraStyle,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12, background: `${ad.color}15`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0,
      }}>{ad.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontWeight: 700, fontSize: FONT.sm, color: COLORS.text }}>{ad.brand}</span>
          <span style={{
            color: COLORS.textMuted, fontSize: FONT.xs, fontWeight: 600,
          }}>PR</span>
        </div>
        <div style={{ fontSize: FONT.sm, color: COLORS.textLight, lineHeight: 1.4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.tagline}</div>
      </div>
      <button onClick={() => setDismissed(true)} style={{
        position: 'absolute', top: 6, right: 8, background: 'none', border: 'none',
        fontSize: FONT.sm, color: COLORS.textLight, cursor: 'pointer', padding: SPACE.xs,
        lineHeight: 1, opacity: 0.5, width: 32, height: 32,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>✕</button>
    </div>
  );
}

function BannerAdLarge({ ad, style: extraStyle }) {
  const { isPremium } = usePremium();
  const [dismissed, setDismissed] = useState(false);
  if (isPremium || dismissed || !ad) return null;
  return (
    <div style={{
      background: '#fff', borderRadius: 20, border: `1px solid ${COLORS.border}`,
      overflow: 'hidden', position: 'relative',
      boxShadow: '0 2px 10px rgba(0,0,0,0.04)', ...extraStyle,
    }}>
      <button onClick={() => setDismissed(true)} style={{
        position: 'absolute', top: 10, right: 12, background: 'rgba(0,0,0,0.04)',
        border: 'none', borderRadius: '50%', width: 32, height: 32, fontSize: FONT.sm,
        color: COLORS.textLight, cursor: 'pointer', zIndex: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>✕</button>
      <div style={{
        background: `${ad.color}12`,
        padding: `${SPACE.xl}px ${SPACE.lg}px ${SPACE.lg}px`, position: 'relative',
        textAlign: 'center',
      }}>
        <span style={{
          position: 'absolute', top: 10, left: 12,
          color: COLORS.textMuted, fontSize: FONT.xs, fontWeight: 600,
        }}>PR</span>
        <div style={{ fontSize: 38, marginBottom: 6 }}>{ad.emoji}</div>
        <div style={{ fontSize: FONT.lg, fontWeight: 900, color: COLORS.text, marginBottom: 4 }}>{ad.brand}</div>
        <div style={{ fontSize: FONT.sm, color: COLORS.textLight, lineHeight: 1.5 }}>{ad.desc}</div>
      </div>
      <div style={{ padding: `${SPACE.md}px ${SPACE.lg}px`, textAlign: 'center' }}>
        <div style={{ fontSize: FONT.sm, color: COLORS.textLight, marginBottom: SPACE.sm }}>{ad.tagline}</div>
        <button className="tap-scale" style={{
          background: `linear-gradient(135deg, ${ad.color}, ${ad.color}cc)`,
          color: '#fff', border: 'none', borderRadius: 12, padding: '10px 24px',
          fontWeight: 700, fontSize: FONT.base, cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: `0 2px 8px ${ad.color}22`,
        }}>{ad.cta}</button>
      </div>
    </div>
  );
}

function ShortsAd({ ad }) {
  const { isPremium } = usePremium();
  const [dismissed, setDismissed] = useState(false);
  if (isPremium || dismissed || !ad) return null;
  return (
    <div style={{
      height: 'calc(100vh - 140px)', minHeight: 500,
      background: `linear-gradient(160deg, ${ad.color}, ${ad.color}aa)`,
      position: 'relative', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      scrollSnapAlign: 'start', flexShrink: 0, overflow: 'hidden',
    }}>
      <span style={{
        position: 'absolute', top: 14, left: 14,
        color: 'rgba(255,255,255,0.5)', fontSize: FONT.xs, fontWeight: 600,
      }}>PR</span>
      <button onClick={() => setDismissed(true)} style={{
        position: 'absolute', top: 12, right: 14, background: 'rgba(255,255,255,0.15)',
        border: 'none', borderRadius: '50%', width: 36, height: 36,
        color: 'rgba(255,255,255,0.6)', fontSize: FONT.lg, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>✕</button>
      <div style={{ fontSize: 60, marginBottom: SPACE.lg }}>{ad.emoji}</div>
      <div style={{ color: '#fff', fontWeight: 900, fontSize: FONT.xxl, marginBottom: 6, textAlign: 'center' }}>
        {ad.brand}
      </div>
      <div style={{
        color: 'rgba(255,255,255,0.9)', fontSize: FONT.base, textAlign: 'center',
        maxWidth: 280, lineHeight: 1.7, marginBottom: SPACE.sm,
      }}>{ad.desc}</div>
      <div style={{
        color: 'rgba(255,255,255,0.65)', fontSize: FONT.sm, marginBottom: SPACE.xl, textAlign: 'center',
      }}>{ad.tagline}</div>
      <button className="tap-scale" style={{
        background: 'rgba(255,255,255,0.95)', color: ad.color, border: 'none',
        borderRadius: 16, padding: '14px 36px', fontWeight: 900, fontSize: FONT.lg,
        cursor: 'pointer', fontFamily: 'inherit',
        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
      }}>{ad.cta}</button>
    </div>
  );
}

// ---------- ShortsCard ----------
function ShortsCard({ item, isActive }) {
  const [liked, setLiked] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  return (
    <div style={{
      height: 'calc(100vh - 140px)',
      minHeight: 500,
      background: `linear-gradient(160deg, ${item.gradientFrom}, ${item.gradientTo})`,
      borderRadius: 0,
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      overflow: 'hidden',
      scrollSnapAlign: 'start',
      flexShrink: 0,
    }}>
      {/* 背景の絵文字 */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -60%)',
        fontSize: 140,
        opacity: 0.2,
        filter: 'blur(2px)',
        pointerEvents: 'none',
      }}>
        {item.thumbnail}
      </div>

      {/* 中央コンテンツ */}
      <div style={{
        position: 'absolute',
        top: '30%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        textAlign: 'center',
        color: '#fff',
        zIndex: 2,
      }}>
        <div style={{ fontSize: 80, marginBottom: 8 }}>{item.thumbnail}</div>
        <div style={{
          fontSize: FONT.sm,
          background: 'rgba(255,255,255,0.25)',
          backdropFilter: 'blur(8px)',
          borderRadius: 20,
          padding: `${SPACE.xs}px ${SPACE.md}px`,
          display: 'inline-block',
          fontWeight: 700,
        }}>
          {item.stageEmoji} {item.stage}
        </div>
      </div>

      {/* 右側アクションバー */}
      <div style={{
        position: 'absolute',
        right: 14,
        bottom: 180,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        alignItems: 'center',
        zIndex: 10,
      }}>
        <ActionButton
          icon={liked ? '❤️' : '🤍'}
          label={liked ? item.likes + 1 : item.likes}
          onClick={() => setLiked(!liked)}
          active={liked}
        />
        <ActionButton icon="💬" label={item.comments} />
        <ActionButton icon="🔖" label="保存" />
        <ActionButton icon="↗️" label="共有" />
      </div>

      {/* 下部テキスト */}
      <div style={{
        padding: `0 ${SPACE.lg}px ${SPACE.xl}px`,
        background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
        paddingTop: 60,
        position: 'relative',
        zIndex: 5,
      }}>
        {/* 作者 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            border: '2px solid rgba(255,255,255,0.5)',
          }}>
            {item.authorAvatar}
          </div>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: FONT.base }}>{item.author}</span>
          <button className="tap-scale" style={{
            background: 'rgba(255,255,255,0.25)',
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: 14,
            color: '#fff',
            padding: '8px 16px',
            fontSize: FONT.sm,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            フォロー
          </button>
        </div>

        <div style={{ color: '#fff', fontWeight: 900, fontSize: FONT.xl, marginBottom: 6 }}>
          {item.title}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: FONT.base, lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: SPACE.sm }}>
          {item.description}
        </div>

        {/* タグ */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {item.tags.map((tag) => (
            <span key={tag} style={{
              background: 'rgba(255,255,255,0.2)',
              color: '#fff',
              padding: '2px 10px',
              borderRadius: 12,
              fontSize: FONT.sm,
              fontWeight: 500,
            }}>
              {tag}
            </span>
          ))}
        </div>

        {/* レシピ手順 */}
        <button
          className="tap-scale"
          onClick={() => setShowSteps(!showSteps)}
          style={{
            background: 'rgba(255,255,255,0.2)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 12,
            color: '#fff',
            padding: `${SPACE.sm}px ${SPACE.lg}px`,
            fontSize: FONT.base,
            fontWeight: 700,
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
            fontFamily: 'inherit',
          }}
        >
          {showSteps ? '📖 手順を閉じる' : '📖 作り方を見る'}
        </button>

        {showSteps && (
          <div style={{
            marginTop: 8,
            background: 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(8px)',
            borderRadius: 12,
            padding: 14,
          }}>
            {item.steps.map((step, i) => (
              <div key={i} style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                marginBottom: i < item.steps.length - 1 ? 8 : 0,
                color: '#fff',
                fontSize: FONT.base,
              }}>
                <span style={{
                  background: 'rgba(255,255,255,0.3)',
                  borderRadius: '50%',
                  width: 22,
                  height: 22,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: FONT.sm,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                <span style={{ lineHeight: 1.5 }}>{step}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick, active }) {
  return (
    <button
      className="tap-light"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: `${SPACE.sm}px ${SPACE.xs}px`,
        minWidth: 44,
        minHeight: 44,
      }}
    >
      <span style={{
        fontSize: 28,
        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
        transition: 'transform 0.2s',
        transform: active ? 'scale(1.2)' : 'scale(1)',
      }}>
        {icon}
      </span>
      <span style={{
        color: '#fff',
        fontSize: FONT.sm,
        fontWeight: 700,
        textShadow: '0 1px 3px rgba(0,0,0,0.5)',
      }}>
        {typeof label === 'number' ? label.toLocaleString() : label}
      </span>
    </button>
  );
}

// ---------- ホームタブ ----------
function HomeTab() {
  const containerRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const scrollTop = containerRef.current.scrollTop;
    const cardHeight = containerRef.current.clientHeight;
    const idx = Math.round(scrollTop / cardHeight);
    setCurrentIndex(idx);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.addEventListener('scroll', handleScroll, { passive: true });
      return () => el.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  return (
    <div style={{ position: 'relative' }}>
      {/* インジケーター */}
      <div style={{
        position: 'fixed',
        top: 60,
        right: 14,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}>
        {SHORTS_DATA.map((_, i) => (
          <div key={i} style={{
            width: 5,
            height: i === currentIndex ? 18 : 5,
            borderRadius: 3,
            background: i === currentIndex ? '#fff' : 'rgba(255,255,255,0.4)',
            transition: 'all 0.3s',
          }} />
        ))}
      </div>

      <div
        ref={containerRef}
        style={{
          height: 'calc(100vh - 80px)',
          overflowY: 'scroll',
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {SHORTS_DATA.map((item, i) => (
          <React.Fragment key={item.id}>
            <ShortsCard item={item} isActive={i === currentIndex} />
            {(i + 1) % 4 === 0 && <ShortsAd ad={getAd(Math.floor(i / 4))} />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ---------- レシピカード ----------
function RecipeCard({ recipe, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen || false);
  const difficultyStars = '★'.repeat(recipe.difficulty) + '☆'.repeat(3 - recipe.difficulty);
  return (
    <div style={{
      background: '#fff',
      borderRadius: 20,
      border: `1px solid ${COLORS.border}`,
      marginBottom: 14,
      overflow: 'hidden',
      boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
    }}>
      {/* ヘッダー */}
      <button
        className="tap-scale"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.md}px`, textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
          <span style={{ fontSize: 36 }}>{recipe.emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: FONT.base, color: COLORS.text }}>{recipe.title}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: SPACE.xs, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
                color: '#fff', padding: '2px 8px', borderRadius: 8, fontSize: FONT.xs, fontWeight: 700,
              }}>{recipe.stage}</span>
              <span style={{ fontSize: FONT.sm, color: COLORS.textLight }}>⏱ {recipe.time}分</span>
              <span style={{ fontSize: FONT.sm, color: COLORS.primary }}>{difficultyStars}</span>
            </div>
          </div>
          <span style={{
            color: COLORS.primary, fontSize: 20, fontWeight: 700,
            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s',
          }}>›</span>
        </div>
      </button>

      {open && (
        <div style={{ padding: `0 ${SPACE.lg}px ${SPACE.lg}px`, animation: 'fadeInUp 0.3s ease-out' }}>
          {/* 材料 */}
          <div style={{
            background: COLORS.tagBg, borderRadius: 14, padding: SPACE.lg, marginBottom: SPACE.md,
          }}>
            <div style={{ fontSize: FONT.base, fontWeight: 700, marginBottom: SPACE.sm, color: COLORS.primaryDark }}>
              🧾 材料
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {recipe.ingredients.map((ing) => (
                <span key={ing} style={{
                  background: '#fff', borderRadius: 8, padding: `${SPACE.xs}px ${SPACE.sm + 2}px`,
                  fontSize: FONT.sm, color: COLORS.text, border: `1px solid ${COLORS.border}`,
                }}>{ing}</span>
              ))}
            </div>
          </div>

          {/* 手順 */}
          <div style={{ marginBottom: SPACE.md }}>
            <div style={{ fontSize: FONT.base, fontWeight: 700, marginBottom: SPACE.sm, color: COLORS.primaryDark }}>
              📖 作り方
            </div>
            {recipe.steps.map((step, i) => (
              <div key={i} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                marginBottom: i < recipe.steps.length - 1 ? SPACE.sm : 0,
              }}>
                <span style={{
                  background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
                  color: '#fff', borderRadius: '50%', width: 24, height: 24, fontSize: FONT.sm,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, flexShrink: 0,
                }}>{i + 1}</span>
                <span style={{ fontSize: FONT.sm, lineHeight: 1.6, color: COLORS.text }}>{step}</span>
              </div>
            ))}
          </div>

          {/* 栄養 */}
          <div style={{
            background: '#F0FFF4', borderRadius: 14, padding: SPACE.lg, marginBottom: SPACE.md,
            border: '1px solid #C6F6D5',
          }}>
            <div style={{ fontSize: FONT.base, fontWeight: 700, marginBottom: SPACE.sm, color: '#2F855A' }}>
              🥗 栄養めやす（1食分）
            </div>
            <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
              {[
                { label: 'カロリー', value: `${recipe.nutrition.kcal}kcal` },
                { label: 'タンパク質', value: `${recipe.nutrition.protein}g` },
                { label: '鉄分', value: `${recipe.nutrition.iron}mg` },
                { label: 'ビタミンA', value: recipe.nutrition.vitA },
                { label: 'ビタミンC', value: recipe.nutrition.vitC },
              ].map((n) => (
                <div key={n.label} style={{
                  background: '#fff', borderRadius: 10, padding: '6px 10px',
                  textAlign: 'center', minWidth: 60, border: '1px solid #C6F6D5',
                }}>
                  <div style={{ fontSize: FONT.xs, color: '#68D391', fontWeight: 600 }}>{n.label}</div>
                  <div style={{ fontSize: FONT.base, fontWeight: 900, color: '#2F855A' }}>{n.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* コツ */}
          <div style={{
            background: '#FFFFF0', borderRadius: 14, padding: SPACE.lg,
            border: '1px solid #FEFCBF',
          }}>
            <div style={{ fontSize: FONT.base, fontWeight: 700, marginBottom: SPACE.xs, color: '#B7791F' }}>
              💡 ワンポイント
            </div>
            <div style={{ fontSize: FONT.sm, lineHeight: 1.7, color: '#744210' }}>
              {recipe.tip}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 検索タブ ----------
function SearchTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const { isPremium, trySearch, searchCount } = usePremium();

  const handleSearch = (q) => {
    setQuery(q);
    if (q.trim() === '') {
      setResults([]);
      setHasSearched(false);
      return;
    }
    if (!trySearch()) { setQuery(''); return; }
    setHasSearched(true);
    const keywords = q.split(/[\s　×x+＋]+/).filter(Boolean);
    const filtered = FULL_RECIPES.filter((r) =>
      keywords.every((kw) =>
        r.title.includes(kw) ||
        r.tags.some((t) => t.includes(kw)) ||
        r.ingredients.some((ing) => ing.includes(kw)) ||
        r.stage.includes(kw)
      )
    );
    setResults(filtered);
  };

  const popularTags = [
    { label: 'にんじん', emoji: '🥕' },
    { label: 'かぼちゃ', emoji: '🎃' },
    { label: '豆腐', emoji: '🫧' },
    { label: 'バナナ', emoji: '🍌' },
    { label: 'しらす', emoji: '🐟' },
    { label: 'さつまいも', emoji: '🍠' },
    { label: 'ほうれん草', emoji: '🥬' },
    { label: 'トマト', emoji: '🍅' },
  ];

  return (
    <div className="fade-in">
      <Header title="🔍 食材レシピ検索" subtitle="食材名で離乳食レシピを探そう" />

      {/* 検索バー */}
      <div style={{ padding: `${SPACE.lg}px ${SPACE.lg}px 0` }}>
        <div style={{
          display: 'flex', alignItems: 'center', background: '#fff',
          borderRadius: 16, padding: `0 ${SPACE.lg}px`,
          border: `2px solid ${query ? COLORS.primary : COLORS.border}`,
          boxShadow: '0 2px 8px rgba(255,140,66,0.1)',
          transition: 'border-color 0.2s',
        }}>
          <span style={{ fontSize: 18, marginRight: SPACE.sm }}>🔍</span>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="食材名を入力（例: にんじん かぼちゃ）"
            style={{
              border: 'none', outline: 'none', padding: `${SPACE.md + 2}px 0`, fontSize: FONT.base, flex: 1,
              background: 'transparent', fontFamily: 'inherit', color: COLORS.text,
            }}
          />
          {query && (
            <button
              onClick={() => handleSearch('')}
              style={{
                background: COLORS.border, border: 'none', borderRadius: '50%',
                width: 32, height: 32, display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', fontSize: FONT.sm, color: COLORS.textLight,
              }}
            >✕</button>
          )}
        </div>
      </div>

      {/* 残回数バッジ */}
      {!isPremium && (
        <div style={{ padding: `${SPACE.sm}px ${SPACE.lg}px 0`, display: 'flex', justifyContent: 'flex-end' }}>
          <span style={{
            background: searchCount >= 3 ? '#FFF5F5' : COLORS.tagBg,
            color: searchCount >= 3 ? COLORS.danger : COLORS.primaryDark,
            fontSize: FONT.sm, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
            border: `1px solid ${searchCount >= 3 ? COLORS.danger + '44' : COLORS.border}`,
          }}>🔍 残り {Math.max(0, 3 - searchCount)}/3回（本日）</span>
        </div>
      )}

      {/* 検索前の画面 */}
      {!hasSearched && (
        <div style={{ padding: SPACE.lg }}>
          {/* 人気食材タグ */}
          <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.textLight, marginBottom: SPACE.sm + 2 }}>
            🔥 人気の食材
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.xxl }}>
            {popularTags.map((t) => (
              <button className="tap-scale" key={t.label} onClick={() => handleSearch(t.label)} style={{
                background: COLORS.tagBg, border: `1px solid ${COLORS.border}`,
                borderRadius: 20, padding: `${SPACE.sm}px ${SPACE.lg}px`, fontSize: FONT.sm, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', color: COLORS.text,
                display: 'flex', alignItems: 'center', gap: SPACE.xs,
              }}>{t.emoji} {t.label}</button>
            ))}
          </div>

          <BannerAdLarge ad={getAd(0)} style={{ marginBottom: SPACE.xxl }} />

          {/* 人気の組み合わせ */}
          <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.textLight, marginBottom: SPACE.sm + 2 }}>
            ✨ 人気の組み合わせ
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SPACE.sm + 2, marginBottom: SPACE.xxl }}>
            {POPULAR_COMBOS.map((combo) => (
              <button className="tap-scale" key={combo.id} onClick={() => handleSearch(combo.items.join(' '))} style={{
                background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16,
                padding: SPACE.lg, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              }}>
                <div style={{ fontSize: 28, marginBottom: SPACE.xs }}>
                  {combo.emoji1}<span style={{ fontSize: FONT.base, margin: '0 2px' }}>×</span>{combo.emoji2}
                </div>
                <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text, marginBottom: 2 }}>
                  {combo.label}
                </div>
                <div style={{ fontSize: FONT.xs, color: COLORS.textLight }}>{combo.description}</div>
              </button>
            ))}
          </div>

          <BannerAd ad={getAd(1)} style={{ marginBottom: SPACE.xxl }} />

          {/* 月齢別で探す */}
          <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.textLight, marginBottom: SPACE.sm + 2 }}>
            📂 月齢別で探す
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm + 2 }}>
            {MONTH_STAGES.map((stage) => (
              <button className="tap-scale" key={stage.label} onClick={() => handleSearch(stage.label)} style={{
                background: '#fff', borderRadius: 16, padding: `${SPACE.md + 2}px ${SPACE.lg}px`,
                border: `1px solid ${COLORS.border}`, display: 'flex',
                alignItems: 'center', gap: SPACE.md, cursor: 'pointer',
                fontFamily: 'inherit', textAlign: 'left', width: '100%',
              }}>
                <span style={{ fontSize: 28 }}>{stage.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: FONT.base, color: COLORS.text }}>{stage.label}</div>
                  <div style={{ fontSize: FONT.sm, color: COLORS.textLight }}>{stage.range}</div>
                </div>
                <span style={{ color: COLORS.textLight, fontSize: FONT.sm }}>
                  {FULL_RECIPES.filter((r) => r.stage === stage.label).length}品
                </span>
                <span style={{ color: COLORS.primary, fontSize: 18, fontWeight: 700 }}>›</span>
              </button>
            ))}
          </div>
          <BannerAd ad={getAd(2)} style={{ marginTop: SPACE.lg, marginBottom: SPACE.sm }} />
          <BannerAdLarge ad={getAd(3)} style={{ marginTop: SPACE.sm }} />
        </div>
      )}

      {/* 検索結果 */}
      {hasSearched && (
        <div style={{ padding: SPACE.lg, animation: 'fadeInUp 0.3s ease-out' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg,
          }}>
            <div style={{ fontSize: FONT.sm, color: COLORS.textLight }}>
              {results.length > 0
                ? `🍳 ${results.length}件のレシピが見つかりました`
                : '😢 一致するレシピがありません'}
            </div>
            <button className="tap-scale" onClick={() => handleSearch('')} style={{
              background: COLORS.tagBg, border: `1px solid ${COLORS.border}`,
              borderRadius: 12, padding: `${SPACE.xs}px ${SPACE.md}px`, fontSize: FONT.sm, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', color: COLORS.textLight,
            }}>クリア</button>
          </div>
          {results.map((r, i) => (
            <React.Fragment key={r.id}>
              <RecipeCard recipe={r} defaultOpen={results.length === 1} />
              {i === 1 && <BannerAd ad={getAd(4)} style={{ marginBottom: SPACE.lg }} />}
              {i === 4 && <BannerAdLarge ad={getAd(5)} style={{ marginBottom: SPACE.lg }} />}
              {i === 7 && <BannerAd ad={getAd(6)} style={{ marginBottom: SPACE.lg }} />}
            </React.Fragment>
          ))}
          {results.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 60, marginBottom: SPACE.md }}>🔍</div>
              <div style={{ fontSize: FONT.base, color: COLORS.textLight, lineHeight: 1.8 }}>
                別の食材名で検索してみてください。<br />
                スペース区切りで複数食材の検索もできます。
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- もぐもぐシェア SNSデータ ----------
const STORY_USERS = [
  { id: 'me', name: 'あなた', avatar: '📷', isMe: true, hasStory: false, color: COLORS.textLight },
  { id: 'u1', name: 'ゆいママ', avatar: '👩', hasStory: true, color: '#E91E63' },
  { id: 'u2', name: 'たけパパ', avatar: '👨', hasStory: true, color: '#2196F3' },
  { id: 'u3', name: 'みき栄養士', avatar: '👩‍⚕️', hasStory: true, color: '#4CAF50' },
  { id: 'u4', name: 'あいばぁば', avatar: '👵', hasStory: true, color: '#9C27B0' },
  { id: 'u5', name: 'りょう', avatar: '👨‍🍳', hasStory: true, color: '#FF9800' },
  { id: 'u6', name: 'さくら', avatar: '👩‍🍳', hasStory: true, color: '#F44336' },
  { id: 'u7', name: 'こうき', avatar: '🧑', hasStory: false, color: '#607D8B' },
];

const SNS_POSTS = [
  {
    id: 'p1', userId: 'u1', userName: 'ゆいママ', avatar: '👩',
    stage: 'ゴックン期', timeAgo: '2時間前',
    photoEmoji: '🥕', photoBg: 'linear-gradient(135deg, #FF6B35, #FDCB6E)',
    photoLabel: 'にんじんペースト',
    caption: '初めてのにんじん、完食しました！🎉\nブレンダーでなめらかにしたら\nパクパク食べてくれた♡',
    hashtags: ['#離乳食デビュー', '#ゴックン期', '#にんじん', '#生後6ヶ月'],
    likes: 128, comments: 23, hasRecipe: true,
    recipe: {
      ingredients: ['にんじん 1/3本', 'だし汁 大さじ2'],
      steps: ['薄くスライスして15分茹でる', 'ブレンダーでペーストに', 'だし汁でのばして完成'],
    },
  },
  {
    id: 'p2', userId: 'u2', userName: 'たけパパ', avatar: '👨',
    stage: 'モグモグ期', timeAgo: '5時間前',
    photoEmoji: '🐟', photoBg: 'linear-gradient(135deg, #0984E3, #74B9FF)',
    photoLabel: 'しらすのおかゆ',
    caption: '今日のパパごはん担当DAY！\nしらすおかゆを作ったよ🍚\n塩抜きもバッチリ👍',
    hashtags: ['#パパごはん', '#しらす', '#モグモグ期', '#離乳食記録'],
    likes: 89, comments: 15, hasRecipe: true,
    recipe: {
      ingredients: ['7倍がゆ 50g', 'しらす 小さじ1', 'だし汁 小さじ1'],
      steps: ['しらすを熱湯で2分塩抜き', '細かく刻む', 'おかゆに混ぜて完成'],
    },
  },
  {
    id: 'p3', userId: 'u3', userName: 'みき栄養士', avatar: '👩‍⚕️',
    stage: 'カミカミ期', timeAgo: '8時間前',
    photoEmoji: '🍌', photoBg: 'linear-gradient(135deg, #A29BFE, #6C5CE7)',
    photoLabel: '米粉パンケーキ',
    caption: '【管理栄養士おすすめ】\n卵・乳なしの米粉パンケーキ🥞\nアレルギーっ子にも安心♪\n手づかみ食べの練習にも◎',
    hashtags: ['#管理栄養士レシピ', '#アレルギー対応', '#米粉パンケーキ', '#手づかみ食べ'],
    likes: 342, comments: 67, hasRecipe: true,
    recipe: {
      ingredients: ['バナナ 1/2本', '米粉 大さじ3', '豆乳 大さじ2'],
      steps: ['バナナを潰す', '米粉と豆乳を混ぜる', '弱火で両面焼く', '小さめサイズで冷ます'],
    },
  },
  {
    id: 'p4', userId: 'u4', userName: 'あいばぁば', avatar: '👵',
    stage: 'パクパク期', timeAgo: '12時間前',
    photoEmoji: '🍅', photoBg: 'linear-gradient(135deg, #D63031, #FF7675)',
    photoLabel: 'トマトリゾット',
    caption: '孫のお昼ごはん🍅\nトマトリゾット大好評でした！\n大人の分から取り分けできるのが楽ちん♪',
    hashtags: ['#ばぁばごはん', '#取り分け離乳食', '#トマトリゾット', '#パクパク期'],
    likes: 201, comments: 34, hasRecipe: false,
  },
  {
    id: 'p5', userId: 'u5', userName: 'りょう', avatar: '👨‍🍳',
    stage: 'カミカミ期', timeAgo: '1日前',
    photoEmoji: '🍔', photoBg: 'linear-gradient(135deg, #E17055, #FAB1A0)',
    photoLabel: '豆腐ハンバーグ',
    caption: '週末まとめて冷凍ストック作り！\n豆腐ハンバーグ×20個完成🎊\nこれで平日楽できる〜',
    hashtags: ['#冷凍ストック', '#作り置き', '#豆腐ハンバーグ', '#カミカミ期'],
    likes: 456, comments: 78, hasRecipe: true,
    recipe: {
      ingredients: ['木綿豆腐 50g', '鶏ひき肉 20g', 'にんじんすりおろし 10g', '片栗粉 小さじ1'],
      steps: ['豆腐を水切り', '全材料を混ぜる', '小判型に成形', '両面こんがり焼く'],
    },
  },
  {
    id: 'p6', userId: 'u6', userName: 'さくら', avatar: '👩‍🍳',
    stage: 'ゴックン期', timeAgo: '1日前',
    photoEmoji: '🎃', photoBg: 'linear-gradient(135deg, #F39C12, #F1C40F)',
    photoLabel: 'かぼちゃマッシュ',
    caption: '離乳食2週目🎃\nかぼちゃの甘さにびっくり！\nすごいお顔して食べてました😂',
    hashtags: ['#離乳食2週目', '#かぼちゃ', '#ゴックン期', '#赤ちゃんの反応'],
    likes: 167, comments: 28, hasRecipe: false,
  },
  {
    id: 'p7', userId: 'u3', userName: 'みき栄養士', avatar: '👩‍⚕️',
    stage: 'モグモグ期', timeAgo: '2日前',
    photoEmoji: '🥦', photoBg: 'linear-gradient(135deg, #00B894, #55EFC4)',
    photoLabel: 'ブロッコリーのおかか和え',
    caption: '【鉄分チャージ】\nブロッコリー＋かつお節の組み合わせ💪\n鉄分もビタミンCもバッチリ！\n貧血予防に取り入れてみてね',
    hashtags: ['#鉄分補給', '#ブロッコリー', '#モグモグ期', '#栄養バランス'],
    likes: 289, comments: 45, hasRecipe: true,
    recipe: {
      ingredients: ['ブロッコリー穂先 2房', 'かつお節 ひとつまみ', 'だし汁 小さじ1'],
      steps: ['穂先をやわらかく茹でる', 'みじん切りにする', 'かつお節とだし汁で和える'],
    },
  },
  {
    id: 'p8', userId: 'u1', userName: 'ゆいママ', avatar: '👩',
    stage: 'ゴックン期', timeAgo: '3日前',
    photoEmoji: '🍚', photoBg: 'linear-gradient(135deg, #DFE6E9, #B2BEC3)',
    photoLabel: '10倍がゆ',
    caption: 'ついに離乳食スタート！🍚✨\n10倍がゆをひとさじから。\nドキドキの初日でした💓',
    hashtags: ['#離乳食スタート', '#10倍がゆ', '#生後5ヶ月', '#はじめての一口'],
    likes: 523, comments: 92, hasRecipe: false,
  },
];

const SNS_FILTERS = [
  { id: 'all', label: 'すべて' },
  { id: 'recipe', label: 'レシピ付き' },
  { id: 'ゴックン期', label: '初期' },
  { id: 'モグモグ期', label: '中期' },
  { id: 'カミカミ期', label: '後期' },
  { id: 'パクパク期', label: '完了期' },
];

// ---------- SNS投稿カード ----------
function SnsPostCard({ post }) {
  const { tryComment } = usePremium();
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const [commentOpen, setCommentOpen] = useState(false);

  const toggleLike = () => {
    setLiked((prev) => !prev);
    setLikeCount((prev) => liked ? prev - 1 : prev + 1);
  };

  return (
    <div style={{
      background: '#fff', marginBottom: 12, borderRadius: 18,
      border: `1px solid ${COLORS.border}`, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      {/* ヘッダー */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: SPACE.sm + 2, padding: `${SPACE.md}px ${SPACE.lg}px`,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 20,
          background: COLORS.tagBg, border: `2px solid ${COLORS.border}`,
        }}>{post.avatar}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: FONT.base, color: COLORS.text }}>{post.userName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
            <span style={{
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
              color: '#fff', padding: '1px 7px', borderRadius: 6, fontSize: FONT.xs, fontWeight: 700,
            }}>{post.stage}</span>
            <span style={{ fontSize: FONT.xs, color: COLORS.textLight }}>{post.timeAgo}</span>
          </div>
        </div>
        <button style={{
          background: 'none', border: 'none', fontSize: 18, cursor: 'pointer',
          color: COLORS.textLight, padding: SPACE.sm, minWidth: 44, minHeight: 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>···</button>
      </div>

      {/* 写真エリア */}
      <div style={{
        background: post.photoBg, height: 280, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <span style={{ fontSize: 90, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.15))' }}>
          {post.photoEmoji}
        </span>
        <div style={{
          position: 'absolute', bottom: SPACE.md, left: SPACE.md,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
          borderRadius: 10, padding: `${SPACE.xs}px ${SPACE.md}px`,
          color: '#fff', fontSize: FONT.sm, fontWeight: 700,
        }}>{post.photoLabel}</div>
        {post.hasRecipe && (
          <div style={{
            position: 'absolute', top: SPACE.md, right: SPACE.md,
            background: 'rgba(255,140,66,0.9)', backdropFilter: 'blur(4px)',
            borderRadius: 10, padding: `${SPACE.xs}px ${SPACE.sm + 2}px`,
            color: '#fff', fontSize: FONT.sm, fontWeight: 700,
          }}>🍳 レシピ付き</div>
        )}
      </div>

      {/* アクションバー */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: `${SPACE.sm + 2}px ${SPACE.lg}px`, gap: SPACE.xs,
      }}>
        <button className="tap-light" onClick={toggleLike} style={{
          background: 'none', border: 'none', fontSize: 24, cursor: 'pointer',
          padding: '6px 8px', minWidth: 44, minHeight: 44,
          transition: 'transform 0.2s',
          transform: liked ? 'scale(1.15)' : 'scale(1)',
        }}>{liked ? '❤️' : '🤍'}</button>
        <button className="tap-light" onClick={() => { if (tryComment()) setCommentOpen(!commentOpen); }} style={{
          background: 'none', border: 'none', fontSize: 22, cursor: 'pointer',
          padding: '6px 8px', minWidth: 44, minHeight: 44,
        }}>💬</button>
        <button className="tap-light" style={{
          background: 'none', border: 'none', fontSize: 22, cursor: 'pointer',
          padding: '6px 8px', minWidth: 44, minHeight: 44,
        }}>↗️</button>
        <div style={{ flex: 1 }} />
        <button className="tap-light" onClick={() => setSaved(!saved)} style={{
          background: 'none', border: 'none', fontSize: 22, cursor: 'pointer',
          padding: '6px 8px', minWidth: 44, minHeight: 44,
          transition: 'transform 0.2s', transform: saved ? 'scale(1.15)' : 'scale(1)',
        }}>{saved ? '🔖' : '🏷️'}</button>
      </div>

      {/* いいね数 */}
      <div style={{ padding: `0 ${SPACE.lg}px ${SPACE.xs}px`, fontSize: FONT.base, fontWeight: 700, color: COLORS.text }}>
        {likeCount.toLocaleString()}件のいいね
      </div>

      {/* キャプション */}
      <div style={{ padding: `${SPACE.xs}px ${SPACE.lg}px 6px` }}>
        <span style={{ fontWeight: 700, fontSize: FONT.base, color: COLORS.text, marginRight: 6 }}>
          {post.userName}
        </span>
        <span style={{ fontSize: FONT.base, color: COLORS.text, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {post.caption}
        </span>
      </div>

      {/* ハッシュタグ */}
      <div style={{ padding: `2px ${SPACE.lg}px ${SPACE.sm}px`, display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>
        {post.hashtags.map((tag) => (
          <span key={tag} style={{ fontSize: FONT.sm, color: '#0984E3', fontWeight: 500 }}>{tag}</span>
        ))}
      </div>

      {/* レシピ展開 */}
      {post.hasRecipe && (
        <div style={{ padding: `0 ${SPACE.lg}px ${SPACE.md}px` }}>
          <button className="tap-scale" onClick={() => setShowRecipe(!showRecipe)} style={{
            width: '100%', background: COLORS.tagBg, border: `1px solid ${COLORS.border}`,
            borderRadius: 12, padding: `${SPACE.sm + 2}px ${SPACE.lg}px`, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: FONT.base, fontWeight: 700, color: COLORS.primaryDark,
            textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>🍳</span>
            {showRecipe ? 'レシピを閉じる' : 'レシピを見る'}
            <span style={{
              marginLeft: 'auto', transition: 'transform 0.2s',
              transform: showRecipe ? 'rotate(90deg)' : 'none',
            }}>›</span>
          </button>
          {showRecipe && (
            <div style={{
              background: COLORS.tagBg, borderRadius: '0 0 12px 12px',
              padding: `${SPACE.md}px ${SPACE.lg}px`, marginTop: -1,
              borderLeft: `1px solid ${COLORS.border}`,
              borderRight: `1px solid ${COLORS.border}`,
              borderBottom: `1px solid ${COLORS.border}`,
              animation: 'fadeInUp 0.25s ease-out',
            }}>
              <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.primaryDark, marginBottom: 6 }}>
                🧾 材料
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs, marginBottom: SPACE.sm + 2 }}>
                {post.recipe.ingredients.map((ing) => (
                  <span key={ing} style={{
                    background: '#fff', borderRadius: 6, padding: `3px ${SPACE.sm}px`,
                    fontSize: FONT.sm, color: COLORS.text, border: `1px solid ${COLORS.border}`,
                  }}>{ing}</span>
                ))}
              </div>
              <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.primaryDark, marginBottom: 6 }}>
                📖 手順
              </div>
              {post.recipe.steps.map((step, i) => (
                <div key={i} style={{
                  display: 'flex', gap: SPACE.sm, alignItems: 'flex-start',
                  marginBottom: i < post.recipe.steps.length - 1 ? 6 : 0,
                }}>
                  <span style={{
                    background: COLORS.primaryDark, color: '#fff', borderRadius: '50%',
                    width: 20, height: 20, fontSize: FONT.xs, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0,
                  }}>{i + 1}</span>
                  <span style={{ fontSize: FONT.sm, lineHeight: 1.5, color: COLORS.text }}>{step}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* コメント数 */}
      <div style={{ padding: `0 ${SPACE.lg}px ${SPACE.md}px` }}>
        <span style={{ fontSize: FONT.sm, color: COLORS.textLight }}>
          コメント{post.comments}件をすべて見る
        </span>
      </div>
    </div>
  );
}

// ---------- 新規投稿フォーム ----------
function NewPostForm({ onClose, onPost }) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const photoOptions = [
    { emoji: '🥕', label: 'にんじん', bg: 'linear-gradient(135deg, #FF6B35, #FDCB6E)' },
    { emoji: '🎃', label: 'かぼちゃ', bg: 'linear-gradient(135deg, #F39C12, #F1C40F)' },
    { emoji: '🍌', label: 'バナナ', bg: 'linear-gradient(135deg, #A29BFE, #6C5CE7)' },
    { emoji: '🍚', label: 'おかゆ', bg: 'linear-gradient(135deg, #DFE6E9, #B2BEC3)' },
    { emoji: '🐟', label: 'しらす', bg: 'linear-gradient(135deg, #0984E3, #74B9FF)' },
    { emoji: '🍔', label: 'ハンバーグ', bg: 'linear-gradient(135deg, #E17055, #FAB1A0)' },
  ];

  const handleSubmit = () => {
    if (!text.trim() || !selectedPhoto) return;
    onPost({
      text,
      tags: tags.split(/[\s,]+/).filter(Boolean).map((t) => t.startsWith('#') ? t : `#${t}`),
      photo: selectedPhoto,
    });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#fff', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480,
        maxHeight: '85vh', overflow: 'auto', padding: '0 0 env(safe-area-inset-bottom, 16px)',
      }}>
        {/* ハンドル */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#DDD' }} />
        </div>

        {/* ヘッダー */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px 12px',
        }}>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 14, color: COLORS.textLight,
            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
          }}>キャンセル</button>
          <span style={{ fontWeight: 900, fontSize: 16, color: COLORS.text }}>新規投稿</span>
          <button onClick={handleSubmit} disabled={!text.trim() || !selectedPhoto} style={{
            background: text.trim() && selectedPhoto
              ? `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`
              : '#DDD',
            border: 'none', borderRadius: 14, padding: '6px 16px',
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>シェア</button>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          {/* 写真選択 */}
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textLight, marginBottom: 8 }}>
            📷 写真を選ぶ（デモ）
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
            {photoOptions.map((p) => (
              <button key={p.emoji} onClick={() => setSelectedPhoto(p)} style={{
                background: p.bg, border: selectedPhoto?.emoji === p.emoji
                  ? '3px solid #fff' : '2px solid transparent',
                borderRadius: 14, padding: '18px 0', cursor: 'pointer',
                textAlign: 'center', outline: selectedPhoto?.emoji === p.emoji
                  ? `3px solid ${COLORS.primaryDark}` : 'none',
                transition: 'transform 0.15s', transform: selectedPhoto?.emoji === p.emoji ? 'scale(0.95)' : 'none',
              }}>
                <div style={{ fontSize: 36 }}>{p.emoji}</div>
                <div style={{ fontSize: 10, color: '#fff', fontWeight: 700, marginTop: 4 }}>{p.label}</div>
              </button>
            ))}
          </div>

          {/* テキスト入力 */}
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textLight, marginBottom: 8 }}>
            ✏️ キャプション
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="今日の離乳食について書いてみよう..."
            rows={4}
            style={{
              width: '100%', borderRadius: 14, border: `2px solid ${COLORS.border}`,
              padding: 14, fontSize: 14, fontFamily: 'inherit', color: COLORS.text,
              resize: 'none', outline: 'none', background: COLORS.bg, boxSizing: 'border-box',
            }}
          />

          {/* ハッシュタグ */}
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textLight, margin: '12px 0 8px' }}>
            🏷️ ハッシュタグ
          </div>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="#離乳食 #ゴックン期 #レシピ"
            style={{
              width: '100%', borderRadius: 14, border: `2px solid ${COLORS.border}`,
              padding: '12px 14px', fontSize: 14, fontFamily: 'inherit', color: COLORS.text,
              outline: 'none', background: COLORS.bg, boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {['#離乳食', '#今日のごはん', '#手作り離乳食', '#もぐもぐ'].map((t) => (
              <button key={t} onClick={() => setTags((prev) => prev ? `${prev} ${t}` : t)} style={{
                background: COLORS.tagBg, border: `1px solid ${COLORS.border}`,
                borderRadius: 12, padding: '4px 10px', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', color: COLORS.primaryDark,
              }}>{t}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- もぐもぐシェアタブ ----------
function ShareTab() {
  const { tryPost } = usePremium();
  const [filter, setFilter] = useState('all');
  const [showNewPost, setShowNewPost] = useState(false);
  const [userPosts, setUserPosts] = useState([]);

  const allPosts = [...userPosts, ...SNS_POSTS];

  const filteredPosts = allPosts.filter((post) => {
    if (filter === 'all') return true;
    if (filter === 'recipe') return post.hasRecipe;
    return post.stage === filter;
  });

  const handleNewPost = (data) => {
    const newPost = {
      id: `user-${Date.now()}`,
      userId: 'me',
      userName: 'あなた',
      avatar: '😊',
      stage: 'ゴックン期',
      timeAgo: 'たった今',
      photoEmoji: data.photo.emoji,
      photoBg: data.photo.bg,
      photoLabel: data.photo.label,
      caption: data.text,
      hashtags: data.tags,
      likes: 0,
      comments: 0,
      hasRecipe: false,
    };
    setUserPosts((prev) => [newPost, ...prev]);
    setShowNewPost(false);
  };

  return (
    <div className="fade-in">
      <Header title="📷 もぐもぐシェア" subtitle="みんなの離乳食をシェアしよう" />

      {/* ストーリーズ */}
      <div style={{
        padding: `${SPACE.lg}px 0 ${SPACE.sm + 2}px`, borderBottom: `1px solid ${COLORS.border}`, background: '#fff',
      }}>
        <div style={{
          display: 'flex', gap: SPACE.lg, overflowX: 'auto', padding: `0 ${SPACE.lg}px`,
          WebkitOverflowScrolling: 'touch',
        }}>
          {STORY_USERS.map((user) => (
            <div key={user.id} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, flexShrink: 0, cursor: 'pointer',
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: user.hasStory
                  ? `linear-gradient(135deg, ${COLORS.primary}, #E91E63, #FDCB6E)`
                  : COLORS.border,
                padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: '100%', height: '100%', borderRadius: '50%', background: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: user.isMe ? 20 : 24, position: 'relative',
                }}>
                  {user.avatar}
                  {user.isMe && (
                    <div style={{
                      position: 'absolute', bottom: -2, right: -2, width: 18, height: 18,
                      borderRadius: '50%', background: COLORS.primaryDark, color: '#fff',
                      fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', border: '2px solid #fff',
                    }}>+</div>
                  )}
                </div>
              </div>
              <span style={{
                fontSize: FONT.xs, color: COLORS.text, fontWeight: 500,
                maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{user.isMe ? 'あなた' : user.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* フィルターバー */}
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', padding: `${SPACE.sm + 2}px ${SPACE.lg}px`,
        background: '#fff', borderBottom: `1px solid ${COLORS.border}`,
        WebkitOverflowScrolling: 'touch',
      }}>
        {SNS_FILTERS.map((f) => (
          <button className="tap-scale" key={f.id} onClick={() => setFilter(f.id)} style={{
            background: filter === f.id
              ? `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`
              : '#fff',
            color: filter === f.id ? '#fff' : COLORS.text,
            border: filter === f.id ? 'none' : `1px solid ${COLORS.border}`,
            borderRadius: 20, padding: `6px ${SPACE.lg}px`, fontSize: FONT.sm, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
          }}>{f.label}</button>
        ))}
      </div>

      {/* フィード */}
      <div style={{ padding: `${SPACE.md}px ${SPACE.lg}px 0` }}>
        {filteredPosts.length > 0 ? (
          filteredPosts.map((post, i) => (
            <React.Fragment key={post.id}>
              <SnsPostCard post={post} />
              {i === 0 && <BannerAd ad={getAd(7)} style={{ marginBottom: SPACE.md }} />}
              {i === 2 && <BannerAdLarge ad={getAd(8)} style={{ marginBottom: SPACE.md }} />}
              {i === 3 && <BannerAd ad={getAd(9)} style={{ marginBottom: SPACE.md }} />}
              {i === 5 && <BannerAdLarge ad={getAd(10)} style={{ marginBottom: SPACE.md }} />}
              {i === 6 && <BannerAd ad={getAd(11)} style={{ marginBottom: SPACE.md }} />}
              {i === 7 && <BannerAd ad={getAd(0)} style={{ marginBottom: SPACE.md }} />}
            </React.Fragment>
          ))
        ) : (
          <div style={{
            textAlign: 'center', padding: `50px ${SPACE.xl}px`,
            background: '#fff', borderRadius: 20, border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ fontSize: 50, marginBottom: SPACE.md }}>📭</div>
            <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>
              投稿がありません
            </div>
            <div style={{ fontSize: FONT.sm, color: COLORS.textLight }}>
              フィルタを変更してみてください
            </div>
          </div>
        )}
      </div>

      {/* 新規投稿FAB */}
      <button className="tap-scale" onClick={() => { if (tryPost()) setShowNewPost(true); }} style={{
        position: 'fixed', bottom: 90, right: 'calc(50% - 220px)',
        width: 54, height: 54, borderRadius: '50%', border: 'none',
        background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
        color: '#fff', fontSize: 26, cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(255,107,53,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 500,
      }}>✏️</button>

      {/* 新規投稿モーダル */}
      {showNewPost && (
        <NewPostForm onClose={() => setShowNewPost(false)} onPost={handleNewPost} />
      )}
    </div>
  );
}

// ---------- レシピタブ ----------
function RecipeTab() {
  const { isPremium, tryRecipeGen, recipeGenCount } = usePremium();
  const [babyMonth] = useState(() => {
    try { return parseInt(localStorage.getItem('mogumogu_month')) || 6; } catch { return 6; }
  });
  const [selectedAllergens] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mogumogu_allergens')) || []; } catch { return []; }
  });
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [recipes, setRecipes] = useState([]);

  const currentStage = MONTH_STAGES.find((s) => s.months.includes(babyMonth)) || MONTH_STAGES[0];

  const allergenNames = selectedAllergens.map(
    (id) => ALLERGENS.find((a) => a.id === id)
  ).filter(Boolean);

  const handleGenerate = () => {
    if (!tryRecipeGen()) return;
    setGenerating(true);
    // AIが生成する風のディレイ
    setTimeout(() => {
      const stageRecipes = FULL_RECIPES.filter((r) => r.stage === currentStage.label);
      const filtered = stageRecipes.filter(
        (r) => !r.allergens.some((a) => selectedAllergens.includes(a))
      );
      setRecipes(filtered);
      setGenerating(false);
      setGenerated(true);
    }, 1500);
  };

  return (
    <div className="fade-in">
      <Header title="🍳 AIレシピ" subtitle="月齢に合わせたレシピを自動生成" />

      <div style={{ padding: SPACE.lg }}>
        {/* 設定サマリー */}
        <div style={{
          background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
          borderRadius: 20, padding: SPACE.xl - 2, color: '#fff', marginBottom: SPACE.lg,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', right: -8, top: -8, fontSize: 70, opacity: 0.12 }}>🤖</div>
          <div style={{ fontSize: FONT.sm, opacity: 0.85, marginBottom: 6 }}>現在の設定</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm + 2, marginBottom: SPACE.sm }}>
            <span style={{ fontSize: 32 }}>{currentStage.emoji}</span>
            <div>
              <div style={{ fontSize: FONT.xl, fontWeight: 900 }}>{currentStage.label}</div>
              <div style={{ fontSize: FONT.sm, opacity: 0.85 }}>{babyMonth}ヶ月 ・ {currentStage.range}</div>
            </div>
          </div>
          {allergenNames.length > 0 && (
            <div style={{
              display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: SPACE.xs,
            }}>
              <span style={{ fontSize: FONT.sm, opacity: 0.8 }}>⚠️ 除外:</span>
              {allergenNames.map((a) => (
                <span key={a.id} style={{
                  background: 'rgba(255,255,255,0.2)', borderRadius: 8,
                  padding: `2px ${SPACE.sm}px`, fontSize: FONT.sm, fontWeight: 600,
                }}>{a.emoji} {a.name}</span>
              ))}
            </div>
          )}
        </div>

        {/* 生成ボタン */}
        {!generated && (
          <>
            <button
              className="tap-scale"
              onClick={handleGenerate}
              disabled={generating}
              style={{
                width: '100%', padding: '18px', borderRadius: 18, border: 'none',
                background: generating
                  ? COLORS.textLight
                  : `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
                color: '#fff', fontSize: FONT.lg, fontWeight: 900, cursor: generating ? 'default' : 'pointer',
                fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(255,107,53,0.3)',
                transition: 'all 0.3s', marginBottom: SPACE.xl,
              }}
            >
              {generating ? (
                <span>🤖 AIがレシピを生成中...</span>
              ) : (
                <span>✨ AIにレシピを提案してもらう</span>
              )}
            </button>
            {!isPremium && (
              <div style={{ textAlign: 'center', fontSize: FONT.sm, color: recipeGenCount >= 1 ? COLORS.danger : COLORS.textLight, fontWeight: 600, marginTop: -12, marginBottom: SPACE.lg }}>
                {recipeGenCount >= 1 ? '🔒 無料枠を使い切りました' : `🤖 残り ${1 - recipeGenCount}/1回（無料）`}
              </div>
            )}
          </>
        )}

        {/* ローディング */}
        {generating && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{
              fontSize: 50, marginBottom: SPACE.md,
              animation: 'loadingPulse 1.5s ease-in-out infinite',
              display: 'inline-block',
            }}>🤖</div>
            <div style={{ display: 'flex', gap: SPACE.md, justifyContent: 'center', marginBottom: SPACE.lg }}>
              {['🥕', '🎃', '🥦'].map((e, i) => (
                <span key={i} style={{
                  fontSize: 28,
                  display: 'inline-block',
                  animation: `loadingBounce 0.8s ease-in-out ${i * 0.15}s infinite`,
                }}>{e}</span>
              ))}
            </div>
            <div style={{ fontSize: FONT.base, color: COLORS.textLight, fontWeight: 600 }}>
              {currentStage.label}に最適なレシピを分析中...
            </div>
            {/* プログレスバー */}
            <div style={{
              margin: `${SPACE.lg}px auto 0`, width: '60%', height: 6,
              background: COLORS.border, borderRadius: 3, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
                animation: 'progressAnim 1.5s ease-in-out',
                width: '100%',
              }} />
            </div>
          </div>
        )}

        {/* 生成結果 */}
        {generated && !generating && (
          <div style={{ animation: 'fadeInUp 0.4s ease-out' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: SPACE.lg,
            }}>
              <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.text }}>
                🤖 AI提案レシピ（{recipes.length}品）
              </div>
              <button className="tap-scale" onClick={() => { setGenerated(false); setRecipes([]); }} style={{
                background: COLORS.tagBg, border: `1px solid ${COLORS.border}`,
                borderRadius: 12, padding: `6px ${SPACE.lg}px`, fontSize: FONT.sm, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', color: COLORS.textLight,
              }}>🔄 再生成</button>
            </div>

            {recipes.length > 0 ? (
              recipes.map((r, i) => (
                <React.Fragment key={r.id}>
                  <RecipeCard recipe={r} />
                  {i === 1 && <BannerAd ad={getAd(3)} style={{ marginBottom: SPACE.lg }} />}
                  {i === 3 && <BannerAdLarge ad={getAd(4)} style={{ marginBottom: SPACE.lg }} />}
                  {i === 5 && <BannerAd ad={getAd(5)} style={{ marginBottom: SPACE.lg }} />}
                  {i === 7 && <BannerAdLarge ad={getAd(6)} style={{ marginBottom: SPACE.lg }} />}
                </React.Fragment>
              ))
            ) : (
              <div>
                <div style={{
                  textAlign: 'center', padding: `40px ${SPACE.xl}px`, marginBottom: SPACE.lg,
                  background: '#fff', borderRadius: 20, border: `1px solid ${COLORS.border}`,
                }}>
                  <div style={{ fontSize: 50, marginBottom: SPACE.md }}>😢</div>
                  <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.sm }}>
                    該当するレシピがありません
                  </div>
                  <div style={{ fontSize: FONT.sm, color: COLORS.textLight, lineHeight: 1.7 }}>
                    アレルゲン設定により全てのレシピが<br />除外されました。設定を見直してみてください。
                  </div>
                </div>
                <BannerAdLarge ad={getAd(7)} style={{ marginBottom: SPACE.lg }} />
                <BannerAd ad={getAd(8)} style={{ marginBottom: SPACE.lg }} />
              </div>
            )}

            {recipes.length > 0 && (
              <div style={{
                background: '#F0F9FF', borderRadius: 16, padding: SPACE.lg, marginTop: SPACE.sm,
                border: '1px solid #BEE3F8', textAlign: 'center',
              }}>
                <div style={{ fontSize: FONT.base, fontWeight: 700, color: '#2B6CB0', marginBottom: SPACE.xs }}>
                  💡 ヒント
                </div>
                <div style={{ fontSize: FONT.sm, color: '#4A90D9', lineHeight: 1.7 }}>
                  設定タブで月齢やアレルゲンを変更すると<br />
                  異なるレシピが提案されます。
                </div>
              </div>
            )}
          </div>
        )}

        {/* 未生成時の説明 */}
        {!generated && !generating && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textLight, marginBottom: 2 }}>
              💡 こんなレシピが提案されます
            </div>
            {MONTH_STAGES.map((s, i) => {
              const count = FULL_RECIPES.filter((r) => r.stage === s.label).length;
              const isCurrent = s.label === currentStage.label;
              return (
                <React.Fragment key={s.label}>
                  <div style={{
                    background: isCurrent ? `linear-gradient(135deg, ${COLORS.tagBg}, #fff)` : '#fff',
                    borderRadius: 16, padding: '14px 16px',
                    border: isCurrent ? `2px solid ${COLORS.primary}` : `1px solid ${COLORS.border}`,
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <span style={{ fontSize: 28 }}>{s.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontWeight: 700, fontSize: 14, color: COLORS.text,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        {s.label}
                        {isCurrent && (
                          <span style={{
                            background: COLORS.primaryDark, color: '#fff', fontSize: 9,
                            padding: '1px 6px', borderRadius: 6, fontWeight: 700,
                          }}>現在</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: COLORS.textLight }}>{s.range} ・ {count}品</div>
                    </div>
                  </div>
                  {i === 1 && <BannerAd ad={getAd(9)} />}
                </React.Fragment>
              );
            })}
            <BannerAdLarge ad={getAd(10)} style={{ marginTop: 4 }} />
            <BannerAd ad={getAd(11)} style={{ marginTop: 12 }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 設定タブ ----------
function SettingsTab() {
  const { isPremium, togglePremium, setShowPaywall, setPaywallReason, searchCount, recipeGenCount, commentCount } = usePremium();
  const [babyMonth, setBabyMonth] = useState(() => {
    try { return parseInt(localStorage.getItem('mogumogu_month')) || 6; }
    catch { return 6; }
  });
  const [selectedAllergens, setSelectedAllergens] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mogumogu_allergens')) || []; }
    catch { return []; }
  });
  const [saved, setSaved] = useState(false);

  const currentStage = MONTH_STAGES.find((s) => s.months.includes(babyMonth)) || MONTH_STAGES[0];

  const toggleAllergen = (id) => {
    setSelectedAllergens((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    localStorage.setItem('mogumogu_month', babyMonth.toString());
    localStorage.setItem('mogumogu_allergens', JSON.stringify(selectedAllergens));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fade-in">
      <Header title="⚙️ 設定" subtitle="お子さまの情報を登録しよう" />

      <div style={{ padding: SPACE.lg }}>
        {/* 赤ちゃん情報カード */}
        <div style={{
          background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
          borderRadius: 20,
          padding: SPACE.xl,
          color: '#fff',
          marginBottom: SPACE.xl,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            right: -10,
            top: -10,
            fontSize: 80,
            opacity: 0.15,
          }}>
            👶
          </div>
          <div style={{ fontSize: FONT.base, fontWeight: 500, opacity: 0.9, marginBottom: SPACE.xs }}>現在のステージ</div>
          <div style={{ fontSize: FONT.xxl, fontWeight: 900, marginBottom: SPACE.xs }}>
            {currentStage.emoji} {currentStage.label}
          </div>
          <div style={{ fontSize: FONT.sm, opacity: 0.85 }}>
            {babyMonth}ヶ月 ・ {currentStage.range}
          </div>
        </div>

        {/* 月齢設定 */}
        <div style={{
          background: '#fff',
          borderRadius: 20,
          padding: SPACE.xl,
          marginBottom: SPACE.lg,
          border: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ fontSize: FONT.base, fontWeight: 700, marginBottom: SPACE.lg, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <span style={{ fontSize: 20 }}>📅</span>
            月齢を設定
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            justifyContent: 'center',
            marginBottom: 12,
          }}>
            <button
              className="tap-scale"
              onClick={() => setBabyMonth(Math.max(5, babyMonth - 1))}
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: `2px solid ${COLORS.border}`,
                background: '#fff',
                fontSize: 20,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'inherit',
                color: COLORS.text,
              }}
            >
              −
            </button>
            <div style={{
              fontSize: 36,
              fontWeight: 900,
              color: COLORS.primaryDark,
              minWidth: 80,
              textAlign: 'center',
            }}>
              {babyMonth}<span style={{ fontSize: 16, fontWeight: 600 }}>ヶ月</span>
            </div>
            <button
              className="tap-scale"
              onClick={() => setBabyMonth(Math.min(18, babyMonth + 1))}
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: `2px solid ${COLORS.border}`,
                background: '#fff',
                fontSize: 20,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'inherit',
                color: COLORS.text,
              }}
            >
            ＋
            </button>
          </div>

          {/* 月齢スライダー */}
          <input
            type="range"
            min={5}
            max={18}
            value={babyMonth}
            onChange={(e) => setBabyMonth(parseInt(e.target.value))}
            style={{
              width: '100%',
              accentColor: COLORS.primary,
              height: 6,
            }}
          />
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: FONT.xs,
            color: COLORS.textLight,
            marginTop: SPACE.xs,
          }}>
            <span>5ヶ月</span>
            <span>18ヶ月</span>
          </div>

          {/* ステージ表示 */}
          <div style={{
            display: 'flex',
            gap: 6,
            marginTop: SPACE.lg,
            flexWrap: 'wrap',
          }}>
            {MONTH_STAGES.map((s) => (
              <div key={s.label} style={{
                padding: `6px ${SPACE.md}px`,
                borderRadius: 10,
                fontSize: FONT.sm,
                fontWeight: 700,
                background: s.label === currentStage.label
                  ? `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`
                  : COLORS.tagBg,
                color: s.label === currentStage.label ? '#fff' : COLORS.textLight,
                transition: 'all 0.3s',
              }}>
                {s.emoji} {s.label}
              </div>
            ))}
          </div>
        </div>

        {/* アレルゲン設定 */}
        <div style={{
          background: '#fff',
          borderRadius: 20,
          padding: SPACE.xl,
          marginBottom: SPACE.lg,
          border: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ fontSize: FONT.base, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            アレルゲン設定
          </div>
          <div style={{ fontSize: FONT.sm, color: COLORS.textLight, marginBottom: SPACE.lg }}>
            注意が必要なアレルゲンを選択してください
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8,
          }}>
            {ALLERGENS.map((a) => {
              const isSelected = selectedAllergens.includes(a.id);
              return (
                <button
                  className="tap-scale"
                  key={a.id}
                  onClick={() => toggleAllergen(a.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: SPACE.sm,
                    padding: `${SPACE.md}px ${SPACE.lg}px`,
                    borderRadius: 14,
                    border: isSelected
                      ? `2px solid ${COLORS.danger}`
                      : `1px solid ${COLORS.border}`,
                    background: isSelected ? '#FFF5F5' : '#fff',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: FONT.sm,
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? COLORS.danger : COLORS.text,
                  }}
                >
                  <span style={{ fontSize: 20 }}>{a.emoji}</span>
                  {a.name}
                  {isSelected && <span style={{ marginLeft: 'auto', fontSize: 14 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* プレミアム管理カード */}
        <div style={{
          background: isPremium
            ? 'linear-gradient(135deg, #FFD700, #FFA500)'
            : 'linear-gradient(135deg, #f8f8f8, #eee)',
          borderRadius: 20, padding: SPACE.xl, marginBottom: SPACE.xl,
          border: isPremium ? '2px solid #FFD700' : `1px solid ${COLORS.border}`,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', right: -10, top: -10, fontSize: 80,
            opacity: isPremium ? 0.2 : 0.08,
          }}>👑</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.lg,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 24,
              background: isPremium ? 'rgba(255,255,255,0.4)' : '#fff',
            }}>👑</div>
            <div>
              <div style={{
                fontWeight: 900, fontSize: FONT.lg,
                color: isPremium ? '#fff' : COLORS.text,
              }}>
                {isPremium ? 'プレミアム会員' : '無料プラン'}
              </div>
              <div style={{
                fontSize: FONT.sm, marginTop: 2,
                color: isPremium ? 'rgba(255,255,255,0.85)' : COLORS.textLight,
              }}>
                {isPremium ? 'すべての機能が無制限で利用可能' : '一部機能に制限があります'}
              </div>
            </div>
          </div>

          {!isPremium && (
            <div style={{
              background: '#fff', borderRadius: 14, padding: 14, marginBottom: 14,
              border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.sm + 2 }}>
                📊 本日の利用状況
              </div>
              {[
                { label: '検索', used: searchCount, max: 3, icon: '🔍' },
                { label: 'AIレシピ', used: recipeGenCount, max: 1, icon: '🍳', daily: false },
                { label: 'コメント', used: commentCount, max: 3, icon: '💬' },
              ].map((item) => (
                <div key={item.label} style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                }}>
                  <span style={{ fontSize: 14 }}>{item.icon}</span>
                  <span style={{ fontSize: 12, color: COLORS.text, width: 70 }}>{item.label}</span>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#f0f0f0', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      width: `${Math.min(100, (item.used / item.max) * 100)}%`,
                      background: item.used >= item.max
                        ? COLORS.danger
                        : `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, minWidth: 36, textAlign: 'right',
                    color: item.used >= item.max ? COLORS.danger : COLORS.textLight,
                  }}>{item.used}/{item.max}</span>
                </div>
              ))}
              <div style={{ fontSize: 10, color: COLORS.textLight, marginTop: 4 }}>
                ※ 検索・コメントは毎日リセット / AIレシピは累計
              </div>
            </div>
          )}

          {!isPremium && (
            <button onClick={() => { setPaywallReason('general'); setShowPaywall(true); }} style={{
              width: '100%', padding: 14, borderRadius: 14, border: 'none',
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
              color: '#fff', fontSize: 15, fontWeight: 900, cursor: 'pointer',
              fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(255,107,53,0.3)',
              marginBottom: 10,
            }}>
              👑 プレミアムにアップグレード
            </button>
          )}

          {/* デモ用トグル */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: isPremium ? 'rgba(255,255,255,0.25)' : '#f8f8f8',
            borderRadius: 12, padding: '10px 14px',
          }}>
            <div>
              <div style={{
                fontSize: FONT.sm, fontWeight: 700,
                color: isPremium ? '#fff' : COLORS.text,
              }}>🧪 デモ: プレミアム切替</div>
              <div style={{
                fontSize: FONT.xs, marginTop: 2,
                color: isPremium ? 'rgba(255,255,255,0.7)' : COLORS.textLight,
              }}>テスト用にON/OFFできます</div>
            </div>
            <button onClick={togglePremium} style={{
              width: 50, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer',
              background: isPremium
                ? `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryDark})`
                : '#ccc',
              position: 'relative', transition: 'background 0.3s',
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 3,
                left: isPremium ? 25 : 3,
                transition: 'left 0.3s',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>
        </div>

        {/* 保存ボタン */}
        <button
          className="tap-scale"
          onClick={handleSave}
          style={{
            width: '100%',
            padding: `${SPACE.lg}px`,
            borderRadius: 16,
            border: 'none',
            background: saved
              ? COLORS.success
              : `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
            color: '#fff',
            fontSize: FONT.lg,
            fontWeight: 900,
            cursor: 'pointer',
            fontFamily: 'inherit',
            boxShadow: '0 4px 16px rgba(255,107,53,0.3)',
            transition: 'all 0.3s',
          }}
        >
          {saved ? '✓ 保存しました！' : '💾 設定を保存する'}
        </button>

        {/* アプリ情報 */}
        <div style={{
          textAlign: 'center',
          padding: `${SPACE.xxl}px 0 ${SPACE.lg}px`,
          color: COLORS.textLight,
          fontSize: FONT.sm,
        }}>
          <div style={{ fontSize: 24, marginBottom: SPACE.xs }}>🍙</div>
          <div style={{ fontWeight: 700 }}>MoguMogu v1.0</div>
          <div style={{ marginTop: SPACE.xs, opacity: 0.7 }}>離乳食サポートアプリ</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// App
// ============================================================
function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayedTab, setDisplayedTab] = useState('home');

  const handleTabChange = useCallback((newTab) => {
    if (newTab === activeTab || isTransitioning) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveTab(newTab);
      setDisplayedTab(newTab);
      window.scrollTo({ top: 0, behavior: 'instant' });
      requestAnimationFrame(() => {
        setIsTransitioning(false);
      });
    }, 150);
  }, [activeTab, isTransitioning]);

  const renderTab = () => {
    const tab = isTransitioning ? displayedTab : activeTab;
    switch (tab) {
      case 'home': return <HomeTab />;
      case 'search': return <SearchTab />;
      case 'share': return <ShareTab />;
      case 'recipe': return <RecipeTab />;
      case 'settings': return <SettingsTab />;
      default: return <HomeTab />;
    }
  };

  return (
    <PremiumProvider>
      <div style={styles.app}>
        {/* メインコンテンツ（ページ遷移アニメーション） */}
        <div style={{
          opacity: isTransitioning ? 0 : 1,
          transform: isTransitioning ? 'translateY(8px)' : 'translateY(0)',
          transition: 'opacity 0.15s ease, transform 0.15s ease',
          willChange: 'opacity, transform',
        }}>
          {renderTab()}
        </div>

        {/* タブバー */}
        <nav style={styles.tabBar}>
          {TABS.map((tab) => (
            <button
              className="tab-btn"
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              style={styles.tabItem(activeTab === tab.id)}
            >
              <span style={styles.tabIcon(activeTab === tab.id)}>{tab.icon}</span>
              <span>{tab.label}</span>
              {activeTab === tab.id && <div style={styles.tabIndicator} />}
            </button>
          ))}
        </nav>

        {/* Paywallモーダル */}
        <PaywallModal />
      </div>
    </PremiumProvider>
  );
}

export default App;
