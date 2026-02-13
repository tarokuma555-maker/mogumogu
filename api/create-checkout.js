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

    // 既存の Stripe Customer を検索、なければ作成
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    let customerId = existingSub?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
    }

    // Checkout Session 作成（7日間無料トライアル付き）
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
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: error.message });
  }
};
