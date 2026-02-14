const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Vercel: rawBody を取得するために bodyParser を無効化
module.exports.config = { api: { bodyParser: false } };

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const subscription = event.data.object;

  try {
    switch (event.type) {
      // トライアル開始 or サブスク開始・更新
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const userId = subscription.metadata.supabase_user_id;
        if (!userId) break;

        let plan = 'free';
        const priceId = subscription.items.data[0]?.price?.id;
        if (priceId === process.env.STRIPE_PRICE_MONTHLY) plan = 'premium_monthly';
        if (priceId === process.env.STRIPE_PRICE_YEARLY) plan = 'premium_yearly';

        try {
          await supabase.from('subscriptions').upsert({
            user_id: userId,
            stripe_customer_id: subscription.customer,
            stripe_subscription_id: subscription.id,
            plan: plan,
            status: subscription.status,
            trial_start: subscription.trial_start
              ? new Date(subscription.trial_start * 1000).toISOString()
              : null,
            trial_end: subscription.trial_end
              ? new Date(subscription.trial_end * 1000).toISOString()
              : null,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        } catch (e) {
          console.error('webhook: subscriptions upsert failed:', e.message);
        }

        // users テーブルも同期
        const isActive = ['active', 'trialing'].includes(subscription.status);
        try {
          await supabase.from('users').update({
            is_premium: isActive,
            stripe_customer_id: subscription.customer,
          }).eq('id', userId);
        } catch (e) {
          console.error('webhook: users update failed:', e.message);
        }

        break;
      }

      // サブスク解約（期間終了後）
      case 'customer.subscription.deleted': {
        const userId = subscription.metadata.supabase_user_id;
        if (!userId) break;

        try {
          await supabase.from('subscriptions').upsert({
            user_id: userId,
            plan: 'free',
            status: 'expired',
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        } catch (e) {
          console.error('webhook: subscriptions upsert (delete) failed:', e.message);
        }

        try {
          await supabase.from('users').update({
            is_premium: false,
          }).eq('id', userId);
        } catch (e) {
          console.error('webhook: users update (delete) failed:', e.message);
        }

        break;
      }

      // 支払い失敗
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          try {
            const { data: subRow } = await supabase
              .from('subscriptions')
              .select('user_id')
              .eq('stripe_subscription_id', subId)
              .single();
            if (subRow) {
              await supabase.from('subscriptions').update({
                status: 'past_due',
                updated_at: new Date().toISOString(),
              }).eq('user_id', subRow.user_id);
            }
          } catch (e) {
            console.error('webhook: payment_failed handler error:', e.message);
          }
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(200).json({ received: true });
  }
};
