const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { supabase } = require('./_lib/auth');

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return res.status(400).json({ error: 'Missing signature or webhook secret' });
  }

  let event;
  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      // サブスクリプション作成・更新
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const status = subscription.status;

        // Stripe Customer → Supabase ユーザー検索
        const { data: userRow } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (userRow) {
          const isActive = ['active', 'trialing'].includes(status);
          const currentPeriodEnd = subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null;

          await supabase
            .from('users')
            .update({
              is_premium: isActive,
              premium_expires_at: currentPeriodEnd,
              stripe_subscription_id: subscription.id,
              premium_plan: subscription.items?.data?.[0]?.price?.recurring?.interval || null,
            })
            .eq('id', userRow.id);
        }
        break;
      }

      // サブスクリプション削除（解約完了）
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const { data: userRow } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (userRow) {
          await supabase
            .from('users')
            .update({
              is_premium: false,
              premium_expires_at: null,
              stripe_subscription_id: null,
              premium_plan: null,
            })
            .eq('id', userRow.id);
        }
        break;
      }

      // 支払い成功
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        if (invoice.billing_reason === 'subscription_create' || invoice.billing_reason === 'subscription_cycle') {
          const { data: userRow } = await supabase
            .from('users')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single();

          if (userRow) {
            await supabase
              .from('users')
              .update({ is_premium: true })
              .eq('id', userRow.id);
          }
        }
        break;
      }

      // 支払い失敗
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        const { data: userRow } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (userRow) {
          await supabase
            .from('users')
            .update({ is_premium: false })
            .eq('id', userRow.id);
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
