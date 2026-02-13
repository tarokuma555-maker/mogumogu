const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APP_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://mogumogu-omega.vercel.app';

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

// ===== POST: LINE Webhook & メッセージ送信 =====
async function handlePost(req, res) {
  const signature = req.headers['x-line-signature'];

  if (signature) {
    return handleWebhook(req, res, signature);
  }
  return handlePushMessage(req, res);
}

// ----- Webhook（LINE からのイベント受信） -----
async function handleWebhook(req, res, signature) {
  const channelSecret = process.env.LINE_MESSAGING_CHANNEL_SECRET;
  if (!channelSecret) {
    return res.status(500).json({ error: 'LINE_MESSAGING_CHANNEL_SECRET not configured' });
  }

  // 署名検証
  const body = JSON.stringify(req.body);
  const hash = crypto.createHmac('SHA256', channelSecret).update(body).digest('base64');
  if (hash !== signature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const events = req.body.events || [];
  const token = process.env.LINE_MESSAGING_CHANNEL_TOKEN;

  for (const event of events) {
    switch (event.type) {
      case 'follow':
        console.log(`New LINE friend: ${event.source.userId}`);
        if (token) {
          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              replyToken: event.replyToken,
              messages: [
                {
                  type: 'text',
                  text: 'MoguMogu 🍼 へようこそ！\n\n離乳食のレシピや育児情報をお届けします。\n\nアプリはこちら👇\nhttps://mogumogu-omega.vercel.app',
                },
                {
                  type: 'text',
                  text: '📌 配信内容\n・毎日の離乳食レシピ\n・月齢別のおすすめ食材\n・離乳食のコツ\n\nお困りのことがあれば、いつでもメッセージしてくださいね😊',
                },
              ],
            }),
          });
        }
        break;

      case 'unfollow':
        console.log(`LINE unfollowed: ${event.source.userId}`);
        break;

      case 'message':
        if (event.message.type === 'text' && token) {
          const text = event.message.text;
          let replyText;

          if (text.includes('レシピ')) {
            replyText = '🍳 離乳食レシピはアプリで検索できます！\n\nhttps://mogumogu-omega.vercel.app\n\nAIに相談もできますよ😊';
          } else if (text.includes('相談') || text.includes('悩み')) {
            replyText = '🤖 離乳食の悩みはアプリのAI相談で聞いてみてください！\n\nhttps://mogumogu-omega.vercel.app\n\n24時間いつでも相談できます✨';
          } else {
            replyText = 'メッセージありがとうございます😊\n\nアプリでレシピ検索やAI相談ができます👇\nhttps://mogumogu-omega.vercel.app';
          }

          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              replyToken: event.replyToken,
              messages: [{ type: 'text', text: replyText }],
            }),
          });
        }
        break;
    }
  }

  res.status(200).json({ success: true });
}

// ----- メッセージ送信（アプリから LINE ユーザーに通知） -----
async function handlePushMessage(req, res) {
  const { lineUserId, message } = req.body;
  const token = process.env.LINE_MESSAGING_CHANNEL_TOKEN;

  if (!token || !lineUserId || !message) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text: message }],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(JSON.stringify(error));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('LINE push message error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ===== メインハンドラ =====
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('LINE API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
