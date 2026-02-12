import React, { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { supabase } from './lib/supabase';

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
      updateProfile, completeOnboarding,
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
  const { userProfile } = useAuth();
  const [isPremium, setIsPremium] = useState(() => {
    try { return localStorage.getItem('mogumogu_premium') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    if (userProfile) {
      setIsPremium(userProfile.is_premium);
      localStorage.setItem('mogumogu_premium', userProfile.is_premium.toString());
    }
  }, [userProfile]);
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
    if (userProfile) {
      await supabase.from('users').update({ is_premium: next }).eq('id', userProfile.id);
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
    }}>
      {children}
    </PremiumContext.Provider>
  );
}

function usePremium() {
  return useContext(PremiumContext);
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

// ---------- 広告データ（12種） ----------
const AD_BANNERS = [
  { id: 'ad01', brand: 'コープデリ', emoji: '🚚', color: '#00833E', tagline: '子育て家庭に大人気！', desc: '離乳食食材も玄関先にお届け', cta: '無料資料請求はこちら', url: 'https://efriends.coopdeli.jp/' },
  { id: 'ad02', brand: 'プレミアムウォーター', emoji: '💧', color: '#0077C8', tagline: 'ミルク作りに安心の天然水', desc: '赤ちゃんにやさしい軟水ウォーターサーバー', cta: 'お得に始める', url: 'https://premium-water.net/' },
  { id: 'ad03', brand: 'トイサブ！', emoji: '🧸', color: '#FF6B9D', tagline: '知育おもちゃのサブスク', desc: '月齢にぴったりのおもちゃが届く', cta: '初月半額キャンペーン', url: 'https://toysub.net/' },
  { id: 'ad04', brand: 'カインデスト', emoji: '🍼', color: '#7EC8B0', tagline: '小児科医監修の離乳食', desc: 'オーガニック素材のベビーフード定期便', cta: '初回限定セットを見る', url: 'https://the-kindest.com/' },
  { id: 'ad05', brand: 'Famm出張撮影', emoji: '📸', color: '#F5A623', tagline: '家族の思い出をプロの写真で', desc: '離乳食デビューの記念撮影にも', cta: '撮影を予約する', url: 'https://famm.us/ja/photography' },
  { id: 'ad06', brand: 'Oisix', emoji: '🥬', color: '#7CB342', tagline: 'Kit Oisixで時短ごはん', desc: '離乳食取り分けレシピ付きミールキット', cta: 'おためしセット1,980円', url: 'https://www.oisix.com/' },
  { id: 'ad07', brand: 'CaSy', emoji: '✨', color: '#6C63FF', tagline: '家事代行で育児に余裕を', desc: '料理・掃除をプロにおまかせ', cta: '初回お試し2,500円〜', url: 'https://casy.co.jp/' },
  { id: 'ad08', brand: 'ほけんの窓口', emoji: '🛡️', color: '#E65100', tagline: '学資保険の無料相談', desc: 'お子さまの将来に備える保険選び', cta: '無料で相談する', url: 'https://www.hokennomadoguchi.com/' },
  { id: 'ad09', brand: 'ブラウン ブレンダー', emoji: '🔧', color: '#333333', tagline: '離乳食作りの必需品', desc: 'ハンドブレンダー マルチクイック', cta: '詳しく見る', url: 'https://www.braunhousehold.com/ja-jp/hand-blenders' },
  { id: 'ad10', brand: 'リッチェル 冷凍容器', emoji: '🧊', color: '#00BCD4', tagline: 'わけわけフリージング', desc: '離乳食の小分け冷凍に便利な容器', cta: '商品をチェック', url: 'https://www.richell.co.jp/shop/baby' },
  { id: 'ad11', brand: 'パルシステム', emoji: '🐄', color: '#E8383D', tagline: '産直食材を食卓へ', desc: 'うらごし野菜シリーズが離乳食に便利', cta: '無料おためしセット', url: 'https://www.pal-system.co.jp/' },
  { id: 'ad12', brand: 'ユニクロベビー', emoji: '👶', color: '#FF0000', tagline: 'やわらか素材のベビー服', desc: '食べこぼしに強い！洗濯ラクちん', cta: 'オンラインストアへ', url: 'https://www.uniqlo.com/jp/ja/baby' },
];

// ---------- A/Bテスト設定 ----------
// 各スロット(広告枠)に A/B 2種の広告を割り当て、50%ずつ表示
const AB_TESTS = [
  { slot: 'slot-0', adA: 'ad01', adB: 'ad02' },
  { slot: 'slot-1', adA: 'ad03', adB: 'ad04' },
  { slot: 'slot-2', adA: 'ad05', adB: 'ad06' },
  { slot: 'slot-3', adA: 'ad07', adB: 'ad08' },
  { slot: 'slot-4', adA: 'ad09', adB: 'ad10' },
  { slot: 'slot-5', adA: 'ad11', adB: 'ad12' },
];

const adById = {};
AD_BANNERS.forEach(ad => { adById[ad.id] = ad; });

// セッション内で同じスロットには同じバリアントを返す（一貫性）
const slotVariantCache = {};

function getAd(index) {
  const slotIndex = Math.floor(index) % AB_TESTS.length;
  const test = AB_TESTS[slotIndex];

  // セッション内キャッシュ: 同じスロットは常に同じバリアント
  if (!slotVariantCache[test.slot]) {
    slotVariantCache[test.slot] = Math.random() < 0.5 ? 'A' : 'B';
  }
  const variant = slotVariantCache[test.slot];
  const adId = variant === 'A' ? test.adA : test.adB;
  const ad = adById[adId] || AD_BANNERS[0];

  // A/Bテスト情報を広告オブジェクトに付与
  return { ...ad, _slot: test.slot, _variant: variant };
}

// 広告イベント記録（fire-and-forget、スロット・バリアント情報付き）
function trackAdEvent(adId, eventType, slot, variant) {
  const row = { ad_id: adId, event_type: eventType };
  if (slot) row.slot = slot;
  if (variant) row.variant = variant;
  supabase.from('ad_analytics').insert(row).then(({ error }) => {
    if (error) console.error('ad_analytics insert error:', error);
  });
}

// 広告クリック処理
function handleAdClick(ad) {
  trackAdEvent(ad.id, 'click', ad._slot, ad._variant);
  if (ad.url) window.open(ad.url, '_blank', 'noopener,noreferrer');
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
  useEffect(() => { if (ad && !isPremium && !dismissed) trackAdEvent(ad.id, 'impression', ad._slot, ad._variant); }, [ad, isPremium, dismissed]);
  if (isPremium || dismissed || !ad) return null;
  return (
    <div className="tap-scale" onClick={() => handleAdClick(ad)} style={{
      background: '#fff', borderRadius: 18, border: `1px solid ${COLORS.border}`,
      padding: `${SPACE.md}px ${SPACE.lg}px`, display: 'flex', alignItems: 'center', gap: SPACE.md,
      position: 'relative', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', cursor: 'pointer', ...extraStyle,
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
      <button onClick={(e) => { e.stopPropagation(); setDismissed(true); }} style={{
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
  useEffect(() => { if (ad && !isPremium && !dismissed) trackAdEvent(ad.id, 'impression', ad._slot, ad._variant); }, [ad, isPremium, dismissed]);
  if (isPremium || dismissed || !ad) return null;
  return (
    <div style={{
      background: '#fff', borderRadius: 20, border: `1px solid ${COLORS.border}`,
      overflow: 'hidden', position: 'relative',
      boxShadow: '0 2px 10px rgba(0,0,0,0.04)', cursor: 'pointer', ...extraStyle,
    }} onClick={() => handleAdClick(ad)}>
      <button onClick={(e) => { e.stopPropagation(); setDismissed(true); }} style={{
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
        <button className="tap-scale" onClick={(e) => { e.stopPropagation(); handleAdClick(ad); }} style={{
          background: `linear-gradient(135deg, ${ad.color}, ${ad.color}cc)`,
          color: '#fff', border: 'none', borderRadius: 12, padding: '10px 24px',
          fontWeight: 700, fontSize: FONT.base, cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: `0 2px 8px ${ad.color}22`,
        }}>{ad.cta}</button>
      </div>
    </div>
  );
}

function ShortsAd({ ad, cardHeight }) {
  const { isPremium } = usePremium();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { if (ad && !isPremium && !dismissed) trackAdEvent(ad.id, 'impression', ad._slot, ad._variant); }, [ad, isPremium, dismissed]);
  if (isPremium || dismissed || !ad) return null;
  return (
    <div style={{
      height: cardHeight, minHeight: 500,
      background: `linear-gradient(160deg, ${ad.color}ee, ${ad.color}88)`,
      position: 'relative', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      scrollSnapAlign: 'start', flexShrink: 0, overflow: 'hidden',
    }}>
      {/* 背景装飾 */}
      <div style={{
        position: 'absolute', top: -60, right: -60, width: 200, height: 200,
        borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
      }} />
      <div style={{
        position: 'absolute', bottom: -40, left: -40, width: 160, height: 160,
        borderRadius: '50%', background: 'rgba(255,255,255,0.04)',
      }} />
      <span style={{
        position: 'absolute', top: 52, left: 16,
        background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
        padding: '4px 12px', borderRadius: 8,
        color: 'rgba(255,255,255,0.8)', fontSize: FONT.xs, fontWeight: 700,
        letterSpacing: 1,
      }}>PR</span>
      <button onClick={() => setDismissed(true)} style={{
        position: 'absolute', top: 48, right: 16, background: 'rgba(255,255,255,0.1)',
        backdropFilter: 'blur(8px)',
        border: 'none', borderRadius: '50%', width: 40, height: 40,
        color: 'rgba(255,255,255,0.7)', fontSize: 18, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.2s',
      }}>✕</button>
      <div style={{ fontSize: 72, marginBottom: SPACE.xl, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.15))' }}>{ad.emoji}</div>
      <div style={{ color: '#fff', fontWeight: 900, fontSize: 26, marginBottom: 10, textAlign: 'center', textShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
        {ad.brand}
      </div>
      <div style={{
        color: 'rgba(255,255,255,0.9)', fontSize: FONT.base, textAlign: 'center',
        maxWidth: 280, lineHeight: 1.7, marginBottom: SPACE.md,
      }}>{ad.desc}</div>
      <div style={{
        color: 'rgba(255,255,255,0.55)', fontSize: FONT.sm, marginBottom: SPACE.xxl, textAlign: 'center',
      }}>{ad.tagline}</div>
      <button className="tap-scale" onClick={() => handleAdClick(ad)} style={{
        background: '#fff', color: ad.color, border: 'none',
        borderRadius: 50, padding: '16px 52px', fontWeight: 900, fontSize: FONT.lg,
        cursor: 'pointer', fontFamily: 'inherit',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        transition: 'transform 0.2s ease-out, box-shadow 0.2s',
      }}>{ad.cta}</button>
    </div>
  );
}

// ---------- Supabase 動画取得 ----------
const SHORTS_PAGE_SIZE = 20;

async function fetchVideosPage(pageNum) {
  try {
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .order('created_at', { ascending: false })
      .range(pageNum * SHORTS_PAGE_SIZE, (pageNum + 1) * SHORTS_PAGE_SIZE - 1);
    if (error) {
      console.error('fetchVideosPage error:', error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('fetchVideosPage exception:', e);
    return [];
  }
}

const STAGE_DISPLAY = {
  '初期': '初期 5-6ヶ月', 'ゴックン期': '初期 5-6ヶ月',
  '中期': '中期 7-8ヶ月', 'モグモグ期': '中期 7-8ヶ月',
  '後期': '後期 9-11ヶ月', 'カミカミ期': '後期 9-11ヶ月',
  '完了期': '完了期 12-18ヶ月', 'パクパク期': '完了期 12-18ヶ月',
};

function VideoCard({ item, cardHeight, isVisible, isActive }) {
  // 3 states: 'thumbnail' | 'playing' | 'error'
  const [playState, setPlayState] = useState('thumbnail');
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
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
          background: 'rgba(0,0,0,0.6)',
        }}>
          <span style={{ fontSize: 48, marginBottom: 12 }}>⚠️</span>
          <span style={{ color: '#fff', fontSize: FONT.base, fontWeight: 700 }}>
            再生できません
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setPlayState('thumbnail'); }}
            style={{
              marginTop: 12, background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.3)', borderRadius: 20,
              padding: '8px 24px', color: '#fff', fontSize: FONT.sm,
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
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
          onClick={(e) => { e.stopPropagation(); setSaved(!saved); }}
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
  const [page, setPage] = useState(videosCache.page);
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
      const data = await fetchVideosPage(0);
      if (cancelled) return;
      if (data.length > 0) {
        setVideos(data);
        setPage(1);
        setHasMore(data.length >= SHORTS_PAGE_SIZE);
        videosCache.data = data;
        videosCache.page = 1;
        videosCache.hasMore = data.length >= SHORTS_PAGE_SIZE;
      } else {
        setVideos(FALLBACK_VIDEOS);
        setHasMore(false);
        videosCache.data = FALLBACK_VIDEOS;
        videosCache.page = 0;
        videosCache.hasMore = false;
      }
      setLoading(false);
    }
    loadInitial();
    return () => { cancelled = true; };
  }, []);

  // 追加ページ読み込み
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    const data = await fetchVideosPage(page);
    if (data.length > 0) {
      setVideos(prev => {
        const updated = [...prev, ...data];
        videosCache.data = updated;
        return updated;
      });
      setPage(prev => {
        videosCache.page = prev + 1;
        return prev + 1;
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
  }, [page, hasMore]);

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

  // 広告挿入した表示リスト構築
  const displayItems = useMemo(() => {
    const items = [];
    videos.forEach((item, i) => {
      items.push({ type: 'video', data: item });
      if ((i + 1) % 4 === 0) {
        items.push({ type: 'ad', data: getAd(Math.floor(i / 4)) });
      }
    });
    return items;
  }, [videos]);

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
          height: cardHeight,
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {displayItems.map((entry, i) => (
          <div key={`${entry.type}-${entry.data?.id || entry.data?.youtube_id || i}`} data-index={i}>
            {entry.type === 'video' ? (
              <VideoCard
                item={entry.data}
                cardHeight={cardHeight}
                isVisible={Math.abs(i - currentIndex) <= 2}
                isActive={i === currentIndex}
              />
            ) : (
              <ShortsAd ad={entry.data} cardHeight={cardHeight} />
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

// ---------- 広告パフォーマンスパネル ----------
function AdAnalyticsPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('overview'); // 'overview' | 'abtest'
  const [stats, setStats] = useState(null);
  const [abResults, setAbResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadStats = async () => {
    if (stats) { setOpen(!open); return; }
    setOpen(true);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ad_analytics')
        .select('ad_id, event_type, slot, variant');
      if (error) { console.error('ad_analytics query error:', error); setLoading(false); return; }

      // --- 広告別集計 ---
      const map = {};
      (data || []).forEach(row => {
        if (!map[row.ad_id]) map[row.ad_id] = { impressions: 0, clicks: 0 };
        if (row.event_type === 'impression') map[row.ad_id].impressions++;
        if (row.event_type === 'click') map[row.ad_id].clicks++;
      });

      const result = AD_BANNERS.map(ad => ({
        id: ad.id, brand: ad.brand, emoji: ad.emoji,
        impressions: map[ad.id]?.impressions || 0,
        clicks: map[ad.id]?.clicks || 0,
        ctr: map[ad.id]?.impressions > 0
          ? ((map[ad.id].clicks / map[ad.id].impressions) * 100).toFixed(1) : '0.0',
      })).sort((a, b) => parseFloat(b.ctr) - parseFloat(a.ctr));
      setStats(result);

      // --- A/Bテスト集計 ---
      const abMap = {}; // { slot: { A: {adId, imp, click}, B: {adId, imp, click} } }
      (data || []).forEach(row => {
        if (!row.slot || !row.variant) return;
        if (!abMap[row.slot]) abMap[row.slot] = {};
        if (!abMap[row.slot][row.variant]) abMap[row.slot][row.variant] = { adId: row.ad_id, impressions: 0, clicks: 0 };
        abMap[row.slot][row.variant].adId = row.ad_id;
        if (row.event_type === 'impression') abMap[row.slot][row.variant].impressions++;
        if (row.event_type === 'click') abMap[row.slot][row.variant].clicks++;
      });

      const abRows = AB_TESTS.map(test => {
        const a = abMap[test.slot]?.A || { adId: test.adA, impressions: 0, clicks: 0 };
        const b = abMap[test.slot]?.B || { adId: test.adB, impressions: 0, clicks: 0 };
        const ctrA = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
        const ctrB = b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0;
        const winner = (a.impressions + b.impressions) < 10 ? null : ctrA > ctrB ? 'A' : ctrB > ctrA ? 'B' : null;
        return {
          slot: test.slot,
          adA: adById[test.adA], adB: adById[test.adB],
          a: { ...a, ctr: ctrA.toFixed(1) },
          b: { ...b, ctr: ctrB.toFixed(1) },
          winner,
        };
      });
      setAbResults(abRows);
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
              {/* タブ切替 */}
              <div style={{ display: 'flex', gap: SPACE.xs, marginBottom: SPACE.md }}>
                {[{ key: 'overview', label: '全体' }, { key: 'abtest', label: 'A/Bテスト' }].map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)} style={{
                    flex: 1, padding: `${SPACE.sm}px`, borderRadius: 10,
                    border: `1.5px solid ${tab === t.key ? COLORS.primary : COLORS.border}`,
                    background: tab === t.key ? `${COLORS.primary}10` : '#fff',
                    color: tab === t.key ? COLORS.primary : COLORS.textLight,
                    fontWeight: 700, fontSize: FONT.sm, cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.2s',
                  }}>{t.label}</button>
                ))}
              </div>

              {tab === 'overview' && (
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
                          {row.emoji} {row.brand}
                        </span>
                        <span style={{ textAlign: 'right', fontSize: FONT.sm, color: COLORS.textLight }}>{row.impressions}</span>
                        <span style={{ textAlign: 'right', fontSize: FONT.sm, color: COLORS.textLight }}>{row.clicks}</span>
                        <span style={{ textAlign: 'right', fontSize: FONT.sm, fontWeight: 700, color: ctrColor(row.ctr) }}>{row.ctr}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {tab === 'abtest' && abResults && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
                  {abResults.map(test => (
                    <div key={test.slot} style={{
                      borderRadius: 14, border: `1px solid ${COLORS.border}`,
                      overflow: 'hidden',
                    }}>
                      {/* スロットヘッダー */}
                      <div style={{
                        background: COLORS.bg, padding: `${SPACE.sm}px ${SPACE.md}px`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <span style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.text }}>
                          {test.slot}
                        </span>
                        {test.winner && (
                          <span style={{
                            fontSize: FONT.xs, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                            background: test.winner === 'A' ? '#4CAF5020' : '#2196F320',
                            color: test.winner === 'A' ? '#4CAF50' : '#2196F3',
                          }}>
                            {test.winner} が優勢
                          </span>
                        )}
                        {!test.winner && (test.a.impressions + test.b.impressions) < 10 && (
                          <span style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>
                            データ不足
                          </span>
                        )}
                      </div>

                      {/* A vs B 比較 */}
                      {[
                        { label: 'A', data: test.a, ad: test.adA, isWinner: test.winner === 'A' },
                        { label: 'B', data: test.b, ad: test.adB, isWinner: test.winner === 'B' },
                      ].map(v => (
                        <div key={v.label} style={{
                          padding: `${SPACE.sm}px ${SPACE.md}px`,
                          borderTop: `1px solid ${COLORS.border}`,
                          display: 'flex', alignItems: 'center', gap: SPACE.sm,
                          background: v.isWinner ? (v.label === 'A' ? '#4CAF5008' : '#2196F308') : '#fff',
                        }}>
                          <span style={{
                            width: 24, height: 24, borderRadius: 6,
                            background: v.label === 'A' ? '#4CAF5018' : '#2196F318',
                            color: v.label === 'A' ? '#4CAF50' : '#2196F3',
                            fontSize: FONT.xs, fontWeight: 900,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>{v.label}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: FONT.sm, fontWeight: 600, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {v.ad?.emoji} {v.ad?.brand}
                            </div>
                            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 1 }}>
                              {v.data.impressions} 表示 / {v.data.clicks} Click
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: FONT.base, fontWeight: 900, color: ctrColor(v.data.ctr) }}>
                              {v.data.ctr}%
                            </div>
                            {/* CTR バー */}
                            <div style={{ width: 50, height: 4, borderRadius: 2, background: COLORS.border, marginTop: 3 }}>
                              <div style={{
                                width: `${Math.min(parseFloat(v.data.ctr) * 10, 100)}%`,
                                height: '100%', borderRadius: 2,
                                background: v.label === 'A' ? '#4CAF50' : '#2196F3',
                              }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
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
function SettingsTab() {
  const { isPremium, togglePremium, setShowPaywall, setPaywallReason, searchCount, recipeGenCount, commentCount } = usePremium();
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
    <div className="fade-in">
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
// ============================================================
const PROTECTED_TABS = ['share', 'recipe', 'settings'];

function App() {
  const { loading, authScreen, setAuthScreen, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState('home');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayedTab, setDisplayedTab] = useState('home');

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

        {/* Paywallモーダル */}
        <PaywallModal />
      </div>
    </PremiumProvider>
  );
}

function AppRoot() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}

export default AppRoot;
