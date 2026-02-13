const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===== action=check: サブスクリプション状態確認 =====
async function handleCheck(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // subscriptions テーブルを確認
  let sub = null;
  try {
    const { data } = await supabase
      .from('subscriptions')
      .select('status, plan, trial_end, current_period_end, cancel_at_period_end')
      .eq('user_id', user.id)
      .single();
    sub = data;
  } catch (e) {
    console.error('check-subscription: subscriptions query failed:', e.message);
  }

  if (sub) {
    const isPremium = sub.status === 'active' || sub.status === 'trialing';
    return res.status(200).json({ isPremium, subscription: sub });
  }

  // フォールバック: users テーブル
  let profile = null;
  try {
    const { data } = await supabase
      .from('users')
      .select('is_premium')
      .eq('id', user.id)
      .single();
    profile = data;
  } catch (e) {
    console.error('check-subscription: users query failed:', e.message);
  }

  return res.status(200).json({
    isPremium: profile?.is_premium === true,
    subscription: null,
  });
}

// ===== action=verify: チェックアウトセッション検証 =====
async function handleVerify(req, res) {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription'],
  });

  if (session.status !== 'complete') {
    return res.status(200).json({ isPremium: false, reason: 'session_not_complete' });
  }

  const sub = session.subscription;
  if (!sub || typeof sub === 'string') {
    return res.status(200).json({ isPremium: false, reason: 'no_subscription' });
  }

  const userId = sub.metadata?.supabase_user_id;
  if (!userId) {
    return res.status(200).json({ isPremium: false, reason: 'no_user_id' });
  }

  let plan = 'free';
  const priceId = sub.items.data[0]?.price?.id;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) plan = 'premium_monthly';
  if (priceId === process.env.STRIPE_PRICE_YEARLY) plan = 'premium_yearly';

  const isActive = ['active', 'trialing'].includes(sub.status);

  try {
    await supabase.from('subscriptions').upsert({
      user_id: userId,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      plan,
      status: sub.status,
      trial_start: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
      trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch (e) {
    console.error('verify-checkout: subscriptions upsert failed:', e.message);
  }

  try {
    await supabase.from('users').update({
      is_premium: isActive,
      stripe_customer_id: sub.customer,
    }).eq('id', userId);
  } catch (e) {
    console.error('verify-checkout: users update failed:', e.message);
  }

  return res.status(200).json({
    isPremium: isActive,
    subscription: {
      status: sub.status, plan,
      trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      cancel_at_period_end: sub.cancel_at_period_end,
    },
  });
}

// ===== デフォルト: チェックアウトセッション作成 =====
async function handleCreate(req, res) {
  const { userId, email, plan } = req.body;

  if (!userId || !email || !plan) {
    return res.status(400).json({ error: 'userId, email, plan are required' });
  }

  const priceId = plan === 'yearly'
    ? process.env.STRIPE_PRICE_YEARLY
    : process.env.STRIPE_PRICE_MONTHLY;

  if (!priceId) {
    return res.status(500).json({ error: 'Price ID not configured' });
  }

  let customerId = null;

  try {
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();
    customerId = existingSub?.stripe_customer_id || null;
  } catch (e) {
    console.error('create-checkout: subscriptions query failed:', e.message);
  }

  if (!customerId) {
    try {
      const { data: userRow } = await supabase
        .from('users')
        .select('stripe_customer_id')
        .eq('id', userId)
        .single();
      customerId = userRow?.stripe_customer_id || null;
    } catch (e) {
      console.error('create-checkout: users query failed:', e.message);
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { supabase_user_id: userId },
    });
    customerId = customer.id;
  }

  const origin = req.headers.origin || 'https://mogumogu-omega.vercel.app';

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    subscription_data: {
      trial_period_days: 7,
      metadata: { supabase_user_id: userId },
    },
    success_url: `${origin}/?premium=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?premium=cancel`,
    allow_promotion_codes: true,
  });

  res.status(200).json({ url: session.url });
}

// ===== メインハンドラ =====
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const action = req.query.action || 'create';
    switch (action) {
      case 'check': return await handleCheck(req, res);
      case 'verify': return await handleVerify(req, res);
      default: return await handleCreate(req, res);
    }
  } catch (err) {
    console.error('create-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
};
