const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { supabase, verifyUser } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await verifyUser(req);
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: profile } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer found' });
    }

    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'https://mogumogu-omega.vercel.app';

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/?tab=settings`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('create-portal-session error:', err);
    return res.status(500).json({ error: err.message });
  }
};
