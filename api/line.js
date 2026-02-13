const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 本番ドメインを固定（VERCEL_URL はデプロイ固有URLなので使わない）
const APP_URL = process.env.APP_URL || 'https://mogumogu-omega.vercel.app';

// ===== Cookie パーサー =====
function parseCookies(cookieStr) {
  const cookies = {};
  (cookieStr || '').split(';').forEach(cookie => {
    const [key, val] = cookie.trim().split('=');
    if (key) cookies[key] = val;
  });
  return cookies;
}

// ===== GET: LINEログイン開始 & コールバック =====
async function handleGet(req, res) {
  const { code, state } = req.query;

  // code がある → LINE からのコールバック
  if (code) {
    return handleCallback(req, res, code, state);
  }

  // code がない → ログイン開始（LINE にリダイレクト）
  return handleLoginStart(req, res);
}

// ----- ログイン開始 -----
function handleLoginStart(req, res) {
  const channelId = process.env.LINE_CHANNEL_ID;
  const redirectUri = process.env.LINE_REDIRECT_URI || `${APP_URL}/api/line`;

  if (!channelId) {
    return res.status(500).json({ error: 'LINE_CHANNEL_ID is not configured' });
  }

  const stateVal = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', channelId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', stateVal);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('scope', 'profile openid email');
  authUrl.searchParams.set('bot_prompt', 'aggressive');

  res.setHeader('Set-Cookie', [
    `line_state=${stateVal}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    `line_nonce=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  ]);

  res.redirect(302, authUrl.toString());
}

// ----- コールバック -----
async function handleCallback(req, res, code, state) {
  const cookies = parseCookies(req.headers.cookie);
  if (state !== cookies.line_state) {
    return res.redirect(302, `${APP_URL}?login=error&reason=invalid_state`);
  }

  const channelId = process.env.LINE_CHANNEL_ID;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const redirectUri = process.env.LINE_REDIRECT_URI || `${APP_URL}/api/line`;

  try {
    // 1. 認証コードをアクセストークンに交換
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error('Failed to get access token');
    }

    // 2. LINE プロフィールを取得
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();

    // 3. ID トークンを検証して email を取得
    let email = null;
    if (tokenData.id_token) {
      const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          id_token: tokenData.id_token,
          client_id: channelId,
          nonce: cookies.line_nonce,
        }),
      });
      const verifyData = await verifyRes.json();
      email = verifyData.email || null;
    }

    // 4. Supabase でユーザーを作成または取得
    const lineUserId = profile.userId;
    const lineEmail = email || `line_${lineUserId}@line.user`;

    // 既存ユーザーを検索（line_user_id メタデータ or メール一致）
    const { data: existingUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = existingUsers?.users?.find(u =>
      u.user_metadata?.line_user_id === lineUserId ||
      u.email === lineEmail
    );

    let userId;

    if (existingUser) {
      userId = existingUser.id;
      // メタデータを更新
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...existingUser.user_metadata,
          line_user_id: lineUserId,
          display_name: profile.displayName,
          avatar_url: profile.pictureUrl,
          provider: 'line',
        },
      });
    } else {
      // 新規ユーザーを作成
      const password = crypto.randomBytes(32).toString('hex');
      const { data: newUser, error } = await supabase.auth.admin.createUser({
        email: lineEmail,
        password,
        email_confirm: true,
        user_metadata: {
          line_user_id: lineUserId,
          display_name: profile.displayName,
          avatar_url: profile.pictureUrl,
          provider: 'line',
        },
      });
      if (error) throw error;
      userId = newUser.user.id;
    }

    // 5. profiles/users テーブルに LINE 情報を保存
    try {
      await supabase.from('users').upsert({
        id: userId,
        nickname: profile.displayName,
        line_user_id: lineUserId,
        avatar_url: profile.pictureUrl,
      }, { onConflict: 'id', ignoreDuplicates: false });
    } catch (e) {
      console.error('users upsert error:', e.message);
    }

    // 6. マジックリンクを生成してセッションを作成
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: existingUser ? existingUser.email : lineEmail,
      options: { redirectTo: `${APP_URL}?login=success&provider=line` },
    });

    if (linkError) throw linkError;

    // 友だち追加をログ
    if (req.query.friendship_status_changed === 'true') {
      console.log(`New LINE friend: ${profile.displayName} (${lineUserId})`);
    }

    // Cookie をクリア
    res.setHeader('Set-Cookie', [
      'line_state=; Path=/; HttpOnly; Secure; Max-Age=0',
      'line_nonce=; Path=/; HttpOnly; Secure; Max-Age=0',
    ]);

    // マジックリンクの action_link にリダイレクト
    // Supabase がセッションを設定した後にアプリへリダイレクト
    const actionLink = linkData?.properties?.action_link;
    if (actionLink) {
      res.redirect(302, actionLink);
    } else {
      // フォールバック: 直接アプリにリダイレクト
      res.redirect(302, `${APP_URL}?login=success&provider=line`);
    }
  } catch (err) {
    console.error('LINE login error:', err);
    res.setHeader('Set-Cookie', [
      'line_state=; Path=/; HttpOnly; Secure; Max-Age=0',
      'line_nonce=; Path=/; HttpOnly; Secure; Max-Age=0',
    ]);
    res.redirect(302, `${APP_URL}?login=error&reason=${encodeURIComponent(err.message)}`);
  }
}

// ===== メインハンドラ（GET: ログイン認証のみ） =====
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('LINE auth error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
