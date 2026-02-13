import React, { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { supabase } from './lib/supabase';
import Resizer from 'react-image-file-resizer';

// ============================================================
// MoguMogu - 離乳食サポートアプリ
// ============================================================

// ---------- 認証システム ----------
const AuthContext = createContext();

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authScreen, setAuthScreen] = useState(null);

  const fetchUserProfile = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (data) {
      setUserProfile(data);
      localStorage.setItem('mogumogu_month', data.baby_month.toString());
      localStorage.setItem('mogumogu_allergens', JSON.stringify(data.allergens || []));
      if (!data.onboarding_done) {
        setAuthScreen('onboarding');
      }
    } else if (error?.code === 'PGRST116') {
      setAuthScreen('onboarding');
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchUserProfile(session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          await fetchUserProfile(session.user.id);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setUserProfile(null);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, [fetchUserProfile]);

  const signUpWithEmail = async (email, password, nickname, babyMonth) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };
    if (data.user) {
      const { error: insertError } = await supabase.from('users').insert({
        id: data.user.id,
        nickname,
        baby_month: babyMonth,
        allergens: [],
        is_premium: false,
        onboarding_done: false,
      });
      if (insertError) return { error: insertError };
      await fetchUserProfile(data.user.id);
    }
    return { data };
  };

  const signInWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  };

  const signInWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    return { data, error };
  };

  const signInWithLINE = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'line',
      options: { redirectTo: window.location.origin },
    });
    return { data, error };
  };

  const resetPassword = async (email) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return { data, error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setUserProfile(null);
    setAuthScreen(null);
    localStorage.removeItem('mogumogu_premium');
  };

  const updateProfile = async (updates) => {
    if (!user) return { error: { message: 'Not authenticated' } };
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();
    if (data) {
      setUserProfile(data);
      if (updates.baby_month !== undefined) {
        localStorage.setItem('mogumogu_month', updates.baby_month.toString());
      }
      if (updates.allergens !== undefined) {
        localStorage.setItem('mogumogu_allergens', JSON.stringify(updates.allergens));
      }
    }
    return { data, error };
  };

  const completeOnboarding = async (babyMonth, allergens) => {
    if (!user) return { error: { message: 'Not authenticated' } };
    const profileExists = !!userProfile;
    let result;
    if (profileExists) {
      result = await updateProfile({ baby_month: babyMonth, allergens, onboarding_done: true });
    } else {
      const { data, error } = await supabase.from('users').insert({
        id: user.id,
        nickname: user.user_metadata?.full_name || user.email?.split('@')[0] || 'ユーザー',
        baby_month: babyMonth,
        allergens,
        is_premium: false,
        onboarding_done: true,
      }).select().single();
      if (data) setUserProfile(data);
      result = { data, error };
    }
    if (!result.error) {
      setAuthScreen(null);
    }
    return result;
  };

  return (
    <AuthContext.Provider value={{
      user, userProfile, loading,
      authScreen, setAuthScreen,
      signUpWithEmail, signInWithEmail, signInWithGoogle, signInWithLINE,
      resetPassword, signOut,
      updateProfile, completeOnboarding, fetchUserProfile,
      isAuthenticated: !!user,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

// ---------- プレミアム課金システム ----------
const PremiumContext = createContext();

function PremiumProvider({ children }) {
  const { user } = useAuth();
  const [isPremium, setIsPremium] = useState(() => {
    try { return localStorage.getItem('mogumogu_premium') === 'true'; } catch { return false; }
  });
  const [premiumVersion, setPremiumVersion] = useState(0);

  const refreshPremium = useCallback(() => {
    setPremiumVersion((v) => v + 1);
  }, []);

  // 決済確認後に即座にプレミアムを有効化（API・DB 不要で即反映）
  const activatePremium = useCallback(() => {
    setIsPremium(true);
    localStorage.setItem('mogumogu_premium', 'true');
  }, []);

  const isPremiumRef = useRef(isPremium);
  isPremiumRef.current = isPremium;

  const checkPremiumStatus = useCallback(async () => {
    // user 未ロード時はリセットせず現状維持
    if (!user) return isPremiumRef.current;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return isPremiumRef.current;
      const res = await fetch('/api/check-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
      if (!res.ok) return isPremiumRef.current;
      const data = await res.json();
      const active = data.isPremium === true;
      setIsPremium(active);
      localStorage.setItem('mogumogu_premium', active.toString());
      return active;
    } catch (e) {
      console.error('checkPremiumStatus error:', e);
      return isPremiumRef.current;
    }
  }, [user]);

  useEffect(() => {
    checkPremiumStatus();
  }, [checkPremiumStatus, premiumVersion]);
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

  const togglePremium = async () => {
    const next = !isPremium;
    setIsPremium(next);
    localStorage.setItem('mogumogu_premium', next.toString());
    if (user) {
      await supabase.from('users').update({ is_premium: next }).eq('id', user.id);
    }
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
      refreshPremium, checkPremiumStatus, activatePremium,
    }}>
      {children}
    </PremiumContext.Provider>
  );
}

function usePremium() {
  return useContext(PremiumContext);
}

// ---------- useFavorites フック ----------
function useFavorites() {
  const { user, isAuthenticated } = useAuth();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchFavorites = useCallback(async () => {
    if (!isAuthenticated || !user) {
      // 未ログイン: localStorage から読み込み
      try {
        const stored = JSON.parse(localStorage.getItem('mogumogu_favorites') || '[]');
        setFavorites(stored);
      } catch { setFavorites([]); }
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase
        .from('favorites')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setFavorites(data || []);
    } catch (e) {
      console.error('fetchFavorites error:', e);
    }
    setLoading(false);
  }, [user, isAuthenticated]);

  useEffect(() => { fetchFavorites(); }, [fetchFavorites]);

  const isFavorite = useCallback((itemType, itemId) => {
    return favorites.some(f => f.item_type === itemType && f.item_id === itemId);
  }, [favorites]);

  const toggleFavorite = useCallback(async (itemType, itemId, itemData = {}) => {
    const exists = isFavorite(itemType, itemId);

    if (!isAuthenticated || !user) {
      // 未ログイン: localStorage
      setFavorites(prev => {
        let updated;
        if (exists) {
          updated = prev.filter(f => !(f.item_type === itemType && f.item_id === itemId));
        } else {
          updated = [{ item_type: itemType, item_id: itemId, item_data: itemData, created_at: new Date().toISOString() }, ...prev];
        }
        localStorage.setItem('mogumogu_favorites', JSON.stringify(updated));
        return updated;
      });
      return;
    }

    try {
      if (exists) {
        await supabase.from('favorites').delete()
          .eq('user_id', user.id)
          .eq('item_type', itemType)
          .eq('item_id', itemId);
        setFavorites(prev => prev.filter(f => !(f.item_type === itemType && f.item_id === itemId)));
      } else {
        const { data } = await supabase.from('favorites').insert({
          user_id: user.id,
          item_type: itemType,
          item_id: itemId,
          item_data: itemData,
        }).select().single();
        if (data) setFavorites(prev => [data, ...prev]);
      }
    } catch (e) {
      console.error('toggleFavorite error:', e);
    }
  }, [user, isAuthenticated, isFavorite]);

  return { favorites, toggleFavorite, isFavorite, loading, fetchFavorites };
}

// ---------- useSubscription フック ----------
function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user) { setIsLoading(false); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setIsLoading(false); return; }
      const res = await fetch('/api/check-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setSubscription(data.subscription);
        setIsPremium(data.isPremium === true);
      }
    } catch (e) {
      console.error('useSubscription refetch error:', e);
    }
    setIsLoading(false);
  }, [user]);

  useEffect(() => { refetch(); }, [refetch]);

  return { subscription, isPremium, isLoading, refetch };
}

// ---------- Stripe 決済ヘルパー ----------
async function startCheckout(userId, email, plan) {
  const res = await fetch('/api/create-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, email, plan }),
  });
  const data = await res.json();
  if (data.url) {
    window.location.href = data.url;
  } else {
    throw new Error(data.error || 'Checkout session creation failed');
  }
}

async function openCustomerPortal(userToken) {
  const res = await fetch('/api/create-portal-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`,
    },
  });
  const data = await res.json();
  if (data.url) {
    window.location.href = data.url;
  } else {
    throw new Error(data.error || 'Portal session creation failed');
  }
}

// ---------- 認証画面 ----------
function LoginScreen() {
  const { signInWithEmail, signInWithGoogle, signInWithLINE, setAuthScreen } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) { setError('メールアドレスとパスワードを入力してください'); return; }
    setIsLoading(true);
    setError('');
    const { error: err } = await signInWithEmail(email, password);
    if (err) setError(err.message === 'Invalid login credentials' ? 'メールアドレスまたはパスワードが正しくありません' : err.message);
    setIsLoading(false);
  };

  const inputStyle = {
    width: '100%', padding: `${SPACE.md}px ${SPACE.lg}px`, borderRadius: 14,
    border: `2px solid ${COLORS.border}`, fontSize: FONT.base, fontFamily: 'inherit',
    color: COLORS.text, outline: 'none', background: '#fff', boxSizing: 'border-box',
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', background: COLORS.bg, minHeight: '100vh', fontFamily: "'Zen Maru Gothic', sans-serif" }}>
      <div style={{ padding: `60px ${SPACE.xl}px ${SPACE.xl}px` }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 64, marginBottom: SPACE.sm }}>🍙</div>
          <div style={{ fontSize: FONT.xxl, fontWeight: 900, color: COLORS.primaryDark, letterSpacing: 1 }}>MoguMogu</div>
          <div style={{ fontSize: FONT.sm, color: COLORS.textLight, marginTop: SPACE.xs }}>離乳食サポートアプリ</div>
        </div>

        {error && (
          <div style={{ background: '#FFF5F5', border: `1px solid ${COLORS.danger}`, borderRadius: 12, padding: SPACE.md, marginBottom: SPACE.lg, fontSize: FONT.sm, color: COLORS.danger, textAlign: 'center' }}>{error}</div>
        )}

        <div style={{ marginBottom: SPACE.md }}>
          <label style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.xs, display: 'block' }}>メールアドレス</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="example@mail.com" style={inputStyle} />
        </div>

        <div style={{ marginBottom: SPACE.sm }}>
          <label style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.xs, display: 'block' }}>パスワード</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="パスワードを入力" style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }} />
        </div>

        <div style={{ textAlign: 'right', marginBottom: SPACE.xl }}>
          <button onClick={() => setAuthScreen('reset')} style={{ background: 'none', border: 'none', color: COLORS.primary, fontSize: FONT.sm, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            パスワードを忘れた方
          </button>
        </div>

        <button className="tap-scale" onClick={handleLogin} disabled={isLoading} style={{
          width: '100%', padding: SPACE.lg, borderRadius: 16, border: 'none',
          background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
          color: '#fff', fontSize: FONT.lg, fontWeight: 900, cursor: 'pointer',
          fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(255,107,53,0.35)',
          opacity: isLoading ? 0.7 : 1, marginBottom: SPACE.xl,
        }}>
          {isLoading ? 'ログイン中...' : 'ログイン'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.lg }}>
          <div style={{ flex: 1, height: 1, background: COLORS.border }} />
          <span style={{ fontSize: FONT.sm, color: COLORS.textLight }}>または</span>
          <div style={{ flex: 1, height: 1, background: COLORS.border }} />
        </div>

        <button className="tap-scale" onClick={signInWithGoogle} style={{
          width: '100%', padding: SPACE.md, borderRadius: 14, border: `2px solid ${COLORS.border}`,
          background: '#fff', fontSize: FONT.base, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit', color: COLORS.text, display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, marginBottom: SPACE.sm,
        }}>
          <span style={{ fontSize: 20 }}>G</span> Googleでログイン
        </button>

        <button className="tap-scale" onClick={signInWithLINE} style={{
          width: '100%', padding: SPACE.md, borderRadius: 14, border: 'none',
          background: '#06C755', fontSize: FONT.base, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit', color: '#fff', display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, marginBottom: SPACE.xxl,
        }}>
          <span style={{ fontSize: 18 }}>💬</span> LINEでログイン
        </button>

        <div style={{ textAlign: 'center', marginBottom: SPACE.lg }}>
          <span style={{ fontSize: FONT.sm, color: COLORS.textLight }}>アカウントをお持ちでない方 </span>
          <button onClick={() => setAuthScreen('signup')} style={{ background: 'none', border: 'none', color: COLORS.primary, fontSize: FONT.sm, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            新規登録
          </button>
        </div>

        <button onClick={() => setAuthScreen(null)} style={{
          width: '100%', padding: SPACE.md, borderRadius: 14, border: 'none',
          background: 'none', fontSize: FONT.sm, color: COLORS.textLight,
          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          ログインせずに使う →
        </button>
      </div>
    </div>
  );
}

function SignupScreen() {
  const { signUpWithEmail, signInWithGoogle, signInWithLINE, setAuthScreen } = useAuth();
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [babyMonth, setBabyMonth] = useState(6);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const currentStage = MONTH_STAGES.find(s => s.months.includes(babyMonth)) || MONTH_STAGES[0];

  const handleSignup = async () => {
    if (!nickname.trim()) { setError('ニックネームを入力してください'); return; }
    if (!email) { setError('メールアドレスを入力してください'); return; }
    if (password.length < 6) { setError('パスワードは6文字以上で入力してください'); return; }
    setIsLoading(true);
    setError('');
    const { error: err } = await signUpWithEmail(email, password, nickname.trim(), babyMonth);
    if (err) {
      setError(err.message === 'User already registered' ? 'このメールアドレスは既に登録されています' : err.message);
    }
    setIsLoading(false);
  };

  const inputStyle = {
    width: '100%', padding: `${SPACE.md}px ${SPACE.lg}px`, borderRadius: 14,
    border: `2px solid ${COLORS.border}`, fontSize: FONT.base, fontFamily: 'inherit',
    color: COLORS.text, outline: 'none', background: '#fff', boxSizing: 'border-box',
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', background: COLORS.bg, minHeight: '100vh', fontFamily: "'Zen Maru Gothic', sans-serif" }}>
      <div style={{ padding: `${SPACE.xl}px` }}>
        <button onClick={() => setAuthScreen('login')} style={{
          background: 'none', border: 'none', fontSize: FONT.xl, cursor: 'pointer',
          color: COLORS.text, fontFamily: 'inherit', padding: `${SPACE.sm}px 0`, marginBottom: SPACE.md,
        }}>← 戻る</button>

        <div style={{ textAlign: 'center', marginBottom: SPACE.xxl }}>
          <div style={{ fontSize: 48, marginBottom: SPACE.xs }}>👶</div>
          <div style={{ fontSize: FONT.xl, fontWeight: 900, color: COLORS.text }}>新規登録</div>
          <div style={{ fontSize: FONT.sm, color: COLORS.textLight, marginTop: SPACE.xs }}>お子さまの離乳食をサポートします</div>
        </div>

        {error && (
          <div style={{ background: '#FFF5F5', border: `1px solid ${COLORS.danger}`, borderRadius: 12, padding: SPACE.md, marginBottom: SPACE.lg, fontSize: FONT.sm, color: COLORS.danger, textAlign: 'center' }}>{error}</div>
        )}

        <div style={{ marginBottom: SPACE.md }}>
          <label style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.xs, display: 'block' }}>ニックネーム</label>
          <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="例：はるママ" style={inputStyle} />
        </div>

        <div style={{ marginBottom: SPACE.md }}>
          <label style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.xs, display: 'block' }}>メールアドレス</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="example@mail.com" style={inputStyle} />
        </div>

        <div style={{ marginBottom: SPACE.xl }}>
          <label style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.xs, display: 'block' }}>パスワード（6文字以上）</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="パスワードを入力" style={inputStyle} />
        </div>

        <div style={{ background: COLORS.card, borderRadius: 16, padding: SPACE.lg, marginBottom: SPACE.xl, border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.md, textAlign: 'center' }}>赤ちゃんの月齢</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.lg, marginBottom: SPACE.md }}>
            <button className="tap-scale" onClick={() => setBabyMonth(m => Math.max(5, m - 1))} style={{
              width: 44, height: 44, borderRadius: '50%', border: `2px solid ${COLORS.border}`,
              background: '#fff', fontSize: FONT.xl, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.text,
            }}>−</button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: COLORS.primary }}>{babyMonth}</div>
              <div style={{ fontSize: FONT.xs, color: COLORS.textLight }}>ヶ月</div>
            </div>
            <button className="tap-scale" onClick={() => setBabyMonth(m => Math.min(18, m + 1))} style={{
              width: 44, height: 44, borderRadius: '50%', border: `2px solid ${COLORS.border}`,
              background: '#fff', fontSize: FONT.xl, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.text,
            }}>+</button>
          </div>
          <div style={{ textAlign: 'center', fontSize: FONT.sm, color: COLORS.textLight }}>
            {currentStage.emoji} {currentStage.label}（{currentStage.range}）
          </div>
        </div>

        <button className="tap-scale" onClick={handleSignup} disabled={isLoading} style={{
          width: '100%', padding: SPACE.lg, borderRadius: 16, border: 'none',
          background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
          color: '#fff', fontSize: FONT.lg, fontWeight: 900, cursor: 'pointer',
          fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(255,107,53,0.35)',
          opacity: isLoading ? 0.7 : 1, marginBottom: SPACE.xl,
        }}>
          {isLoading ? '登録中...' : 'アカウントを作成'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.lg }}>
          <div style={{ flex: 1, height: 1, background: COLORS.border }} />
          <span style={{ fontSize: FONT.sm, color: COLORS.textLight }}>または</span>
          <div style={{ flex: 1, height: 1, background: COLORS.border }} />
        </div>

        <button className="tap-scale" onClick={signInWithGoogle} style={{
          width: '100%', padding: SPACE.md, borderRadius: 14, border: `2px solid ${COLORS.border}`,
          background: '#fff', fontSize: FONT.base, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit', color: COLORS.text, display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, marginBottom: SPACE.sm,
        }}>
          <span style={{ fontSize: 20 }}>G</span> Googleで登録
        </button>

        <button className="tap-scale" onClick={signInWithLINE} style={{
          width: '100%', padding: SPACE.md, borderRadius: 14, border: 'none',
          background: '#06C755', fontSize: FONT.base, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit', color: '#fff', display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: SPACE.sm,
        }}>
          <span style={{ fontSize: 18 }}>💬</span> LINEで登録
        </button>
      </div>
    </div>
  );
}

function ResetPasswordScreen() {
  const { resetPassword, setAuthScreen } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleReset = async () => {
    if (!email) { setError('メールアドレスを入力してください'); return; }
    setIsLoading(true);
    setError('');
    const { error: err } = await resetPassword(email);
    if (err) { setError(err.message); }
    else { setSent(true); }
    setIsLoading(false);
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', background: COLORS.bg, minHeight: '100vh', fontFamily: "'Zen Maru Gothic', sans-serif" }}>
      <div style={{ padding: `${SPACE.xl}px` }}>
        <button onClick={() => setAuthScreen('login')} style={{
          background: 'none', border: 'none', fontSize: FONT.xl, cursor: 'pointer',
          color: COLORS.text, fontFamily: 'inherit', padding: `${SPACE.sm}px 0`, marginBottom: SPACE.md,
        }}>← 戻る</button>

        <div style={{ textAlign: 'center', marginBottom: SPACE.xxl }}>
          <div style={{ fontSize: 48, marginBottom: SPACE.xs }}>🔑</div>
          <div style={{ fontSize: FONT.xl, fontWeight: 900, color: COLORS.text }}>パスワードリセット</div>
          <div style={{ fontSize: FONT.sm, color: COLORS.textLight, marginTop: SPACE.xs, lineHeight: 1.6 }}>
            登録済みのメールアドレスに<br />リセットリンクを送信します
          </div>
        </div>

        {sent ? (
          <div style={{ background: '#F0FFF4', border: `1px solid ${COLORS.success}`, borderRadius: 16, padding: SPACE.xl, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: SPACE.md }}>✉️</div>
            <div style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.sm }}>メールを送信しました</div>
            <div style={{ fontSize: FONT.sm, color: COLORS.textLight, lineHeight: 1.6, marginBottom: SPACE.xl }}>
              {email} にリセットリンクを送信しました。<br />メールを確認してください。
            </div>
            <button className="tap-scale" onClick={() => setAuthScreen('login')} style={{
              padding: `${SPACE.md}px ${SPACE.xxl}px`, borderRadius: 14, border: 'none',
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
              color: '#fff', fontSize: FONT.base, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>ログイン画面に戻る</button>
          </div>
        ) : (
          <>
            {error && (
              <div style={{ background: '#FFF5F5', border: `1px solid ${COLORS.danger}`, borderRadius: 12, padding: SPACE.md, marginBottom: SPACE.lg, fontSize: FONT.sm, color: COLORS.danger, textAlign: 'center' }}>{error}</div>
            )}
            <div style={{ marginBottom: SPACE.xl }}>
              <label style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.xs, display: 'block' }}>メールアドレス</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="example@mail.com"
                style={{ width: '100%', padding: `${SPACE.md}px ${SPACE.lg}px`, borderRadius: 14, border: `2px solid ${COLORS.border}`, fontSize: FONT.base, fontFamily: 'inherit', color: COLORS.text, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                onKeyDown={e => { if (e.key === 'Enter') handleReset(); }} />
            </div>
            <button className="tap-scale" onClick={handleReset} disabled={isLoading} style={{
              width: '100%', padding: SPACE.lg, borderRadius: 16, border: 'none',
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
              color: '#fff', fontSize: FONT.lg, fontWeight: 900, cursor: 'pointer',
              fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(255,107,53,0.35)',
              opacity: isLoading ? 0.7 : 1,
            }}>
              {isLoading ? '送信中...' : 'リセットリンクを送信'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function OnboardingScreen() {
  const { completeOnboarding, user } = useAuth();
  const [step, setStep] = useState(1);
  const [babyMonth, setBabyMonth] = useState(6);
  const [selectedAllergens, setSelectedAllergens] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const currentStage = MONTH_STAGES.find(s => s.months.includes(babyMonth)) || MONTH_STAGES[0];

  const toggleAllergen = (id) => {
    setSelectedAllergens(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const handleComplete = async () => {
    setIsLoading(true);
    await completeOnboarding(babyMonth, selectedAllergens);
    setIsLoading(false);
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', background: COLORS.bg, minHeight: '100vh', fontFamily: "'Zen Maru Gothic', sans-serif" }}>
      <div style={{ padding: `${SPACE.xl}px` }}>
        {/* プログレスバー */}
        <div style={{ display: 'flex', gap: SPACE.sm, marginBottom: SPACE.xxl, marginTop: SPACE.lg }}>
          {[1, 2].map(n => (
            <div key={n} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: n <= step ? COLORS.primary : COLORS.border,
              transition: 'background 0.3s ease',
            }} />
          ))}
        </div>

        {step === 1 ? (
          <div className="fade-in">
            <div style={{ textAlign: 'center', marginBottom: SPACE.xxl }}>
              <div style={{ fontSize: 64, marginBottom: SPACE.sm }}>👶</div>
              <div style={{ fontSize: FONT.xl, fontWeight: 900, color: COLORS.text }}>
                {user?.user_metadata?.full_name || 'ようこそ'}さん！
              </div>
              <div style={{ fontSize: FONT.sm, color: COLORS.textLight, marginTop: SPACE.sm, lineHeight: 1.6 }}>
                お子さまの月齢を教えてください<br />最適なレシピをご提案します
              </div>
            </div>

            <div style={{ background: COLORS.card, borderRadius: 20, padding: SPACE.xl, marginBottom: SPACE.xl, border: `1px solid ${COLORS.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.xl, marginBottom: SPACE.lg }}>
                <button className="tap-scale" onClick={() => setBabyMonth(m => Math.max(5, m - 1))} style={{
                  width: 52, height: 52, borderRadius: '50%', border: `2px solid ${COLORS.border}`,
                  background: '#fff', fontSize: 24, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.text,
                }}>−</button>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 48, fontWeight: 900, color: COLORS.primary }}>{babyMonth}</div>
                  <div style={{ fontSize: FONT.sm, color: COLORS.textLight }}>ヶ月</div>
                </div>
                <button className="tap-scale" onClick={() => setBabyMonth(m => Math.min(18, m + 1))} style={{
                  width: 52, height: 52, borderRadius: '50%', border: `2px solid ${COLORS.border}`,
                  background: '#fff', fontSize: 24, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.text,
                }}>+</button>
              </div>

              <input type="range" min={5} max={18} value={babyMonth} onChange={e => setBabyMonth(Number(e.target.value))}
                style={{ width: '100%', marginBottom: SPACE.lg }} />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, justifyContent: 'center' }}>
                {MONTH_STAGES.map((s) => (
                  <div key={s.label} style={{
                    padding: `${SPACE.xs}px ${SPACE.md}px`, borderRadius: 20, fontSize: FONT.sm,
                    background: s === currentStage ? `${COLORS.primary}20` : COLORS.tagBg,
                    color: s === currentStage ? COLORS.primaryDark : COLORS.textLight,
                    fontWeight: s === currentStage ? 700 : 400, transition: 'all 0.2s ease',
                  }}>
                    {s.emoji} {s.label}
                  </div>
                ))}
              </div>
            </div>

            <button className="tap-scale" onClick={() => setStep(2)} style={{
              width: '100%', padding: SPACE.lg, borderRadius: 16, border: 'none',
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
              color: '#fff', fontSize: FONT.lg, fontWeight: 900, cursor: 'pointer',
              fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(255,107,53,0.35)',
            }}>
              次へ →
            </button>
          </div>
        ) : (
          <div className="fade-in">
            <div style={{ textAlign: 'center', marginBottom: SPACE.xxl }}>
              <div style={{ fontSize: 64, marginBottom: SPACE.sm }}>⚠️</div>
              <div style={{ fontSize: FONT.xl, fontWeight: 900, color: COLORS.text }}>アレルゲン設定</div>
              <div style={{ fontSize: FONT.sm, color: COLORS.textLight, marginTop: SPACE.sm, lineHeight: 1.6 }}>
                気をつけたいアレルゲンを選択してください<br />（あとから変更できます）
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SPACE.md, marginBottom: SPACE.xxl }}>
              {ALLERGENS.map(a => {
                const selected = selectedAllergens.includes(a.id);
                return (
                  <button className="tap-scale" key={a.id} onClick={() => toggleAllergen(a.id)} style={{
                    padding: SPACE.lg, borderRadius: 16,
                    border: `2px solid ${selected ? COLORS.danger : COLORS.border}`,
                    background: selected ? '#FFF5F5' : '#fff',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
                    transition: 'all 0.2s ease',
                  }}>
                    <div style={{ fontSize: 32, marginBottom: SPACE.xs }}>{a.emoji}</div>
                    <div style={{ fontSize: FONT.base, fontWeight: 700, color: selected ? COLORS.danger : COLORS.text }}>{a.name}</div>
                    {selected && <div style={{ fontSize: FONT.xs, color: COLORS.danger, marginTop: 2 }}>✓ 選択中</div>}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: SPACE.md }}>
              <button className="tap-scale" onClick={() => setStep(1)} style={{
                flex: 1, padding: SPACE.lg, borderRadius: 16,
                border: `2px solid ${COLORS.border}`, background: '#fff',
                fontSize: FONT.base, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'inherit', color: COLORS.text,
              }}>← 戻る</button>
              <button className="tap-scale" onClick={handleComplete} disabled={isLoading} style={{
                flex: 2, padding: SPACE.lg, borderRadius: 16, border: 'none',
                background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
                color: '#fff', fontSize: FONT.lg, fontWeight: 900, cursor: 'pointer',
                fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(255,107,53,0.35)',
                opacity: isLoading ? 0.7 : 1,
              }}>
                {isLoading ? '設定中...' : '始める 🎉'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
  const { showPaywall, setShowPaywall, paywallReason } = usePremium();
  const { isAuthenticated, setAuthScreen } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState('yearly');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  if (!showPaywall) return null;
  const reason = PAYWALL_REASONS[paywallReason] || PAYWALL_REASONS.general;

  const handlePurchase = async () => {
    if (!isAuthenticated) {
      setShowPaywall(false);
      setAuthScreen('login');
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError('');
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      await startCheckout(currentUser.id, currentUser.email, selectedPlan);
    } catch (err) {
      console.error('Checkout error:', err);
      setCheckoutError('決済ページを開けませんでした。もう一度お試しください。');
      setCheckoutLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget && !checkoutLoading) setShowPaywall(false); }}>
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
            background: 'linear-gradient(135deg, #FFF8F0, #FFF0E0)',
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

          {/* エラー表示 */}
          {checkoutError && (
            <div style={{
              background: '#FFF0F0', border: '1px solid #FFD0D0', borderRadius: 10,
              padding: '8px 12px', fontSize: 12, color: '#D63031', marginBottom: 12, textAlign: 'center',
            }}>{checkoutError}</div>
          )}

          {/* 購入ボタン */}
          <button onClick={handlePurchase} disabled={checkoutLoading} style={{
            width: '100%', padding: '16px', borderRadius: 16, border: 'none',
            background: checkoutLoading ? '#ccc' : `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
            color: '#fff', fontSize: FONT.lg, fontWeight: 900, cursor: 'pointer',
            fontFamily: 'inherit', boxShadow: checkoutLoading ? 'none' : '0 4px 16px rgba(255,107,53,0.35)',
            marginBottom: SPACE.sm,
          }}>
            {checkoutLoading ? '決済ページを準備中...' : '7日間無料で始める'}
          </button>
          <div style={{ textAlign: 'center', fontSize: FONT.sm, color: COLORS.textLight, lineHeight: 1.5, marginBottom: SPACE.sm }}>
            トライアル終了後 {selectedPlan === 'yearly' ? '¥3,800/年' : '¥480/月'}
            ・いつでも解約OK
          </div>

          <button onClick={() => { if (!checkoutLoading) setShowPaywall(false); }} style={{
            width: '100%', padding: '12px', borderRadius: 12, border: 'none',
            background: 'none', color: COLORS.textLight, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', opacity: checkoutLoading ? 0.4 : 1,
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

// ---------- フォールバック動画データ ----------
const FALLBACK_VIDEOS = [
  { id: 'demo-1', youtube_id: null, title: '🍚 10倍がゆの作り方', channel_name: '離乳食チャンネル', baby_month_stage: '初期', likes_count: 1200 },
  { id: 'demo-2', youtube_id: null, title: '🥕 にんじんペーストが30秒で完成', channel_name: 'ママの時短キッチン', baby_month_stage: '初期', likes_count: 890 },
  { id: 'demo-3', youtube_id: null, title: '🎃 かぼちゃポタージュ', channel_name: 'ベビーフード研究所', baby_month_stage: '中期', likes_count: 1560 },
  { id: 'demo-4', youtube_id: null, title: '🐟 しらすの塩抜き完全マニュアル', channel_name: 'りにゅう食ラボ', baby_month_stage: '初期', likes_count: 2030 },
  { id: 'demo-5', youtube_id: null, title: '🥦 ブロッコリー×おかゆ 栄養MAX', channel_name: 'ママの時短キッチン', baby_month_stage: '中期', likes_count: 780 },
  { id: 'demo-6', youtube_id: null, title: '✋ 手づかみ食べデビュー3選', channel_name: 'ベビーフード研究所', baby_month_stage: '後期', likes_count: 2450 },
  { id: 'demo-7', youtube_id: null, title: '🧊 1週間分の冷凍ストック術', channel_name: 'ママの時短キッチン', baby_month_stage: '初期', likes_count: 3120 },
  { id: 'demo-8', youtube_id: null, title: '🍳 ふわふわ豆腐ハンバーグ', channel_name: 'りにゅう食ラボ', baby_month_stage: '後期', likes_count: 1890 },
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

// ---------- 広告データ（アフィリエイト） ----------
const BANNER_ADS = [
  { id: 'ad-oisix', title: 'Oisix おためしセット', icon: '🥬', description: '離乳食にも使える有機野菜をお試し', features: ['有機・無添加の安心食材', '離乳食レシピ付き', '全額返金保証'], category: '食材宅配', gradient: 'linear-gradient(135deg, #81C784, #2E7D32)', ctaText: 'おためしセットを見る', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8A+E0A65U+1YGO+6VCBM', impUrl: 'https://www13.a8.net/0.gif?a8mat=4AXA8A+E0A65U+1YGO+6VCBM', imageUrl: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&h=400&fit=crop' },
  { id: 'ad-premium-water', title: 'プレミアムウォーター', icon: '🚰', description: '赤ちゃんのミルク作りに最適なお水', features: ['天然水100%', '赤ちゃんのミルクに安心', 'ボトル配送で買い物いらず'], category: 'ウォーターサーバー', gradient: 'linear-gradient(135deg, #4FC3F7, #0277BD)', ctaText: '無料で資料請求する', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+4784FM+2NB4+5ZEMQ', impUrl: 'https://www12.a8.net/0.gif?a8mat=4AXA8B+4784FM+2NB4+5ZEMQ', imageUrl: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=600&h=400&fit=crop' },
  { id: 'ad-combi', title: 'コンビ公式オンラインショップ', icon: '👶', description: 'ベビーカー・チャイルドシートの定番ブランド', features: ['公式だから安心保証', '限定カラーあり', '送料無料キャンペーン中'], category: 'ベビー用品', gradient: 'linear-gradient(135deg, #F48FB1, #C2185B)', ctaText: '公式ショップを見る', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+5CX82+450Q+669JM', impUrl: 'https://www18.a8.net/0.gif?a8mat=4AXA8B+5CX82+450Q+669JM', imageUrl: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?w=600&h=400&fit=crop' },
  { id: 'ad-belta', title: 'ベルタ葉酸サプリ', icon: '💊', description: '妊娠中・授乳中のママの栄養サポート', features: ['葉酸480μg配合', '無添加・国内製造', '管理栄養士監修'], category: 'ママ向けサプリ', gradient: 'linear-gradient(135deg, #CE93D8, #7B1FA2)', ctaText: '詳細を見る', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+4UG10Y+2M7O+NVWSI', impUrl: 'https://www18.a8.net/0.gif?a8mat=4AXA8B+4UG10Y+2M7O+NVWSI', imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600&h=400&fit=crop' },
  { id: 'ad-famm', title: 'Famm 出張撮影', icon: '📸', description: '家族の思い出をプロのカメラマンが撮影', features: ['全国対応', '75カット以上の写真データ', '平日8,800円〜'], category: '出張撮影', gradient: 'linear-gradient(135deg, #FFAB91, #E64A19)', ctaText: '無料説明会に参加する', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+RZE7M+4DHQ+HZI6Q', impUrl: 'https://www16.a8.net/0.gif?a8mat=4AXA8B+RZE7M+4DHQ+HZI6Q', imageUrl: 'https://images.unsplash.com/photo-1476703993599-0035a21b17a9?w=600&h=400&fit=crop' },
  { id: 'ad-sweet-mommy', title: 'スウィートマミー', icon: '🤱', description: 'おしゃれな授乳服・マタニティウェア専門店', features: ['授乳しやすいデザイン', '産前産後ずっと着られる', 'セール開催中'], category: 'マタニティ', gradient: 'linear-gradient(135deg, #F8BBD0, #D81B60)', ctaText: 'ショップを見る', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+4IJCXE+3FF2+HV7V6', impUrl: 'https://www18.a8.net/0.gif?a8mat=4AXA8B+4IJCXE+3FF2+HV7V6', imageUrl: 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=600&h=400&fit=crop' },
  { id: 'ad-oken-water', title: 'オーケンウォーター', icon: '💧', description: '赤ちゃんにやさしい天然水のウォーターサーバー', features: ['初期費用0円', '天然水を毎月届け', 'チャイルドロック付き'], category: 'ウォーターサーバー', gradient: 'linear-gradient(135deg, #80DEEA, #00838F)', ctaText: '詳しく見る', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+4OHOZ6+1LOO+5YRHE', impUrl: 'https://www12.a8.net/0.gif?a8mat=4AXA8B+4OHOZ6+1LOO+5YRHE', imageUrl: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=600&h=400&fit=crop' },
  { id: 'ad-ed-inter', title: 'エド・インター 知育おもちゃ', icon: '🧩', description: '木のぬくもりを感じる知育おもちゃ', features: ['天然木使用', '安全塗料で安心', '出産祝いにも人気'], category: '知育玩具', gradient: 'linear-gradient(135deg, #A5D6A7, #2E7D32)', ctaText: 'おもちゃを見る', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+36B8XE+4XVW+5YJRM', impUrl: 'https://www13.a8.net/0.gif?a8mat=4AXA8B+36B8XE+4XVW+5YJRM', imageUrl: 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=600&h=400&fit=crop' },
  { id: 'ad-marutomo', title: 'マルトモ だし・食品', icon: '🐟', description: '赤ちゃんの離乳食にも安心のおだし', features: ['国産素材100%', '化学調味料無添加', '離乳食レシピ公開中'], category: '食品', gradient: 'linear-gradient(135deg, #FFB74D, #E65100)', ctaText: '商品を見る', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+11IBW2+5CTE+5YJRM', impUrl: 'https://www13.a8.net/0.gif?a8mat=4AXA8B+11IBW2+5CTE+5YJRM', imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=600&h=400&fit=crop' },
  { id: 'ad-skater', title: 'スケーター ベビー食器', icon: '🍽️', description: 'かわいいベビー食器・お弁当箱', features: ['キャラクターデザイン豊富', '食洗機対応', 'BPAフリーで安心'], category: 'ベビー食器', gradient: 'linear-gradient(135deg, #80CBC4, #00695C)', ctaText: '食器を見る', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+33XIIA+54ME+5YJRM', impUrl: 'https://www14.a8.net/0.gif?a8mat=4AXA8B+33XIIA+54ME+5YJRM', imageUrl: 'https://images.unsplash.com/photo-1590004987778-bece5c9adab6?w=600&h=400&fit=crop' },
  { id: 'ad-theatre', title: 'テアトルアカデミー', icon: '🌟', description: '赤ちゃんモデル・タレントオーディション', features: ['0歳から応募OK', '無料オーディション', 'テレビCM出演実績多数'], category: '赤ちゃんモデル', gradient: 'linear-gradient(135deg, #FFE082, #F57F17)', ctaText: 'オーディションに応募', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+4D6GHE+1E2S+6DC6A', impUrl: 'https://www15.a8.net/0.gif?a8mat=4AXA8B+4D6GHE+1E2S+6DC6A', imageUrl: 'https://images.unsplash.com/photo-1544776193-352d25ca82cd?w=600&h=400&fit=crop' },
  { id: 'ad-drobe', title: 'DROBE パーソナルスタイリング', icon: '👗', description: '忙しいママにプロがコーデ提案', features: ['自宅で試着OK', 'スタイリスト厳選', '気に入らなければ返送無料'], category: 'ファッション', gradient: 'linear-gradient(135deg, #CE93D8, #6A1B9A)', ctaText: '無料で始める', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+1U34XE+4GV4+5YJRM', impUrl: 'https://www16.a8.net/0.gif?a8mat=4AXA8B+1U34XE+4GV4+5YJRM', imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&h=400&fit=crop' },
  { id: 'ad-onigo', title: 'OniGO 即配スーパー', icon: '🛒', description: '離乳食の食材を最短10分でお届け', features: ['最短10分で届く', '生鮮食品も新鮮', 'アプリで簡単注文'], category: '即配スーパー', gradient: 'linear-gradient(135deg, #80CBC4, #00796B)', ctaText: 'アプリをダウンロード', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+3VBGC2+4Z4W+5YJRM', impUrl: 'https://www13.a8.net/0.gif?a8mat=4AXA8B+3VBGC2+4Z4W+5YJRM', imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&h=400&fit=crop' },
  { id: 'ad-bellvie', title: 'ベルビー 出産祝い', icon: '🎁', description: '名入れギフト・出産祝いの専門店', features: ['名入れ無料', 'ラッピング無料', '最短翌日発送'], category: 'ギフト', gradient: 'linear-gradient(135deg, #FFAB91, #BF360C)', ctaText: 'ギフトを探す', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+4NW9DE+3SJA+60OXE', impUrl: 'https://www14.a8.net/0.gif?a8mat=4AXA8B+4NW9DE+3SJA+60OXE', imageUrl: 'https://images.unsplash.com/photo-1513885535751-8b9238bd345a?w=600&h=400&fit=crop' },
  { id: 'ad-kimuratan', title: 'キムラタン ベビー服', icon: '👕', description: 'かわいいベビー服・子供服の通販', features: ['オーガニックコットン', '新生児〜対応', 'セール開催中'], category: 'ベビー服', gradient: 'linear-gradient(135deg, #B39DDB, #4527A0)', ctaText: 'ベビー服を見る', url: 'https://px.a8.net/svt/ejp?a8mat=4AXA8B+448YEQ+1KUO+64C3M', impUrl: 'https://www17.a8.net/0.gif?a8mat=4AXA8B+448YEQ+1KUO+64C3M', imageUrl: 'https://images.unsplash.com/photo-1522771930-78848d9293e8?w=600&h=400&fit=crop' },
];

// ページ読み込み時にシャッフル
const shuffledAds = (() => {
  const ads = [...BANNER_ADS];
  for (let i = ads.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ads[i], ads[j]] = [ads[j], ads[i]];
  }
  return ads;
})();

function getAd(index) {
  return shuffledAds[Math.floor(index) % shuffledAds.length];
}

// 広告インプレッション計測（impUrl ピクセル読み込み）
function trackAdImpression(ad) {
  if (ad.impUrl) {
    const img = new Image();
    img.src = ad.impUrl;
  }
}

// ---------- スタイル ----------
const styles = {
  app: {
    fontFamily: '"Zen Maru Gothic", "Rounded Mplus 1c", sans-serif',
    background: COLORS.bg,
    height: '100%',
    maxWidth: 480,
    margin: '0 auto',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    color: COLORS.text,
  },
  tabBar: {
    flexShrink: 0,
    width: '100%',
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
    padding: '6px 6px',
    minHeight: 44,
    minWidth: 36,
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
    fontSize: 20,
    opacity: active ? 1 : 0.5,
    transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease',
    transform: active ? 'scale(1.15) translateY(-1px)' : 'scale(1)',
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
  { id: 'recipe', label: 'レシピ', icon: '🍳' },
  { id: 'ai', label: 'AI相談', icon: '💬' },
  { id: 'share', label: 'シェア', icon: '📷' },
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
function AdCard({ ad, cardHeight }) {
  const { isPremium } = usePremium();
  const [imageLoaded, setImageLoaded] = useState(false);
  useEffect(() => { if (ad && !isPremium) trackAdImpression(ad); }, [ad, isPremium]);
  if (isPremium || !ad) return null;
  return (
    <a
      href={ad.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'block', width: '100%', height: cardHeight || 'calc(100vh - 60px)',
        scrollSnapAlign: 'start', position: 'relative', textDecoration: 'none',
        color: '#fff', background: ad.gradient, overflow: 'hidden',
        WebkitTapHighlightColor: 'transparent', flexShrink: 0,
      }}
    >
      {/* PRバッジ（左上） */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 2,
        background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 'bold',
        padding: '3px 8px', borderRadius: 4, letterSpacing: 1,
      }}>PR</div>

      {/* カテゴリバッジ（右上） */}
      <div style={{
        position: 'absolute', top: 12, right: 12, zIndex: 2,
        background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 11,
        padding: '4px 10px', borderRadius: 12, backdropFilter: 'blur(4px)',
      }}>{ad.category}</div>

      {/* 商品イメージ写真（上部38%） */}
      <div style={{ width: '100%', height: '38%', overflow: 'hidden', position: 'relative' }}>
        <img
          src={ad.imageUrl}
          alt={ad.title}
          onLoad={() => setImageLoaded(true)}
          onError={(e) => { e.target.style.display = 'none'; }}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            opacity: imageLoaded ? 1 : 0, transition: 'opacity 0.3s ease',
          }}
        />
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
          background: `linear-gradient(transparent, ${ad.gradient.match(/#[A-Fa-f0-9]{6}/g)?.[1] || '#000'})`,
        }} />
      </div>

      {/* 広告コンテンツ（下部） */}
      <div style={{
        padding: '16px 24px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', textAlign: 'center',
        textShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 36, marginBottom: 4 }}>{ad.icon}</div>
        <div style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 8, lineHeight: 1.3 }}>{ad.title}</div>
        <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 16, lineHeight: 1.5 }}>{ad.description}</div>

        {/* 特徴リスト */}
        {ad.features && (
          <div style={{
            marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 6,
            alignItems: 'flex-start', background: 'rgba(255,255,255,0.15)',
            borderRadius: 12, padding: '12px 20px', backdropFilter: 'blur(4px)',
            width: '100%', maxWidth: 300,
          }}>
            {ad.features.map((feature, i) => (
              <div key={i} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, background: 'rgba(255,255,255,0.3)',
                  borderRadius: '50%', fontSize: 10,
                }}>✓</span>
                {feature}
              </div>
            ))}
          </div>
        )}

        {/* CTAボタン */}
        <div style={{
          background: '#fff', color: '#333', borderRadius: 30, padding: '14px 40px',
          fontSize: 16, fontWeight: 'bold', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          {ad.ctaText || '詳しく見る'} <span style={{ fontSize: 18 }}>→</span>
        </div>
      </div>

      {/* 下部ヒント */}
      <div style={{
        position: 'absolute', bottom: 8, left: 0, right: 0,
        textAlign: 'center', fontSize: 11, opacity: 0.5,
      }}>
        ↑ スワイプして次の動画へ
      </div>
    </a>
  );
}

// ---------- コンパクト広告カード（ページ内挿入用） ----------
function CompactAdCard({ ad, style: extraStyle }) {
  const { isPremium } = usePremium();
  const [imageLoaded, setImageLoaded] = useState(false);
  useEffect(() => { if (ad && !isPremium) trackAdImpression(ad); }, [ad, isPremium]);
  if (isPremium || !ad) return null;
  return (
    <a href={ad.url} target="_blank" rel="noopener noreferrer" style={{
      display: 'flex', background: '#fff', borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)', textDecoration: 'none', color: '#333',
      margin: '16px 0', border: '1px solid #f0f0f0', position: 'relative', ...extraStyle,
    }}>
      <div style={{
        position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.5)', color: '#fff',
        fontSize: 9, fontWeight: 'bold', padding: '2px 6px', borderRadius: 3, letterSpacing: 1, zIndex: 1,
      }}>PR</div>
      <div style={{
        width: 120, minHeight: 120, background: ad.gradient, flexShrink: 0,
        position: 'relative', overflow: 'hidden',
      }}>
        <img src={ad.imageUrl} alt={ad.title} onLoad={() => setImageLoaded(true)}
          onError={(e) => { e.target.style.display = 'none'; }}
          style={{ width: '100%', height: '100%', objectFit: 'cover',
            opacity: imageLoaded ? 1 : 0, transition: 'opacity 0.3s' }} />
        {!imageLoaded && (
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>
            {ad.icon}
          </div>
        )}
      </div>
      <div style={{ flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: 4 }}>
        <div style={{ fontSize: 10, color: '#999', fontWeight: 'bold', letterSpacing: 0.5 }}>
          {ad.category}
        </div>
        <div style={{ fontSize: 15, fontWeight: 'bold', lineHeight: 1.3, color: '#222' }}>
          {ad.icon} {ad.title}
        </div>
        <div style={{ fontSize: 12, color: '#666', lineHeight: 1.4 }}>
          {ad.description}
        </div>
        <div style={{ fontSize: 11, color: '#FF6B35', fontWeight: 'bold', marginTop: 2 }}>
          ✓ {ad.features[0]}
        </div>
        <div style={{ marginTop: 6, background: ad.gradient, color: '#fff', borderRadius: 20,
          padding: '6px 16px', fontSize: 12, fontWeight: 'bold', textAlign: 'center',
          display: 'inline-block', alignSelf: 'flex-start' }}>
          {ad.ctaText} →
        </div>
      </div>
    </a>
  );
}

// ---------- 大きめ広告カード（ページ間挿入用） ----------
function LargeAdCard({ ad, style: extraStyle }) {
  const { isPremium } = usePremium();
  const [imageLoaded, setImageLoaded] = useState(false);
  useEffect(() => { if (ad && !isPremium) trackAdImpression(ad); }, [ad, isPremium]);
  if (isPremium || !ad) return null;
  return (
    <a href={ad.url} target="_blank" rel="noopener noreferrer" style={{
      display: 'block', background: '#fff', borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 2px 16px rgba(0,0,0,0.1)', textDecoration: 'none', color: '#333',
      margin: '20px 0', position: 'relative', ...extraStyle,
    }}>
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 2, background: 'rgba(0,0,0,0.6)',
        color: '#fff', fontSize: 10, fontWeight: 'bold', padding: '3px 8px', borderRadius: 4,
      }}>PR</div>
      <div style={{ width: '100%', height: 180, background: ad.gradient,
        position: 'relative', overflow: 'hidden' }}>
        <img src={ad.imageUrl} alt={ad.title} onLoad={() => setImageLoaded(true)}
          onError={(e) => { e.target.style.display = 'none'; }}
          style={{ width: '100%', height: '100%', objectFit: 'cover',
            opacity: imageLoaded ? 1 : 0, transition: 'opacity 0.3s' }} />
        {!imageLoaded && (
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, color: '#fff' }}>
            {ad.icon}
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.4))' }} />
        <div style={{ position: 'absolute', bottom: 10, right: 12, background: 'rgba(255,255,255,0.9)',
          color: '#333', fontSize: 11, fontWeight: 'bold', padding: '3px 10px', borderRadius: 10 }}>
          {ad.category}
        </div>
      </div>
      <div style={{ padding: '16px 16px 14px' }}>
        <div style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 6, lineHeight: 1.3 }}>
          {ad.icon} {ad.title}
        </div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 1.5 }}>
          {ad.description}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {ad.features.map((f, i) => (
            <span key={i} style={{ fontSize: 11, color: '#FF6B35', background: '#FFF3E0',
              padding: '4px 10px', borderRadius: 12, fontWeight: 'bold' }}>
              ✓ {f}
            </span>
          ))}
        </div>
        <div style={{ background: ad.gradient, color: '#fff', borderRadius: 24,
          padding: '12px 0', fontSize: 15, fontWeight: 'bold', textAlign: 'center' }}>
          {ad.ctaText} →
        </div>
      </div>
    </a>
  );
}

// ---------- サーバーサイド動画取得（RLS バイパス） ----------
const SHORTS_PAGE_SIZE = 20;

async function fetchFreshVideos(stage) {
  try {
    const res = await fetch(`/api/videos?action=fresh&stage=${encodeURIComponent(stage || '')}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.videos || [];
  } catch (e) {
    console.error('fetchFreshVideos error:', e);
    return [];
  }
}

async function reportBrokenVideo(youtubeId) {
  if (!youtubeId) return;
  try {
    await supabase.from('videos').delete().eq('youtube_id', youtubeId);
  } catch (e) {
    console.error('reportBrokenVideo error:', e);
  }
}

function getUserStage() {
  try {
    const month = parseInt(localStorage.getItem('mogumogu_month'));
    if (!month) return '';
    if (month <= 6) return '初期';
    if (month <= 8) return '中期';
    if (month <= 11) return '後期';
    return '完了期';
  } catch { return ''; }
}

async function fetchRandomVideos(excludeIds = []) {
  try {
    const params = new URLSearchParams({ limit: SHORTS_PAGE_SIZE.toString() });
    if (excludeIds.length > 0) {
      params.set('exclude', JSON.stringify(excludeIds));
    }

    const res = await fetch(`/api/videos?action=random&${params}`);
    if (!res.ok) {
      console.error('random-videos API error:', res.status);
      return [];
    }

    const json = await res.json();
    return json.videos || [];
  } catch (e) {
    console.error('fetchRandomVideos exception:', e);
    return [];
  }
}

const STAGE_DISPLAY = {
  '初期': '初期 5-6ヶ月', 'ゴックン期': '初期 5-6ヶ月',
  '中期': '中期 7-8ヶ月', 'モグモグ期': '中期 7-8ヶ月',
  '後期': '後期 9-11ヶ月', 'カミカミ期': '後期 9-11ヶ月',
  '完了期': '完了期 12-18ヶ月', 'パクパク期': '完了期 12-18ヶ月',
};

function VideoCard({ item, cardHeight, isVisible, isActive, onSkip }) {
  // 3 states: 'thumbnail' | 'playing' | 'error'
  const [playState, setPlayState] = useState('thumbnail');
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();
  const saved = isFavorite('video', item.id);
  const [descExpanded, setDescExpanded] = useState(false);
  const [likeAnim, setLikeAnim] = useState(false);
  const playTimerRef = useRef(null);
  const iframeRef = useRef(null);

  const videoId = item.youtube_id;
  const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;

  // Shorts 用 embed URL（常に mute=1 で開始、切替は postMessage で行う）
  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&controls=1&loop=1&playlist=${videoId}&rel=0&modestbranding=1&enablejsapi=1&origin=${window.location.origin}`
    : null;

  // ミュート切替を postMessage で行う（iframe を再生成しない）
  useEffect(() => {
    if (playState !== 'playing' || !iframeRef.current) return;
    try {
      iframeRef.current.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: muted ? 'mute' : 'unMute',
        args: [],
      }), '*');
    } catch { /* cross-origin */ }
  }, [muted, playState]);

  // YouTube IFrame API エラー検知（iframe 内部のエラーを捕捉）
  useEffect(() => {
    if (playState !== 'playing' || !videoId) return;

    const handleMessage = (event) => {
      if (!event.origin || !event.origin.includes('youtube.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        // YouTube error codes: 100=動画なし, 101/150=埋め込み不可, 2=不正パラメータ, 5=HTML5エラー
        if (data.event === 'onError') {
          console.warn('YouTube error for', videoId, ':', data.info);
          setPlayState('error');
        }
      } catch {
        // YouTube 以外のメッセージは無視
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [playState, videoId]);

  // エラー時に自動で次の動画にスキップ（2秒後）
  useEffect(() => {
    if (playState !== 'error' || !onSkip) return;
    const timer = setTimeout(() => onSkip(), 2000);
    return () => clearTimeout(timer);
  }, [playState, onSkip]);

  const formatCount = (n) => {
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  };

  // isActive になったら 0.5s 後に再生開始
  useEffect(() => {
    if (isActive && videoId) {
      playTimerRef.current = setTimeout(() => setPlayState('playing'), 500);
    } else {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      setPlayState('thumbnail');
    }
    return () => { if (playTimerRef.current) clearTimeout(playTimerRef.current); };
  }, [isActive, videoId]);

  // ダブルタップでいいね
  const lastTapRef = useRef(0);
  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!liked) {
        setLiked(true);
        setLikeAnim(true);
        setTimeout(() => setLikeAnim(false), 600);
      }
    }
    lastTapRef.current = now;
  };

  // シェア
  const handleShare = async (e) => {
    e.stopPropagation();
    const url = videoId
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(item.title)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, text: item.description || item.title, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch { /* cancelled */ }
  };

  // コメント → YouTube
  const handleComment = (e) => {
    e.stopPropagation();
    if (videoId) window.open(`https://www.youtube.com/shorts/${videoId}`, '_blank');
  };

  // YouTube で開く
  const handleOpenYT = (e) => {
    e.stopPropagation();
    if (videoId) window.open(`https://www.youtube.com/shorts/${videoId}`, '_blank');
  };

  // 画面外のカードは空 div
  if (!isVisible) {
    return <div style={{ height: cardHeight, scrollSnapAlign: 'start', flexShrink: 0, background: '#000' }} />;
  }

  const channelName = item.channel_name || item.channel || '';
  const stageLabel = item.baby_month_stage || item.stage;
  const displayStage = STAGE_DISPLAY[stageLabel] || stageLabel;
  const likesNum = item.likes_count || item.likes || 0;

  // アクションボタン共通
  const ActionBtn = ({ icon, label, onClick, active }) => (
    <button
      className="tap-light"
      onClick={onClick}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        padding: 0,
      }}
    >
      <span style={{
        fontSize: 28, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
        transform: active ? 'scale(1.15)' : 'scale(1)',
        transition: 'transform 0.2s ease-out',
      }}>{icon}</span>
      <span style={{
        color: '#fff', fontSize: 11, fontWeight: 700,
        textShadow: '0 1px 4px rgba(0,0,0,0.6)',
      }}>{label}</span>
    </button>
  );

  return (
    <div
      onClick={handleDoubleTap}
      style={{
        height: cardHeight, minHeight: 500,
        background: '#000', position: 'relative',
        overflow: 'hidden', scrollSnapAlign: 'start', flexShrink: 0,
      }}
    >
      {/* === サムネイル背景（常に表示） === */}
      {thumbnailUrl && (
        <img
          src={thumbnailUrl} alt=""
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%', objectFit: 'cover',
            filter: playState === 'playing' ? 'none' : 'brightness(0.7)',
            transition: 'filter 0.3s',
          }}
        />
      )}

      {/* youtube_id が null の場合のグラデーション背景 */}
      {!videoId && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, #FF6B35 0%, #FF8C42 50%, #FFB347 100%)',
          opacity: 0.85,
        }} />
      )}

      {/* ダブルタップいいねアニメーション */}
      {likeAnim && (
        <div style={{
          position: 'absolute', top: '40%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 50,
          fontSize: 80, animation: 'heartPop 0.6s ease-out forwards',
          pointerEvents: 'none', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.3))',
        }}>❤️</div>
      )}

      {/* === 再生ボタン（サムネイル状態） === */}
      {playState === 'thumbnail' && videoId && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 10,
          width: 60, height: 60, borderRadius: '50%',
          background: 'rgba(255,255,255,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            width: 0, height: 0,
            borderTop: '12px solid transparent',
            borderBottom: '12px solid transparent',
            borderLeft: '20px solid #FF6B35',
            marginLeft: 4,
          }} />
        </div>
      )}

      {/* === YouTube iframe（playing 状態のみ） === */}
      {playState === 'playing' && embedUrl && (
        <iframe
          ref={iframeRef}
          key={videoId}
          src={embedUrl}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onError={() => setPlayState('error')}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            border: 'none', zIndex: 5,
          }}
        />
      )}

      {/* === エラー状態 === */}
      {playState === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 6,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)',
        }}>
          <div style={{ fontSize: 14, color: '#fff', marginBottom: 12 }}>
            この動画は再生できません
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              reportBrokenVideo(videoId);
              if (onSkip) onSkip();
            }}
            style={{
              background: '#FF6B35', color: '#fff', border: 'none',
              borderRadius: 20, padding: '8px 20px', fontSize: 13,
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            スキップ
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setPlayState('thumbnail'); }}
            style={{
              marginTop: 8, background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.3)', borderRadius: 20,
              padding: '6px 20px', color: '#fff', fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            リトライ
          </button>
        </div>
      )}

      {/* === youtube_id null の場合の中央タイトル表示 === */}
      {!videoId && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 6,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 32px',
        }}>
          <span style={{ fontSize: 56, marginBottom: 16 }}>
            {item.title.match(/^(.)/) ? item.title.match(/[\p{Emoji_Presentation}]/u)?.[0] || '🍴' : '🍴'}
          </span>
          <span style={{
            color: '#fff', fontSize: 22, fontWeight: 900,
            textAlign: 'center', textShadow: '0 2px 12px rgba(0,0,0,0.4)',
            lineHeight: 1.5,
          }}>{item.title}</span>
        </div>
      )}

      {/* === ミュートトグル === */}
      {playState === 'playing' && videoId && (
        <button
          onClick={(e) => { e.stopPropagation(); setMuted(!muted); }}
          style={{
            position: 'absolute', top: 56, right: 16, zIndex: 30,
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
            border: 'none', borderRadius: '50%',
            width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 18,
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      )}

      {/* === ステージバッジ === */}
      {displayStage && (
        <div style={{
          position: 'absolute', top: 56, left: 16, zIndex: 30,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(10px)',
          borderRadius: 20, padding: '5px 14px',
          border: '1px solid rgba(255,255,255,0.15)',
          fontSize: FONT.sm, color: '#fff', fontWeight: 700,
        }}>
          {displayStage}
        </div>
      )}

      {/* === 右サイド アクションバー === */}
      <div style={{
        position: 'absolute', right: 10, bottom: '18%',
        display: 'flex', flexDirection: 'column', gap: 16,
        alignItems: 'center', zIndex: 20,
      }}>
        <ActionBtn
          icon={liked ? '❤️' : '🤍'}
          label={formatCount(liked ? likesNum + 1 : likesNum)}
          onClick={(e) => { e.stopPropagation(); setLiked(!liked); }}
          active={liked}
        />
        <ActionBtn icon="💬" label="コメント" onClick={handleComment} />
        <ActionBtn icon="↗️" label="シェア" onClick={handleShare} />
        <ActionBtn
          icon={saved ? '🔖' : '📑'}
          label={saved ? '保存済' : '保存'}
          onClick={(e) => { e.stopPropagation(); toggleFavorite('video', item.id, { title: item.title, youtube_id: videoId, channel_name: item.channel_name || item.channel, thumbnail_url: thumbnailUrl }); }}
          active={saved}
        />
        {videoId && (
          <ActionBtn icon="▶️" label="YouTube" onClick={handleOpenYT} />
        )}
      </div>

      {/* === 下部情報オーバーレイ === */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 60, zIndex: 15,
        background: 'linear-gradient(transparent, rgba(0,0,0,0.5) 30%, rgba(0,0,0,0.75))',
        padding: `60px ${SPACE.lg}px ${SPACE.xl}px`,
      }}>
        {/* チャンネル名 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{
            color: '#fff', fontWeight: 800, fontSize: FONT.base,
            textShadow: '0 1px 6px rgba(0,0,0,0.4)',
          }}>
            @{channelName.replace(/\s/g, '')}
          </span>
        </div>

        {/* タイトル */}
        <div style={{
          color: '#fff', fontWeight: 900, fontSize: FONT.lg, lineHeight: 1.4,
          marginBottom: 6,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          textShadow: '0 1px 6px rgba(0,0,0,0.4)',
        }}>
          {item.title}
        </div>

        {/* 説明文 */}
        {item.description && (
          <div
            onClick={(e) => { e.stopPropagation(); setDescExpanded(!descExpanded); }}
            style={{
              color: 'rgba(255,255,255,0.8)', fontSize: FONT.sm, lineHeight: 1.5,
              marginBottom: 8, cursor: 'pointer',
              overflow: descExpanded ? 'visible' : 'hidden',
              display: descExpanded ? 'block' : '-webkit-box',
              WebkitLineClamp: descExpanded ? undefined : 1,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {item.description}
            {!descExpanded && <span style={{ color: 'rgba(255,255,255,0.45)', marginLeft: 4, fontSize: FONT.xs }}>もっと見る</span>}
          </div>
        )}

        {/* タグ */}
        {(item.tags || []).length > 0 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {item.tags.map((tag) => (
              <span key={tag} style={{
                color: 'rgba(255,255,255,0.85)',
                fontSize: FONT.sm, fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- ホームタブ 動画キャッシュ（タブ切替時の再読み込み防止） ----------
const videosCache = { data: null, page: 0, hasMore: true };

// ---------- ホームタブ ----------
function HomeTab() {
  const containerRef = useRef(null);
  const [videos, setVideos] = useState(videosCache.data || []);
  const [hasMore, setHasMore] = useState(videosCache.hasMore);
  const [loading, setLoading] = useState(!videosCache.data);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cardHeight, setCardHeight] = useState(window.innerHeight - 70);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef(null);
  const loadingRef = useRef(false);
  const observerRef = useRef(null);

  // iOS Safari 対応: window.innerHeight でカード高さ計算
  useEffect(() => {
    const updateHeight = () => setCardHeight(window.innerHeight - 70);
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // 初回ロード: キャッシュがあればスキップ
  useEffect(() => {
    if (videosCache.data) return; // キャッシュあり → フェッチ不要
    let cancelled = false;
    async function loadInitial() {
      setLoading(true);
      const userStage = getUserStage();

      // DB動画 + 新着動画を並行取得
      const [dbData, freshData] = await Promise.all([
        fetchRandomVideos(),
        fetchFreshVideos(userStage),
      ]);
      if (cancelled) return;

      // 結合して重複排除
      const seen = new Set();
      let allVideos = [...freshData, ...dbData].filter(v => {
        const vid = v.youtube_id;
        if (!vid || seen.has(vid)) return false;
        seen.add(vid);
        return true;
      });

      // ステージ優先ソート
      if (userStage) {
        const matching = allVideos.filter(v => (v.baby_stage || v.baby_month_stage || v.stage) === userStage);
        const others = allVideos.filter(v => (v.baby_stage || v.baby_month_stage || v.stage) !== userStage);
        allVideos = [...matching, ...others];
      }

      if (allVideos.length > 0) {
        setVideos(allVideos);
        setHasMore(allVideos.length >= SHORTS_PAGE_SIZE);
        videosCache.data = allVideos;
        videosCache.hasMore = allVideos.length >= SHORTS_PAGE_SIZE;
      } else {
        setVideos(FALLBACK_VIDEOS);
        setHasMore(false);
        videosCache.data = FALLBACK_VIDEOS;
        videosCache.hasMore = false;
      }
      setLoading(false);
    }
    loadInitial();
    return () => { cancelled = true; };
  }, []);

  // 追加読み込み（既に表示済みの動画を除外してランダム取得）
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    const existingIds = videos.map(v => v.id);
    const data = await fetchRandomVideos(existingIds);
    if (data.length > 0) {
      setVideos(prev => {
        const updated = [...prev, ...data];
        videosCache.data = updated;
        return updated;
      });
      if (data.length < SHORTS_PAGE_SIZE) {
        setHasMore(false);
        videosCache.hasMore = false;
      }
    } else {
      setHasMore(false);
      videosCache.hasMore = false;
    }
    loadingRef.current = false;
  }, [videos, hasMore]);

  // IntersectionObserver でアクティブカード検出
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = parseInt(entry.target.dataset.index, 10);
            if (!isNaN(idx)) setCurrentIndex(idx);
          }
        }
      },
      { root: container, threshold: 0.7 }
    );

    const cards = container.querySelectorAll('[data-index]');
    cards.forEach(card => observerRef.current.observe(card));

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [videos, loading]);

  // スクロール監視 + 末端で追加読み込み
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    setIsScrolling(true);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => setIsScrolling(false), 200);

    // 末端近くで追加読み込み
    const el = containerRef.current;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - cardHeight * 2) {
      loadMore();
    }
  }, [cardHeight, loadMore]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.addEventListener('scroll', handleScroll, { passive: true });
      return () => el.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // 広告挿入した表示リスト構築（プレミアム会員は広告なし）
  const { isPremium } = usePremium();
  const displayItems = useMemo(() => {
    if (isPremium) return videos.map(v => ({ type: 'video', data: v }));
    const items = [];
    let adIndex = 0;
    videos.forEach((item, i) => {
      items.push({ type: 'video', data: item });
      if ((i + 1) % 4 === 0) {
        items.push({ type: 'ad', data: getAd(adIndex) });
        adIndex++;
      }
    });
    return items;
  }, [videos, isPremium]);

  // ローディング画面
  if (loading) {
    return (
      <div style={{
        height: cardHeight, background: '#000',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          fontSize: 48, animation: 'loadingPulse 1.2s ease-in-out infinite',
        }}>🍼</div>
        <div style={{
          color: 'rgba(255,255,255,0.6)', fontSize: FONT.sm,
          fontWeight: 600, marginTop: 16,
        }}>動画を読み込み中...</div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: cardHeight, background: '#000' }}>
      {/* トップバーオーバーレイ */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
        padding: '10px 16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        opacity: isScrolling ? 0.4 : 1,
        transition: 'opacity 0.3s ease-out',
        pointerEvents: 'none',
      }}>
        {/* 左: ロゴ */}
        <div style={{ pointerEvents: 'auto' }}>
          <span style={{
            color: '#fff', fontWeight: 900, fontSize: 18,
            textShadow: '0 2px 12px rgba(0,0,0,0.4)',
            letterSpacing: -0.5,
          }}>
            🍼 MoguMogu
          </span>
        </div>

        <div />
      </div>

      {/* メインスクロールコンテナ */}
      <div
        ref={containerRef}
        style={{
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        {displayItems.map((entry, i) => (
          <div key={`${entry.type}-${entry.data?.id || entry.data?.youtube_id || i}`} data-index={i}>
            {entry.type === 'video' ? (
              <VideoCard
                item={entry.data}
                cardHeight={cardHeight}
                isVisible={Math.abs(i - currentIndex) <= 1}
                isActive={i === currentIndex}
                onSkip={() => {
                  const nextIdx = i + 1;
                  if (nextIdx < displayItems.length && containerRef.current) {
                    containerRef.current.scrollTo({ top: nextIdx * cardHeight, behavior: 'smooth' });
                  }
                }}
              />
            ) : (
              <AdCard ad={entry.data} cardHeight={cardHeight} />
            )}
          </div>
        ))}

        {/* 追加読み込み中インジケーター */}
        {hasMore && (
          <div style={{
            height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              color: 'rgba(255,255,255,0.5)', fontSize: FONT.sm, fontWeight: 600,
            }}>読み込み中...</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- レシピ外部リンク ----------
function RecipeSourceLinks({ recipeName }) {
  const { isPremium, setShowPaywall, setPaywallReason } = usePremium();
  const searchQuery = encodeURIComponent(`離乳食 ${recipeName} レシピ`);
  const links = [
    { name: 'クックパッド', icon: '🔍', url: `https://cookpad.com/search/${encodeURIComponent('離乳食 ' + recipeName)}`, color: '#F48120' },
    { name: '楽天レシピ', icon: '📖', url: `https://recipe.rakuten.co.jp/search/${encodeURIComponent('離乳食 ' + recipeName)}/`, color: '#BF0000' },
    { name: 'YouTube', icon: '▶', url: `https://www.youtube.com/results?search_query=${searchQuery}`, color: '#FF0000' },
    { name: 'Google', icon: '🌐', url: `https://www.google.com/search?q=${searchQuery}`, color: '#4285F4' },
  ];

  const handleLockedClick = (e) => {
    e.preventDefault();
    setPaywallReason('外部サイトでレシピの詳しい作り方を見るにはプレミアム会員への登録が必要です');
    setShowPaywall(true);
  };

  return (
    <div style={{ marginTop: 20, padding: 16, background: isPremium ? '#F5F5F5' : '#FFF8F0', borderRadius: 12, border: isPremium ? 'none' : '1.5px solid #FFD6A5', position: 'relative' }}>
      <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 12, color: '#333' }}>
        📚 このレシピの詳しい作り方を見る
      </div>
      {!isPremium && (
        <div style={{
          background: 'linear-gradient(135deg, #FF6B35, #FF8F5E)',
          borderRadius: 10, padding: '12px 16px', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 22 }}>🔒</span>
          <div>
            <div style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>
              プレミアム会員限定機能
            </div>
            <div style={{ color: '#FFE0CC', fontSize: 11, marginTop: 2 }}>
              外部サイトへのリンクはプレミアム会員のみご利用いただけます
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, opacity: isPremium ? 1 : 0.45, pointerEvents: isPremium ? 'auto' : 'none' }}>
        {links.map((link) => (
          <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
            background: '#fff', borderRadius: 10, textDecoration: 'none', color: '#333',
            fontSize: 13, fontWeight: 'bold', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            border: `1px solid ${link.color}22`,
          }}>
            <span style={{ fontSize: 16 }}>{link.icon}</span>
            <span style={{ color: link.color }}>{link.name}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#999' }}>→</span>
          </a>
        ))}
      </div>
      {!isPremium ? (
        <button onClick={handleLockedClick} style={{
          marginTop: 12, width: '100%', padding: '12px 0',
          background: 'linear-gradient(135deg, #FF6B35, #FF8F5E)',
          color: '#fff', border: 'none', borderRadius: 10,
          fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
        }}>
          👑 プレミアム会員になって利用する
        </button>
      ) : (
        <div style={{ fontSize: 11, color: '#999', marginTop: 10, textAlign: 'center' }}>
          外部サイトに移動します
        </div>
      )}
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

          {/* 外部レシピリンク */}
          <RecipeSourceLinks recipeName={recipe.title} />
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
  const [isSearching, setIsSearching] = useState(false);
  const [serverUsage, setServerUsage] = useState(null);
  const { isPremium, trySearch, searchCount } = usePremium();
  const { isAuthenticated } = useAuth();
  const searchTimerRef = useRef(null);

  const doLocalSearch = (q) => {
    const keywords = q.split(/[\s　×x+＋]+/).filter(Boolean);
    return FULL_RECIPES.filter((r) =>
      keywords.every((kw) =>
        r.title.includes(kw) ||
        r.tags.some((t) => t.includes(kw)) ||
        r.ingredients.some((ing) => ing.includes(kw)) ||
        r.stage.includes(kw)
      )
    );
  };

  const doAISearch = async (q) => {
    const babyMonth = parseInt(localStorage.getItem('mogumogu_month')) || 6;
    const allergens = JSON.parse(localStorage.getItem('mogumogu_allergens') || '[]');
    const allergenNames = allergens.map(id => ALLERGENS.find(a => a.id === id)?.name).filter(Boolean);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { recipes: doLocalSearch(q), fromAI: false };

    const ingredients = q.split(/[\s　×x+＋、,]+/).filter(Boolean);

    const res = await fetch('/api/search-recipe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        ingredients,
        baby_month: babyMonth,
        allergens: allergenNames,
        count: 5,
      }),
    });

    if (res.status === 429) {
      const body = await res.json();
      setServerUsage(body);
      return { recipes: doLocalSearch(q), fromAI: false, rateLimited: true };
    }
    if (!res.ok) return { recipes: doLocalSearch(q), fromAI: false };

    const body = await res.json();
    if (body.usage) setServerUsage(body.usage);
    return { recipes: body.recipes || [], fromAI: true };
  };

  const handleSearch = (q) => {
    setQuery(q);
    if (q.trim() === '') {
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    // 未ログイン: ローカル検索のみ（PremiumProvider の制限を適用）
    if (!isAuthenticated) {
      if (!trySearch()) { setQuery(''); return; }
      setHasSearched(true);
      setResults(doLocalSearch(q));
      return;
    }

    // ログイン済み: デバウンスしてAI検索
    setHasSearched(true);
    setIsSearching(true);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    // 即座にローカル結果を表示
    setResults(doLocalSearch(q));
    searchTimerRef.current = setTimeout(async () => {
      const { recipes } = await doAISearch(q);
      setResults(recipes);
      setIsSearching(false);
    }, 600);
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
    <div className="fade-in" style={{ height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
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
        <div style={{ padding: `${SPACE.sm}px ${SPACE.lg}px 0`, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: SPACE.sm }}>
          {isSearching && <span style={{ fontSize: FONT.xs, color: COLORS.primary, fontWeight: 600 }}>🤖 AI検索中...</span>}
          {isAuthenticated && serverUsage ? (
            <span style={{
              background: serverUsage.used >= serverUsage.limit ? '#FFF5F5' : COLORS.tagBg,
              color: serverUsage.used >= serverUsage.limit ? COLORS.danger : COLORS.primaryDark,
              fontSize: FONT.sm, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
              border: `1px solid ${serverUsage.used >= serverUsage.limit ? COLORS.danger + '44' : COLORS.border}`,
            }}>🔍 残り {Math.max(0, serverUsage.limit - serverUsage.used)}/{serverUsage.limit}回（本日）</span>
          ) : (
            <span style={{
              background: searchCount >= 3 ? '#FFF5F5' : COLORS.tagBg,
              color: searchCount >= 3 ? COLORS.danger : COLORS.primaryDark,
              fontSize: FONT.sm, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
              border: `1px solid ${searchCount >= 3 ? COLORS.danger + '44' : COLORS.border}`,
            }}>🔍 残り {Math.max(0, 3 - searchCount)}/3回（本日）</span>
          )}
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

          <LargeAdCard ad={getAd(0)} style={{ marginBottom: SPACE.lg }} />

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

          <CompactAdCard ad={getAd(1)} style={{ marginBottom: SPACE.lg }} />

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
          <LargeAdCard ad={getAd(2)} style={{ marginTop: SPACE.lg }} />
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
              {i === 2 && <LargeAdCard ad={getAd(4)} />}
              {i === 6 && <LargeAdCard ad={getAd(5)} />}
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

// ---------- もぐもぐシェア ----------
const SHARE_FILTERS = [
  { id: 'all', label: 'すべて' },
  { id: 'recipe', label: 'レシピ' },
  { id: 'tip', label: 'コツ' },
  { id: 'photo', label: '写真' },
  { id: 'question', label: '質問' },
  { id: '初期', label: '初期' },
  { id: '中期', label: '中期' },
  { id: '後期', label: '後期' },
  { id: '完了期', label: '完了期' },
];

// ---------- 画像リサイズ & アップロード ----------
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES = 4;

function resizeImage(file) {
  return new Promise((resolve) => {
    Resizer.imageFileResizer(
      file, 1200, 1200, 'JPEG', 80, 0,
      (blob) => resolve(blob),
      'blob'
    );
  });
}

async function uploadPostImages(files, userId, onProgress) {
  const urls = [];
  const timestamp = Date.now();
  for (let i = 0; i < files.length; i++) {
    onProgress?.({ current: i, total: files.length });
    const resized = await resizeImage(files[i]);
    const path = `${userId}/${timestamp}_${i}.jpg`;
    const { error } = await supabase.storage
      .from('post-images')
      .upload(path, resized, { contentType: 'image/jpeg' });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage
      .from('post-images')
      .getPublicUrl(path);
    urls.push(publicUrl);
  }
  onProgress?.({ current: files.length, total: files.length });
  return urls;
}


// ---------- シェア投稿カード ----------
const POST_TYPE_STYLES = {
  recipe: { label: 'レシピ', emoji: '🍳', bg: '#E8F5E9', color: '#2E7D32' },
  tip: { label: 'コツ', emoji: '💡', bg: '#E3F2FD', color: '#1565C0' },
  photo: { label: '写真', emoji: '📷', bg: '#FFF3E0', color: '#E65100' },
  question: { label: '質問', emoji: '❓', bg: '#FCE4EC', color: '#C2185B' },
};

function SharePostCard({ post }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes_count || 0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();
  const postSaved = isFavorite('share_post', post.id);
  const typeStyle = POST_TYPE_STYLES[post.post_type] || POST_TYPE_STYLES.tip;
  const isRakuten = post.source_name === '楽天レシピ';
  const isYouTube = post.source_name === 'YouTube';

  const toggleLike = () => {
    const newLiked = !liked;
    setLiked(newLiked);
    setLikeCount(prev => newLiked ? prev + 1 : prev - 1);
  };

  return (
    <div style={{
      background: '#fff', borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 1px 8px rgba(0,0,0,0.06)', marginBottom: 16,
    }}>
      {post.image_url && (
        <div style={{ width: '100%', height: 200, background: '#f0f0f0', position: 'relative' }}>
          <img
            src={post.image_url}
            alt={post.title}
            onLoad={() => setImageLoaded(true)}
            onError={(e) => { e.target.style.display = 'none'; }}
            style={{
              width: '100%', height: '100%', objectFit: 'cover',
              opacity: imageLoaded ? 1 : 0, transition: 'opacity 0.3s',
            }}
          />
        </div>
      )}
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 11, fontWeight: 'bold', padding: '3px 8px', borderRadius: 8,
            background: typeStyle.bg, color: typeStyle.color,
          }}>
            {typeStyle.emoji} {typeStyle.label}
          </span>
          {post.baby_stage && (
            <span style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 8,
              background: '#FFF3E0', color: '#E65100', fontWeight: 'bold',
            }}>
              {post.baby_stage}
            </span>
          )}
          {(isRakuten || isYouTube) && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
              color: isRakuten ? '#BF0000' : '#FF0000',
              background: '#FFF0F0', padding: '3px 8px', borderRadius: 8, fontWeight: 'bold',
            }}>
              {isRakuten ? '📖' : '▶'} {post.source_name}
            </span>
          )}
        </div>
        <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8, lineHeight: 1.4 }}>
          {post.title}
        </div>
        <div style={{ fontSize: 14, color: '#555', lineHeight: 1.6, marginBottom: 12 }}>
          {post.content}
        </div>
        {post.tags && post.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
            {post.tags.map((tag, i) => (
              <span key={i} style={{
                fontSize: 11, color: '#FF6B35', background: '#FFF3E0',
                padding: '2px 8px', borderRadius: 10,
              }}>
                #{tag}
              </span>
            ))}
          </div>
        )}

        {post.source_url && (
          <a href={post.source_url} target="_blank" rel="noopener noreferrer" style={{
            display: 'block', marginBottom: 12, textDecoration: 'none',
            background: isRakuten ? '#BF0000' : isYouTube ? '#FF0000' : '#FF6B35',
            color: '#fff', borderRadius: 20, padding: '10px 0',
            textAlign: 'center', fontSize: 14, fontWeight: 'bold',
          }}>
            {isRakuten ? '📖 楽天レシピで詳しく見る' :
             isYouTube ? '▶ YouTubeで動画を見る' :
             '詳しく見る →'}
          </a>
        )}

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 12, borderTop: '1px solid #f0f0f0',
        }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <button className="tap-light" onClick={toggleLike} style={{
              background: 'none', border: 'none', fontSize: 13, color: '#888',
              cursor: 'pointer', padding: 0, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {liked ? '❤️' : '♡'} {likeCount}
            </button>
            <span style={{ fontSize: 13, color: '#888' }}>
              💬 {post.comments_count || 0}
            </span>
            <button className="tap-light" onClick={() => toggleFavorite('share_post', post.id, { title: post.title, image_url: post.image_url, source_name: post.source_name, source_url: post.source_url })} style={{
              background: 'none', border: 'none', fontSize: 13,
              color: postSaved ? '#FF6B35' : '#888',
              cursor: 'pointer', padding: 0, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {postSaved ? '🔖' : '📑'} {postSaved ? '保存済' : '保存'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#bbb' }}>
            📌 {post.source_name || 'もぐもぐ'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- 新規投稿フォーム ----------
function NewPostForm({ onClose, onPost }) {
  const { user, isAuthenticated, setAuthScreen } = useAuth();
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState([]); // { file, preview }[]
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const previewUrlsRef = useRef([]);

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  if (!isAuthenticated) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={{
          background: '#fff', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480,
          padding: '32px 24px env(safe-area-inset-bottom, 24px)', textAlign: 'center',
        }}>
          <div style={{ fontSize: 50, marginBottom: 16 }}>🔐</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text, marginBottom: 8 }}>
            ログインが必要です
          </div>
          <div style={{ fontSize: 13, color: COLORS.textLight, marginBottom: 20 }}>
            写真を投稿するにはログインしてください
          </div>
          <button className="tap-scale" onClick={() => { onClose(); setAuthScreen('login'); }} style={{
            background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
            border: 'none', borderRadius: 14, padding: '12px 32px',
            color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>ログイン</button>
        </div>
      </div>
    );
  }

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    setError('');
    const remaining = MAX_IMAGES - images.length;
    const selected = files.slice(0, remaining);
    for (const file of selected) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        setError('JPEG、PNG、WEBPの画像のみ対応しています');
        return;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        setError('5MB以下の画像を選択してください');
        return;
      }
    }
    const newImages = selected.map((file) => {
      const preview = URL.createObjectURL(file);
      previewUrlsRef.current.push(preview);
      return { file, preview };
    });
    setImages((prev) => [...prev, ...newImages]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (idx) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!text.trim() || images.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const imageUrls = await uploadPostImages(
        images.map((img) => img.file),
        user.id,
        (p) => setUploadProgress(p)
      );
      onPost({
        text,
        tags: tags.split(/[\s,]+/).filter(Boolean).map((t) => t.startsWith('#') ? t : `#${t}`),
        imageUrls,
      });
    } catch (err) {
      console.error('Upload error:', err);
      setError('アップロードに失敗しました。もう一度お試しください。');
      setUploading(false);
    }
  };

  const canSubmit = text.trim() && images.length > 0 && !uploading;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget && !uploading) onClose(); }}>
      <div style={{
        background: '#fff', borderRadius: '24px 24px 0 0', width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflow: 'auto', padding: '0 0 env(safe-area-inset-bottom, 16px)',
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
          <button onClick={() => { if (!uploading) onClose(); }} style={{
            background: 'none', border: 'none', fontSize: 14, color: COLORS.textLight,
            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
            opacity: uploading ? 0.4 : 1,
          }}>キャンセル</button>
          <span style={{ fontWeight: 900, fontSize: 16, color: COLORS.text }}>新規投稿</span>
          <button onClick={handleSubmit} disabled={!canSubmit} style={{
            background: canSubmit
              ? `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`
              : '#DDD',
            border: 'none', borderRadius: 14, padding: '6px 16px',
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>{uploading ? '投稿中...' : 'シェア'}</button>
        </div>

        {/* アップロード進捗バー */}
        {uploading && (
          <div style={{ padding: '0 16px 12px' }}>
            <div style={{ fontSize: 12, color: COLORS.textLight, marginBottom: 6, textAlign: 'center' }}>
              画像をアップロード中... ({uploadProgress.current}/{uploadProgress.total})
            </div>
            <div style={{
              width: '100%', height: 6, borderRadius: 3, background: '#FFE0C2', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
                width: uploadProgress.total > 0
                  ? `${(uploadProgress.current / uploadProgress.total) * 100}%`
                  : '0%',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}

        <div style={{ padding: '0 16px 16px' }}>
          {/* 写真選択 */}
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textLight, marginBottom: 8 }}>
            📷 写真を選ぶ（最大{MAX_IMAGES}枚）
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {images.map((img, i) => (
              <div key={i} style={{
                width: 90, height: 90, borderRadius: 14, overflow: 'hidden',
                position: 'relative', border: `2px solid ${COLORS.border}`,
              }}>
                <img src={img.preview} alt="" style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                }} />
                <button onClick={() => removeImage(i)} style={{
                  position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                  borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none',
                  color: '#fff', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✕</button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  width: 90, height: 90, borderRadius: 14,
                  border: `2px dashed ${COLORS.border}`, background: COLORS.tagBg,
                  cursor: 'pointer', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 4,
                  opacity: uploading ? 0.4 : 1,
                }}
              >
                <span style={{ fontSize: 24 }}>📷</span>
                <span style={{ fontSize: 10, color: COLORS.textLight, fontWeight: 600 }}>追加</span>
              </button>
            )}
          </div>

          {/* エラー表示 */}
          {error && (
            <div style={{
              background: '#FFF0F0', border: '1px solid #FFD0D0', borderRadius: 10,
              padding: '8px 12px', fontSize: 12, color: '#D63031', marginBottom: 12,
            }}>{error}</div>
          )}

          {/* テキスト入力 */}
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textLight, marginBottom: 8 }}>
            ✏️ キャプション
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="今日の離乳食について書いてみよう..."
            rows={4}
            disabled={uploading}
            style={{
              width: '100%', borderRadius: 14, border: `2px solid ${COLORS.border}`,
              padding: 14, fontSize: 14, fontFamily: 'inherit', color: COLORS.text,
              resize: 'none', outline: 'none', background: COLORS.bg, boxSizing: 'border-box',
              opacity: uploading ? 0.5 : 1,
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
            disabled={uploading}
            style={{
              width: '100%', borderRadius: 14, border: `2px solid ${COLORS.border}`,
              padding: '12px 14px', fontSize: 14, fontFamily: 'inherit', color: COLORS.text,
              outline: 'none', background: COLORS.bg, boxSizing: 'border-box',
              opacity: uploading ? 0.5 : 1,
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {['#離乳食', '#今日のごはん', '#手作り離乳食', '#もぐもぐ'].map((t) => (
              <button key={t} onClick={() => setTags((prev) => prev ? `${prev} ${t}` : t)} disabled={uploading} style={{
                background: COLORS.tagBg, border: `1px solid ${COLORS.border}`,
                borderRadius: 12, padding: '4px 10px', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', color: COLORS.primaryDark,
                opacity: uploading ? 0.5 : 1,
              }}>{t}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- もぐもぐシェアタブ ----------
const SHARE_PAGE_SIZE = 20;

function formatUserPost(p) {
  return {
    id: p.id,
    post_type: 'photo',
    title: (p.caption || '').split('\n')[0] || 'ユーザー投稿',
    content: p.caption || '',
    image_url: (p.image_urls && p.image_urls[0]) || null,
    source_name: p.user_name || 'ユーザー',
    source_url: null,
    baby_stage: p.stage === 'ゴックン期' ? '初期' : p.stage === 'モグモグ期' ? '中期' : p.stage === 'カミカミ期' ? '後期' : p.stage === 'パクパク期' ? '完了期' : null,
    tags: p.hashtags || [],
    likes_count: p.likes_count || 0,
    comments_count: p.comments_count || 0,
    created_at: p.created_at,
    _source: 'user',
  };
}

function ShareTab() {
  const { tryPost } = usePremium();
  const { user } = useAuth();
  const [filter, setFilter] = useState('all');
  const [showNewPost, setShowNewPost] = useState(false);
  const [sharePosts, setSharePosts] = useState([]);
  const [userPosts, setUserPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const feedRef = useRef(null);

  // --- プルダウンリフレッシュ ---
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);

  const fetchAllPosts = useCallback(async () => {
    setLoadingPosts(true);
    try {
      const [shareRes, userRes] = await Promise.all([
        fetch(`/api/share-posts?action=random&limit=${SHARE_PAGE_SIZE}`).then(r => r.ok ? r.json() : { posts: [] }),
        supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(SHARE_PAGE_SIZE),
      ]);
      setSharePosts((shareRes.posts || []).map(p => ({ ...p, _source: 'share' })));
      setUserPosts((userRes.data || []).map(formatUserPost));
    } catch (e) {
      console.error('fetchAllPosts error:', e);
    }
    setLoadingPosts(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchAllPosts(); }, [fetchAllPosts]);

  // 全投稿を統合して日付順ソート
  const allPosts = useMemo(() => {
    const combined = [...sharePosts, ...userPosts];
    combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return combined;
  }, [sharePosts, userPosts]);

  const filteredPosts = useMemo(() => {
    return allPosts.filter((post) => {
      if (filter === 'all') return true;
      if (['recipe', 'tip', 'photo', 'question'].includes(filter)) return post.post_type === filter;
      return post.baby_stage === filter;
    });
  }, [allPosts, filter]);

  // --- プルダウンリフレッシュハンドラ ---
  const handleTouchStart = useCallback((e) => {
    const feed = feedRef.current;
    if (!feed || feed.scrollTop > 5) return;
    touchStartY.current = e.touches[0].clientY;
    isPulling.current = true;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!isPulling.current || refreshing) return;
    const diff = e.touches[0].clientY - touchStartY.current;
    if (diff > 0) setPullY(Math.min(diff * 0.4, 80));
  }, [refreshing]);

  const handleTouchEnd = useCallback(() => {
    isPulling.current = false;
    if (pullY > 50 && !refreshing) {
      setRefreshing(true);
      setPullY(50);
      fetchAllPosts();
    } else {
      setPullY(0);
    }
  }, [pullY, refreshing, fetchAllPosts]);

  const handleNewPost = async (data) => {
    const postData = {
      user_id: user?.id,
      user_name: user?.user_metadata?.full_name || 'あなた',
      avatar: '😊',
      stage: 'ゴックン期',
      caption: data.text,
      hashtags: data.tags,
      image_urls: data.imageUrls,
      likes_count: 0,
      comments_count: 0,
    };
    const { data: saved } = await supabase
      .from('posts')
      .insert(postData)
      .select()
      .single();
    if (saved) {
      setUserPosts((prev) => [formatUserPost(saved), ...prev]);
    }
    setShowNewPost(false);
  };

  return (
    <div
      ref={feedRef}
      className="fade-in"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ position: 'relative', height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
    >
      {/* プルダウンリフレッシュインジケーター */}
      {(pullY > 0 || refreshing) && (
        <div style={{
          height: refreshing ? 50 : pullY, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: refreshing ? 'none' : 'height 0.15s ease',
          background: COLORS.bg,
        }}>
          <div style={{
            fontSize: 13, color: COLORS.textLight, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {refreshing ? (
              <>
                <span style={{ animation: 'loadingPulse 1s infinite' }}>🔄</span>
                更新中...
              </>
            ) : pullY > 50 ? '↑ 離して更新' : '↓ 引っ張って更新'}
          </div>
        </div>
      )}

      <Header title="📷 もぐもぐシェア" subtitle="みんなの離乳食をシェアしよう" />

      {/* フィルターバー */}
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', padding: `${SPACE.sm + 2}px ${SPACE.lg}px`,
        background: '#fff', borderBottom: `1px solid ${COLORS.border}`,
        WebkitOverflowScrolling: 'touch',
      }}>
        {SHARE_FILTERS.map((f) => (
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
        {loadingPosts && allPosts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8, animation: 'loadingPulse 1s infinite' }}>🍽️</div>
            <div style={{ fontSize: 13, color: COLORS.textLight }}>投稿を読み込み中...</div>
          </div>
        )}
        {filteredPosts.length > 0 ? (
          filteredPosts.map((post, i) => (
            <React.Fragment key={post.id}>
              <SharePostCard post={post} />
              {(i + 1) % 4 === 0 && <LargeAdCard ad={getAd(7 + Math.floor(i / 4))} />}
            </React.Fragment>
          ))
        ) : !loadingPosts ? (
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
        ) : null}

        {allPosts.length > 0 && (
          <div style={{ textAlign: 'center', padding: '16px 0 32px', fontSize: 12, color: COLORS.textLight }}>
            すべての投稿を表示しました
          </div>
        )}
      </div>

      {/* 新規投稿FAB */}
      <button className="tap-scale" onClick={() => { if (tryPost()) setShowNewPost(true); }} style={{
        position: 'fixed', bottom: 90, right: 20,
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
  const { isAuthenticated } = useAuth();
  const [babyMonth] = useState(() => {
    try { return parseInt(localStorage.getItem('mogumogu_month')) || 6; } catch { return 6; }
  });
  const [selectedAllergens] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mogumogu_allergens')) || []; } catch { return []; }
  });
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [genError, setGenError] = useState('');
  const [serverUsage, setServerUsage] = useState(null);

  const currentStage = MONTH_STAGES.find((s) => s.months.includes(babyMonth)) || MONTH_STAGES[0];

  const allergenNames = selectedAllergens.map(
    (id) => ALLERGENS.find((a) => a.id === id)
  ).filter(Boolean);

  const doLocalGenerate = () => {
    const stageRecipes = FULL_RECIPES.filter((r) => r.stage === currentStage.label);
    return stageRecipes.filter(
      (r) => !r.allergens.some((a) => selectedAllergens.includes(a))
    );
  };

  const handleGenerate = async () => {
    if (!tryRecipeGen()) return;
    setGenerating(true);
    setGenError('');

    // ログイン済み: API 呼び出し
    if (isAuthenticated) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('No session');

        const allergenNamesForApi = selectedAllergens.map(id => ALLERGENS.find(a => a.id === id)?.name).filter(Boolean);
        const res = await fetch('/api/generate-recipe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            baby_month: babyMonth,
            allergens: allergenNamesForApi,
            preference: '',
            meal_type: '',
            count: 5,
          }),
        });

        if (res.status === 429) {
          const body = await res.json();
          setServerUsage(body);
          setGenError('本日のAIレシピ生成回数の上限に達しました');
          setRecipes(doLocalGenerate());
        } else if (!res.ok) {
          setRecipes(doLocalGenerate());
        } else {
          const body = await res.json();
          if (body.usage) setServerUsage(body.usage);
          setRecipes(body.recipes || []);
        }
      } catch {
        setRecipes(doLocalGenerate());
      }
    } else {
      // 未ログイン: ローカルフォールバック
      await new Promise(r => setTimeout(r, 1500));
      setRecipes(doLocalGenerate());
    }

    setGenerating(false);
    setGenerated(true);
  };

  return (
    <div className="fade-in" style={{ height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
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
              <div style={{ textAlign: 'center', fontSize: FONT.sm, color: (serverUsage ? serverUsage.used >= serverUsage.limit : recipeGenCount >= 1) ? COLORS.danger : COLORS.textLight, fontWeight: 600, marginTop: -12, marginBottom: SPACE.lg }}>
                {genError ? `🔒 ${genError}` : (serverUsage
                  ? (serverUsage.used >= serverUsage.limit ? '🔒 無料枠を使い切りました' : `🤖 残り ${serverUsage.limit - serverUsage.used}/${serverUsage.limit}回（本日）`)
                  : (recipeGenCount >= 1 ? '🔒 無料枠を使い切りました' : `🤖 残り ${1 - recipeGenCount}/1回（無料）`)
                )}
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
                  {i === 1 && <CompactAdCard ad={getAd(3)} />}
                  {i === 3 && <LargeAdCard ad={getAd(4)} />}
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
                <LargeAdCard ad={getAd(7)} />
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
                  {i === 1 && <CompactAdCard ad={getAd(9)} />}
                </React.Fragment>
              );
            })}
            <LargeAdCard ad={getAd(10)} style={{ marginTop: 4 }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 広告パフォーマンスパネル ----------
function AdAnalyticsPanel() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadStats = async () => {
    if (stats) { setOpen(!open); return; }
    setOpen(true);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ad_analytics')
        .select('ad_id, event_type');
      if (error) { console.error('ad_analytics query error:', error); setLoading(false); return; }

      const map = {};
      (data || []).forEach(row => {
        if (!map[row.ad_id]) map[row.ad_id] = { impressions: 0, clicks: 0 };
        if (row.event_type === 'impression') map[row.ad_id].impressions++;
        if (row.event_type === 'click') map[row.ad_id].clicks++;
      });

      const result = BANNER_ADS.map(ad => ({
        id: ad.id, name: ad.title, emoji: ad.icon,
        impressions: map[ad.id]?.impressions || 0,
        clicks: map[ad.id]?.clicks || 0,
        ctr: map[ad.id]?.impressions > 0
          ? ((map[ad.id].clicks / map[ad.id].impressions) * 100).toFixed(1) : '0.0',
      })).sort((a, b) => parseFloat(b.ctr) - parseFloat(a.ctr));
      setStats(result);
    } catch (e) { console.error('ad_analytics error:', e); }
    setLoading(false);
  };

  const totalImpressions = stats ? stats.reduce((s, r) => s + r.impressions, 0) : 0;
  const totalClicks = stats ? stats.reduce((s, r) => s + r.clicks, 0) : 0;

  const ctrColor = (v) => parseFloat(v) > 3 ? '#4CAF50' : parseFloat(v) > 1 ? '#FF9800' : COLORS.textLight;

  return (
    <div style={{
      background: '#fff', borderRadius: 20, border: `1px solid ${COLORS.border}`,
      overflow: 'hidden', marginTop: SPACE.lg,
    }}>
      <button
        className="tap-scale"
        onClick={loadStats}
        style={{
          width: '100%', padding: `${SPACE.lg}px`, background: 'none', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <span style={{ fontWeight: 700, fontSize: FONT.base, color: COLORS.text }}>広告レポート</span>
        </div>
        <span style={{ fontSize: FONT.sm, color: COLORS.textLight, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
      </button>

      {open && (
        <div style={{ padding: `0 ${SPACE.lg}px ${SPACE.lg}px` }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: SPACE.xl, color: COLORS.textLight, fontSize: FONT.sm }}>読み込み中...</div>
          ) : stats ? (
            <>
              {/* サマリー */}
              <div style={{ display: 'flex', gap: SPACE.sm, marginBottom: SPACE.md }}>
                <div style={{ flex: 1, background: `${COLORS.primary}10`, borderRadius: 12, padding: SPACE.md, textAlign: 'center' }}>
                  <div style={{ fontSize: FONT.xs, color: COLORS.textLight, marginBottom: 4 }}>総表示</div>
                  <div style={{ fontSize: FONT.xl, fontWeight: 900, color: COLORS.primary }}>{totalImpressions.toLocaleString()}</div>
                </div>
                <div style={{ flex: 1, background: '#E8F5E910', borderRadius: 12, padding: SPACE.md, textAlign: 'center' }}>
                  <div style={{ fontSize: FONT.xs, color: COLORS.textLight, marginBottom: 4 }}>総クリック</div>
                  <div style={{ fontSize: FONT.xl, fontWeight: 900, color: '#4CAF50' }}>{totalClicks.toLocaleString()}</div>
                </div>
                <div style={{ flex: 1, background: '#FFF3E010', borderRadius: 12, padding: SPACE.md, textAlign: 'center' }}>
                  <div style={{ fontSize: FONT.xs, color: COLORS.textLight, marginBottom: 4 }}>平均CTR</div>
                  <div style={{ fontSize: FONT.xl, fontWeight: 900, color: '#FF9800' }}>
                    {totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : '0.0'}%
                  </div>
                </div>
              </div>

              {/* 広告別テーブル */}
              <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 60px 60px 55px',
                  padding: `${SPACE.sm}px ${SPACE.md}px`,
                  background: COLORS.bg, fontWeight: 700, fontSize: FONT.xs, color: COLORS.textMuted,
                }}>
                  <span>広告</span>
                  <span style={{ textAlign: 'right' }}>表示</span>
                  <span style={{ textAlign: 'right' }}>Click</span>
                  <span style={{ textAlign: 'right' }}>CTR</span>
                </div>
                {stats.map(row => (
                  <div key={row.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 60px 60px 55px',
                    padding: `${SPACE.sm}px ${SPACE.md}px`,
                    borderTop: `1px solid ${COLORS.border}`, alignItems: 'center',
                  }}>
                    <span style={{ fontSize: FONT.sm, fontWeight: 600, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.emoji} {row.name}
                    </span>
                    <span style={{ textAlign: 'right', fontSize: FONT.sm, color: COLORS.textLight }}>{row.impressions}</span>
                    <span style={{ textAlign: 'right', fontSize: FONT.sm, color: COLORS.textLight }}>{row.clicks}</span>
                    <span style={{ textAlign: 'right', fontSize: FONT.sm, fontWeight: 700, color: ctrColor(row.ctr) }}>{row.ctr}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: SPACE.xl, color: COLORS.textLight, fontSize: FONT.sm }}>
              データがありません
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- 設定タブ ----------
// ---------- プレミアム登録画面 ----------
function PremiumScreen({ onClose }) {
  const { user } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState('yearly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubscribe = async (plan) => {
    setLoading(true);
    setError('');
    try {
      await startCheckout(user.id, user.email, plan);
    } catch (err) {
      console.error('Checkout error:', err);
      setError('決済ページを開けませんでした。もう一度お試しください。');
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3500, background: '#fff',
      overflow: 'auto', WebkitOverflowScrolling: 'touch',
    }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 20px 40px' }}>
        {/* ナビバー */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '16px 0',
          position: 'sticky', top: 0, background: '#fff', zIndex: 1,
        }}>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 14, color: COLORS.textLight,
            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
          }}>← 戻る</button>
        </div>

        {/* ヘッダー */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🍼</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.text }}>
            MoguMogu プレミアム
          </div>
          <div style={{
            fontSize: 15, color: COLORS.primaryDark, fontWeight: 700, marginTop: 6,
          }}>7日間無料でお試し！</div>
        </div>

        {/* 比較テーブル */}
        <div style={{
          background: '#fff', borderRadius: 18, overflow: 'hidden',
          border: `1px solid ${COLORS.border}`, marginBottom: 24,
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 70px 90px',
            background: COLORS.tagBg, padding: '10px 14px',
            fontWeight: 700, fontSize: 12, color: COLORS.textLight,
          }}>
            <span>機能</span>
            <span style={{ textAlign: 'center' }}>無料</span>
            <span style={{ textAlign: 'center', color: COLORS.primaryDark }}>プレミアム</span>
          </div>
          {[
            { label: '離乳食動画', free: '✅', premium: '✅' },
            { label: '基本レシピ', free: '✅', premium: '✅' },
            { label: 'AI離乳食相談', free: '1日3回', premium: '無制限' },
            { label: 'AIレシピ提案', free: '❌', premium: '✅' },
            { label: 'お気に入り保存', free: '10件', premium: '無制限' },
            { label: '広告非表示', free: '❌', premium: '✅' },
            { label: 'SNS投稿', free: '閲覧のみ', premium: '✅' },
          ].map((row, i) => (
            <div key={row.label} style={{
              display: 'grid', gridTemplateColumns: '1fr 70px 90px',
              padding: '10px 14px', alignItems: 'center',
              borderTop: `1px solid ${COLORS.border}`,
              background: i % 2 === 0 ? '#fff' : '#FAFAFA',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{row.label}</span>
              <span style={{ textAlign: 'center', fontSize: 12, color: COLORS.textLight }}>{row.free}</span>
              <span style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: COLORS.primaryDark }}>{row.premium}</span>
            </div>
          ))}
        </div>

        {/* プランカード */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {/* 月額 */}
          <button onClick={() => setSelectedPlan('monthly')} style={{
            flex: 1, borderRadius: 16, padding: '18px 12px', cursor: 'pointer',
            fontFamily: 'inherit', textAlign: 'center',
            border: selectedPlan === 'monthly' ? `3px solid ${COLORS.primaryDark}` : `2px solid ${COLORS.border}`,
            background: selectedPlan === 'monthly' ? '#FFF8F0' : '#fff',
          }}>
            <div style={{ fontSize: 12, color: COLORS.textLight, fontWeight: 600, marginBottom: 6 }}>月額プラン</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: COLORS.text }}>¥480</div>
            <div style={{ fontSize: 11, color: COLORS.textLight }}>/月</div>
          </button>
          {/* 年額 */}
          <button onClick={() => setSelectedPlan('yearly')} style={{
            flex: 1, borderRadius: 16, padding: '18px 12px', cursor: 'pointer',
            fontFamily: 'inherit', textAlign: 'center', position: 'relative',
            border: selectedPlan === 'yearly' ? `3px solid ${COLORS.primaryDark}` : `2px solid ${COLORS.border}`,
            background: selectedPlan === 'yearly' ? '#FFF8F0' : '#fff',
          }}>
            <div style={{
              position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
              background: COLORS.danger, color: '#fff', fontSize: 10, fontWeight: 900,
              padding: '2px 10px', borderRadius: 10, whiteSpace: 'nowrap',
            }}>34% OFF おすすめ</div>
            <div style={{ fontSize: 12, color: COLORS.textLight, fontWeight: 600, marginBottom: 6, marginTop: 4 }}>年額プラン</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: COLORS.primaryDark }}>¥3,800</div>
            <div style={{ fontSize: 11, color: COLORS.textLight }}>月あたり ¥317</div>
          </button>
        </div>

        {/* エラー */}
        {error && (
          <div style={{
            background: '#FFF0F0', border: '1px solid #FFD0D0', borderRadius: 10,
            padding: '8px 12px', fontSize: 12, color: '#D63031', marginBottom: 12, textAlign: 'center',
          }}>{error}</div>
        )}

        {/* 購入ボタン */}
        <button onClick={() => handleSubscribe(selectedPlan)} disabled={loading} style={{
          width: '100%', padding: 16, borderRadius: 24, border: 'none',
          background: loading ? '#ccc' : `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
          color: '#fff', fontSize: 17, fontWeight: 900, cursor: 'pointer',
          fontFamily: 'inherit', boxShadow: loading ? 'none' : '0 4px 20px rgba(255,107,53,0.35)',
          marginBottom: 16,
        }}>
          {loading ? '決済ページを準備中...' : '7日間無料で始める'}
        </button>

        {/* 注意書き */}
        <div style={{ textAlign: 'center', fontSize: 12, color: COLORS.textLight, lineHeight: 1.8 }}>
          <div>無料トライアル期間中に解約すれば料金は発生しません</div>
          <div>トライアル終了後、{selectedPlan === 'yearly' ? '¥3,800/年' : '¥480/月'}で自動更新されます</div>
          <div style={{ marginTop: 4 }}>いつでも解約OK</div>
        </div>
      </div>
    </div>
  );
}

// ---------- プレミアム登録成功画面 ----------
function PremiumSuccessScreen({ onClose, sessionId }) {
  const { activatePremium } = usePremium();
  const [activating, setActivating] = useState(true);
  const [subInfo, setSubInfo] = useState(null);
  const [error, setError] = useState(null);

  // Stripe に直接確認 + DB 更新（認証セッション不要）
  useEffect(() => {
    if (!sessionId) {
      setActivating(false);
      setError('セッション情報がありません');
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const verify = async () => {
      while (!cancelled && attempts < 5) {
        attempts++;
        try {
          const res = await fetch('/api/verify-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
          const data = await res.json();
          if (cancelled) return;
          if (data.isPremium) {
            activatePremium();
            setSubInfo(data.subscription);
            setActivating(false);
            return;
          }
        } catch (e) {
          console.error('verify-checkout attempt failed:', e);
        }
        // リトライ前に3秒待つ
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!cancelled) {
        setActivating(false);
        setError('有効化に時間がかかっています。ページを再読み込みしてください。');
      }
    };
    verify();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const trialEndDate = subInfo?.trial_end
    ? new Date(subInfo.trial_end).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })
    : '7日後';

  const handleClose = () => {
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3500, background: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ textAlign: 'center', padding: '0 32px', maxWidth: 400 }}>
        <div style={{ fontSize: 72, marginBottom: 20 }}>🎉</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: COLORS.text, marginBottom: 12 }}>
          プレミアム登録ありがとうございます！
        </div>
        <div style={{ fontSize: 15, color: COLORS.textLight, lineHeight: 1.8, marginBottom: 24 }}>
          7日間の無料トライアルが始まりました
        </div>
        {activating && (
          <div style={{ fontSize: 14, color: COLORS.primary, marginBottom: 16 }}>
            プランを有効化しています...
          </div>
        )}
        {error && (
          <div style={{ fontSize: 13, color: '#e74c3c', marginBottom: 16 }}>
            {error}
          </div>
        )}
        <div style={{
          background: COLORS.tagBg, borderRadius: 16, padding: '16px 20px',
          marginBottom: 28, border: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ fontSize: 13, color: COLORS.textLight, marginBottom: 4 }}>トライアル終了日</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: COLORS.primaryDark }}>{trialEndDate}</div>
        </div>
        <button className="tap-scale" onClick={handleClose} style={{
          width: '100%', padding: 16, borderRadius: 24, border: 'none',
          background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
          color: '#fff', fontSize: 16, fontWeight: 900, cursor: 'pointer',
          fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(255,107,53,0.3)',
        }}>ホームに戻る</button>
      </div>
    </div>
  );
}

// ---------- サブスクリプション情報 & Customer Portal ----------
function SubscriptionInfo() {
  const { subscription } = useSubscription();
  const [portalLoading, setPortalLoading] = useState(false);

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await openCustomerPortal(session.access_token);
    } catch (err) {
      console.error('Portal error:', err);
      setPortalLoading(false);
    }
  };

  const planLabel = subscription?.plan === 'premium_yearly' ? '年額プラン (¥3,800/年)'
    : subscription?.plan === 'premium_monthly' ? '月額プラン (¥480/月)'
    : 'プレミアム';
  const statusLabel = subscription?.status === 'trialing' ? '無料トライアル中'
    : subscription?.status === 'active' ? '有効'
    : subscription?.status || '';
  const periodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <div>
      {/* サブスク情報 */}
      <div style={{
        background: 'rgba(255,255,255,0.25)', borderRadius: 12, padding: '12px 14px',
        marginBottom: 10,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>プラン</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{planLabel}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>ステータス</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{statusLabel}</span>
        </div>
        {periodEnd && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>次回更新日</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{periodEnd}</span>
          </div>
        )}
        {subscription?.cancel_at_period_end && (
          <div style={{
            marginTop: 8, background: 'rgba(255,0,0,0.15)', borderRadius: 8,
            padding: '6px 10px', fontSize: 11, color: '#fff', textAlign: 'center',
          }}>解約予定（期間終了後に無料プランへ移行）</div>
        )}
      </div>

      {/* Portal ボタン */}
      <button onClick={handlePortal} disabled={portalLoading} style={{
        width: '100%', padding: 12, borderRadius: 12, border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
        background: 'rgba(255,255,255,0.3)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        opacity: portalLoading ? 0.6 : 1,
      }}>
        {portalLoading ? '読み込み中...' : '🔧 プランを管理・解約'}
      </button>
    </div>
  );
}

// ---------- AI相談タブ ----------
const AI_INITIAL_MESSAGE = { role: 'assistant', content: 'こんにちは！離乳食や育児について、何でもご相談ください 🍙\n\n月齢に合った食材や調理法、アレルギーのこと、食べない時の対策など、お気軽にどうぞ！' };
let _aiChatCache = null;

function AiConsultationTab() {
  const { isAuthenticated, setAuthScreen } = useAuth();
  const { isPremium } = usePremium();
  const [messages, setMessages] = useState(() => _aiChatCache || [AI_INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // タブ切替時も会話を保持
  useEffect(() => {
    _aiChatCache = messages;
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const quickQuestions = [
    { label: '離乳食の進め方', q: '離乳食の進め方を教えてください。今の月齢ではどんな食材が食べられますか？' },
    { label: 'アレルギーについて', q: 'アレルギーが心配です。新しい食材を始める時の注意点を教えてください。' },
    { label: '食材の選び方', q: '月齢に合ったおすすめの食材と調理方法を教えてください。' },
    { label: '食べない時の対策', q: '離乳食を食べてくれない時、どうすればいいですか？' },
  ];

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || sending) return;
    if (!isAuthenticated) {
      setAuthScreen('login');
      return;
    }

    const userMsg = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('セッションが切れました');

      const babyMonth = parseInt(localStorage.getItem('mogumogu_month')) || 6;
      const allergens = JSON.parse(localStorage.getItem('mogumogu_allergens') || '[]');

      const history = messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-20);

      const res = await fetch('/api/ai-consultation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: text.trim(),
          baby_month: babyMonth,
          allergens,
          history,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'エラーが発生しました');
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setError(e.message);
      setMessages(prev => [...prev, { role: 'assistant', content: `エラーが発生しました: ${e.message}`, isError: true }]);
    }
    setSending(false);
  }, [sending, isAuthenticated, setAuthScreen, messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Header title="💬 AI相談" subtitle="離乳食・育児のお悩みに回答" />

      {/* メッセージエリア */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: `0 ${SPACE.md}px ${SPACE.md}px`,
        WebkitOverflowScrolling: 'touch',
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 12,
          }}>
            {msg.role === 'assistant' && (
              <div style={{
                width: 32, height: 32, borderRadius: '50%', marginRight: 8, flexShrink: 0,
                background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, marginTop: 4,
              }}>🍙</div>
            )}
            <div style={{
              maxWidth: '80%', padding: '12px 16px', borderRadius: 18,
              background: msg.role === 'user'
                ? `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`
                : msg.isError ? '#FFF3F0' : '#f0f0f0',
              color: msg.role === 'user' ? '#fff' : msg.isError ? COLORS.danger : '#333',
              fontSize: FONT.sm, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              borderBottomRightRadius: msg.role === 'user' ? 4 : 18,
              borderBottomLeftRadius: msg.role === 'assistant' ? 4 : 18,
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            }}>🍙</div>
            <div style={{
              padding: '12px 20px', borderRadius: 18, background: '#f0f0f0',
              borderBottomLeftRadius: 4,
            }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0, 1, 2].map(j => (
                  <div key={j} style={{
                    width: 8, height: 8, borderRadius: '50%', background: '#999',
                    animation: `typingDot 1.4s infinite ${j * 0.2}s`,
                  }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {error && !sending && (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <button onClick={() => {
              const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
              if (lastUserMsg) {
                setMessages(prev => prev.filter(m => !m.isError));
                sendMessage(lastUserMsg.content);
              }
            }} style={{
              background: 'none', border: `1px solid ${COLORS.primary}`, color: COLORS.primary,
              borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              🔄 もう一度送信
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />

        {/* クイック質問（メッセージが初期のみの場合） */}
        {messages.length <= 1 && (
          <div style={{ marginTop: SPACE.md }}>
            <div style={{ fontSize: FONT.xs, color: COLORS.textLight, marginBottom: 8, fontWeight: 700 }}>
              よくある質問
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {quickQuestions.map((qq, i) => (
                <button key={i} onClick={() => sendMessage(qq.q)} style={{
                  padding: '8px 14px', borderRadius: 20, border: `1px solid ${COLORS.border}`,
                  background: '#fff', color: '#555', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  {qq.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 入力エリア */}
      <form onSubmit={handleSubmit} style={{
        padding: `${SPACE.sm}px ${SPACE.md}px`,
        paddingBottom: `max(${SPACE.sm}px, env(safe-area-inset-bottom, ${SPACE.sm}px))`,
        borderTop: `1px solid ${COLORS.border}`,
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)',
        display: 'flex', gap: 8, alignItems: 'center',
        flexShrink: 0, boxSizing: 'border-box', width: '100%',
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="質問を入力..."
          disabled={sending}
          style={{
            flex: 1, minWidth: 0, padding: '10px 16px', borderRadius: 24,
            border: `1px solid ${COLORS.border}`, fontSize: 16,
            fontFamily: 'inherit', outline: 'none', background: '#f5f5f5',
            boxSizing: 'border-box',
          }}
        />
        <button type="submit" disabled={sending || !input.trim()} style={{
          width: 40, minWidth: 40, height: 40, borderRadius: '50%', border: 'none',
          background: input.trim() && !sending
            ? `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`
            : '#ddd',
          color: '#fff', fontSize: 18, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, transition: 'background 0.2s',
          boxSizing: 'border-box',
        }}>
          ↑
        </button>
      </form>

      {!isPremium && (
        <div style={{
          textAlign: 'center', fontSize: 10, color: COLORS.textLight,
          padding: '4px 0', background: '#f9f9f9',
        }}>
          無料: 1日3回まで / プレミアムで無制限
        </div>
      )}
    </div>
  );
}

function SavedItemsSection() {
  const { favorites, toggleFavorite } = useFavorites();
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return favorites;
    return favorites.filter(f => f.item_type === filter);
  }, [favorites, filter]);

  const filters = [
    { id: 'all', label: '全て' },
    { id: 'video', label: '動画' },
    { id: 'share_post', label: '投稿' },
  ];

  const handleOpen = (fav) => {
    if (fav.item_type === 'video' && fav.item_data?.youtube_id) {
      window.open(`https://www.youtube.com/shorts/${fav.item_data.youtube_id}`, '_blank');
    } else if (fav.item_data?.source_url) {
      window.open(fav.item_data.source_url, '_blank');
    }
  };

  return (
    <div style={{
      background: COLORS.card, borderRadius: 18, padding: SPACE.lg,
      marginBottom: SPACE.xl, border: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ fontSize: FONT.lg, fontWeight: 900, marginBottom: SPACE.md }}>
        🔖 保存したアイテム
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: SPACE.md }}>
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '6px 14px', borderRadius: 20, border: 'none',
            background: filter === f.id ? COLORS.primary : '#f0f0f0',
            color: filter === f.id ? '#fff' : '#666',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: SPACE.xl, color: COLORS.textLight }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📑</div>
          <div style={{ fontSize: FONT.sm }}>まだ保存したアイテムはありません</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((fav, i) => (
            <div key={fav.id || i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: '#f9f9f9', borderRadius: 12, padding: 10,
              cursor: 'pointer', position: 'relative',
            }} onClick={() => handleOpen(fav)}>
              {fav.item_type === 'video' && fav.item_data?.thumbnail_url ? (
                <img src={fav.item_data.thumbnail_url} alt="" style={{
                  width: 60, height: 45, borderRadius: 8, objectFit: 'cover',
                }} />
              ) : fav.item_data?.image_url ? (
                <img src={fav.item_data.image_url} alt="" style={{
                  width: 60, height: 45, borderRadius: 8, objectFit: 'cover',
                }} />
              ) : (
                <div style={{
                  width: 60, height: 45, borderRadius: 8, background: '#e0e0e0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                }}>
                  {fav.item_type === 'video' ? '🎬' : '📄'}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: '#333',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {fav.item_data?.title || '無題'}
                </div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                  {fav.item_type === 'video' ? `🎬 ${fav.item_data?.channel_name || '動画'}` : `📌 ${fav.item_data?.source_name || '投稿'}`}
                </div>
              </div>
              <button onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(fav.item_type, fav.item_id);
              }} style={{
                background: 'none', border: 'none', fontSize: 16,
                cursor: 'pointer', padding: 4, color: '#ccc',
              }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const { isPremium, setShowPaywall, setPaywallReason, searchCount, recipeGenCount, commentCount } = usePremium();
  const { userProfile, updateProfile, signOut, user } = useAuth();
  const [babyMonth, setBabyMonth] = useState(() => {
    if (userProfile) return userProfile.baby_month;
    try { return parseInt(localStorage.getItem('mogumogu_month')) || 6; }
    catch { return 6; }
  });
  const [selectedAllergens, setSelectedAllergens] = useState(() => {
    if (userProfile) return userProfile.allergens || [];
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

  const handleSave = async () => {
    localStorage.setItem('mogumogu_month', babyMonth.toString());
    localStorage.setItem('mogumogu_allergens', JSON.stringify(selectedAllergens));
    if (userProfile) {
      await updateProfile({ baby_month: babyMonth, allergens: selectedAllergens });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fade-in" style={{ height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
      <Header title="⚙️ 設定" subtitle="お子さまの情報を登録しよう" />

      <div style={{ padding: SPACE.lg }}>
        {/* プロフィールカード */}
        {user && (
          <div style={{
            background: COLORS.card, borderRadius: 18, padding: SPACE.lg,
            marginBottom: SPACE.xl, border: `1px solid ${COLORS.border}`,
            display: 'flex', alignItems: 'center', gap: SPACE.md,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, color: '#fff', fontWeight: 900, flexShrink: 0,
            }}>
              {(userProfile?.nickname || user.email || '?')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.text }}>
                {userProfile?.nickname || 'ユーザー'}
              </div>
              <div style={{ fontSize: FONT.sm, color: COLORS.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
            </div>
          </div>
        )}

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

          {/* プレミアム会員: サブスク詳細 & Portal */}
          {isPremium && (
            <SubscriptionInfo />
          )}
        </div>

        {/* 保存済みアイテム */}
        <SavedItemsSection />

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

        {/* ログアウトボタン */}
        {user && (
          <button className="tap-scale" onClick={signOut} style={{
            width: '100%', padding: SPACE.lg, borderRadius: 16,
            border: `2px solid ${COLORS.danger}`, background: '#fff',
            color: COLORS.danger, fontSize: FONT.lg, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', marginTop: SPACE.lg,
          }}>
            ログアウト
          </button>
        )}

        {/* おすすめ広告 */}
        <CompactAdCard ad={getAd(12)} />

        {/* 広告パフォーマンス */}
        <AdAnalyticsPanel />

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
// ---------- PWA インストールバナー ----------
function useInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const deferredPrompt = useRef(null);

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);
    const android = /android/.test(ua);
    setIsIOS(ios);
    setIsAndroid(android);

    // 既にインストール済み or dismiss 済みなら非表示
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (isStandalone || localStorage.getItem('mogumogu_install_dismissed') === 'true') return;

    // 訪問カウント
    let count = parseInt(localStorage.getItem('mogumogu_visit_count') || '0', 10) + 1;
    localStorage.setItem('mogumogu_visit_count', count.toString());
    if (count < 3) return;

    if (android || (!ios && !android)) {
      const handler = (e) => { e.preventDefault(); deferredPrompt.current = e; setShowPrompt(true); };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    } else if (ios) {
      setShowPrompt(true);
    }
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt.current) {
      deferredPrompt.current.prompt();
      await deferredPrompt.current.userChoice;
      deferredPrompt.current = null;
    }
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('mogumogu_install_dismissed', 'true');
  };

  return { showPrompt, isIOS, isAndroid, handleInstall, handleDismiss };
}

function InstallPromptBanner({ isIOS, isAndroid, onInstall, onDismiss }) {
  return (
    <div style={{
      position: 'fixed', bottom: 80, left: SPACE.md, right: SPACE.md,
      background: COLORS.card, border: `2px solid ${COLORS.primary}`,
      borderRadius: 20, padding: SPACE.lg,
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 3000,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: SPACE.md }}>
        <div style={{ fontSize: 40, flexShrink: 0, lineHeight: 1 }}>🍙</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.text, marginBottom: SPACE.xs }}>
            MoguMogu をホーム画面に追加しませんか？
          </div>
          {isIOS ? (
            <div style={{ fontSize: FONT.sm, color: COLORS.textLight, lineHeight: 1.8, marginTop: SPACE.xs }}>
              <div>1. 下部の <strong>共有ボタン ⬆</strong> をタップ</div>
              <div>2. <strong>「ホーム画面に追加」</strong> を選択</div>
            </div>
          ) : (
            <div style={{ fontSize: FONT.sm, color: COLORS.textLight, marginTop: SPACE.xs }}>
              オフラインでも使えるようになります
            </div>
          )}
          <div style={{ display: 'flex', gap: SPACE.sm, marginTop: SPACE.md }}>
            {isAndroid && (
              <button onClick={onInstall} style={{
                flex: 1, padding: `${SPACE.sm}px ${SPACE.md}px`,
                background: COLORS.primary, color: '#fff', border: 'none',
                borderRadius: 12, fontSize: FONT.base, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>追加する</button>
            )}
            <button onClick={onDismiss} style={{
              flex: isAndroid ? 0 : 1, padding: `${SPACE.sm}px ${SPACE.md}px`,
              background: 'transparent', color: COLORS.textLight,
              border: `1px solid ${COLORS.border}`, borderRadius: 12,
              fontSize: FONT.base, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            }}>{isAndroid ? 'あとで' : '閉じる'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- オフラインインジケーター ----------
function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (isOnline) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: COLORS.textMuted, color: '#fff',
      padding: SPACE.sm, textAlign: 'center', fontSize: FONT.sm, fontWeight: 700,
    }}>
      オフラインモード - 一部の機能が制限されています
    </div>
  );
}

// ============================================================
const PROTECTED_TABS = ['search', 'share', 'recipe', 'ai', 'settings'];

function App() {
  const { loading, authScreen, setAuthScreen, isAuthenticated, user } = useAuth();
  const { refreshPremium } = usePremium();
  const { showPrompt, isIOS, isAndroid, handleInstall, handleDismiss } = useInstallPrompt();
  const [activeTab, setActiveTab] = useState('home');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayedTab, setDisplayedTab] = useState('home');
  const [premiumScreen, setPremiumScreen] = useState(null); // 'premium' | 'success' | null
  const [checkoutStatus, setCheckoutStatus] = useState(null); // 'success' | 'cancel'

  // session_id を URL から同期的に取得（useEffect より前に確定）
  const [checkoutSessionId] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sid = params.get('session_id');
      if (sid) {
        sessionStorage.setItem('mogumogu_checkout_session', sid);
        return sid;
      }
      return sessionStorage.getItem('mogumogu_checkout_session') || null;
    } catch { return null; }
  });

  // URL パラメータ処理（Stripe リダイレクト、Portal 戻り）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const premium = params.get('premium');
    const checkout = params.get('checkout');
    const isSuccess = premium === 'success' || checkout === 'success';
    const isCancel = premium === 'cancel' || checkout === 'cancel';

    if (isSuccess) {
      setPremiumScreen('success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (isCancel) {
      setCheckoutStatus('cancel');
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => setCheckoutStatus(null), 4000);
    }
    // Portal からの戻り
    if (params.get('tab') === 'settings') {
      setActiveTab('settings');
      setDisplayedTab('settings');
      window.history.replaceState({}, '', window.location.pathname);
      if (user) refreshPremium();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleTabChange = useCallback((newTab) => {
    if (newTab === activeTab || isTransitioning) return;
    if (PROTECTED_TABS.includes(newTab) && !isAuthenticated) {
      setAuthScreen('login');
      return;
    }
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveTab(newTab);
      setDisplayedTab(newTab);
      window.scrollTo({ top: 0, behavior: 'instant' });
      requestAnimationFrame(() => {
        setIsTransitioning(false);
      });
    }, 150);
  }, [activeTab, isTransitioning, isAuthenticated, setAuthScreen]);

  if (loading) {
    return (
      <div style={{ ...styles.app, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: SPACE.md, animation: 'loadingPulse 1.5s infinite' }}>🍙</div>
          <div style={{ fontSize: FONT.base, color: COLORS.textLight }}>読み込み中...</div>
        </div>
      </div>
    );
  }

  if (authScreen === 'login') return <LoginScreen />;
  if (authScreen === 'signup') return <SignupScreen />;
  if (authScreen === 'reset') return <ResetPasswordScreen />;
  if (authScreen === 'onboarding') return <OnboardingScreen />;

  const renderTab = () => {
    const tab = isTransitioning ? displayedTab : activeTab;
    switch (tab) {
      case 'home': return <HomeTab />;
      case 'search': return <SearchTab />;
      case 'share': return <ShareTab />;
      case 'recipe': return <RecipeTab />;
      case 'ai': return <AiConsultationTab />;
      case 'settings': return <SettingsTab />;
      default: return <HomeTab />;
    }
  };

  return (
    <div style={styles.app}>
      {/* メインコンテンツ（ページ遷移アニメーション） */}
      <div style={{
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
        opacity: isTransitioning ? 0 : 1,
        transform: isTransitioning ? 'translateY(8px)' : 'translateY(0)',
        transition: 'opacity 0.15s ease, transform 0.15s ease',
        willChange: 'opacity, transform',
      }}>
        {renderTab()}
      </div>

      {/* タブバー */}
      <nav style={styles.tabBar}>
        {TABS.map((tab) => {
          const isProtected = PROTECTED_TABS.includes(tab.id) && !isAuthenticated;
          return (
            <button
              className="tab-btn"
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              style={styles.tabItem(activeTab === tab.id)}
            >
              <span style={styles.tabIcon(activeTab === tab.id)}>
                {tab.icon}
              </span>
              <span style={{ position: 'relative' }}>
                {tab.label}
                {isProtected && <span style={{ fontSize: 8, marginLeft: 2, verticalAlign: 'super' }}>🔒</span>}
              </span>
              {activeTab === tab.id && <div style={styles.tabIndicator} />}
            </button>
          );
        })}
      </nav>

      {/* プレミアム画面 */}
      {premiumScreen === 'premium' && (
        <PremiumScreen onClose={() => setPremiumScreen(null)} />
      )}
      {premiumScreen === 'success' && (
        <PremiumSuccessScreen
          sessionId={checkoutSessionId}
          onClose={() => {
            sessionStorage.removeItem('mogumogu_checkout_session');
            setPremiumScreen(null);
            setActiveTab('home');
          }}
        />
      )}

      {/* キャンセルバナー */}
      {checkoutStatus === 'cancel' && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 4000,
          background: '#636E72', padding: '12px 20px', textAlign: 'center',
          animation: 'fadeInUp 0.3s ease-out',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
            決済がキャンセルされました
          </div>
        </div>
      )}

      {/* Paywallモーダル */}
      <PaywallModal />

      {/* PWA */}
      <OfflineIndicator />
      {showPrompt && (
        <InstallPromptBanner
          isIOS={isIOS}
          isAndroid={isAndroid}
          onInstall={handleInstall}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  );
}

function AppRoot() {
  return (
    <AuthProvider>
      <PremiumProvider>
        <App />
      </PremiumProvider>
    </AuthProvider>
  );
}

export default AppRoot;
