const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    // Stripe Checkout Session を取得（subscription を展開）
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

    // プランを判定
    let plan = 'free';
    const priceId = sub.items.data[0]?.price?.id;
    if (priceId === process.env.STRIPE_PRICE_MONTHLY) plan = 'premium_monthly';
    if (priceId === process.env.STRIPE_PRICE_YEARLY) plan = 'premium_yearly';

    const isActive = ['active', 'trialing'].includes(sub.status);

    // DB 更新（テーブルが無くても失敗しない）
    try {
      await supabase.from('subscriptions').upsert({
        user_id: userId,
        stripe_customer_id: sub.customer,
        stripe_subscription_id: sub.id,
        plan: plan,
        status: sub.status,
        trial_start: sub.trial_start
          ? new Date(sub.trial_start * 1000).toISOString()
          : null,
        trial_end: sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : null,
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

    // Stripe データに基づいて常に結果を返す（DB 成否に関係なく）
    return res.status(200).json({
      isPremium: isActive,
      subscription: {
        status: sub.status,
        plan,
        trial_end: sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : null,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        cancel_at_period_end: sub.cancel_at_period_end,
      },
    });
  } catch (err) {
    console.error('verify-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
};
