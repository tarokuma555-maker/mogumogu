const crypto = require('crypto');

module.exports = async (req, res) => {
  // GET リクエスト（LINE の検証）にも 200 を返す
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(200).end();
  }

  // 署名検証
  const channelSecret = process.env.LINE_MESSAGING_CHANNEL_SECRET;

  if (channelSecret) {
    const signature = req.headers['x-line-signature'];
    const body = JSON.stringify(req.body);
    const hash = crypto
      .createHmac('SHA256', channelSecret)
      .update(body)
      .digest('base64');

    if (hash !== signature) {
      // 署名が合わなくても 200 を返す（LINE の仕様）
      console.error('Invalid signature');
      return res.status(200).end();
    }
  }

  const events = req.body?.events || [];

  for (const event of events) {
    const token = process.env.LINE_MESSAGING_CHANNEL_TOKEN;

    switch (event.type) {
      case 'follow':
        // 友だち追加時のウェルカムメッセージ
        if (token && event.replyToken) {
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
              ],
            }),
          });
        }
        break;

      case 'message':
        if (event.message?.type === 'text' && token && event.replyToken) {
          const text = event.message.text;
          let reply = 'メッセージありがとうございます😊\n\nアプリでレシピ検索やAI相談ができます👇\nhttps://mogumogu-omega.vercel.app';

          if (text.includes('レシピ')) {
            reply = '🍳 離乳食レシピはアプリで検索できます！\nhttps://mogumogu-omega.vercel.app';
          } else if (text.includes('相談')) {
            reply = '🤖 AI相談はアプリから！\nhttps://mogumogu-omega.vercel.app';
          }

          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              replyToken: event.replyToken,
              messages: [{ type: 'text', text: reply }],
            }),
          });
        }
        break;
    }
  }

  // 必ず 200 を返す（LINE の要件）
  res.status(200).json({ status: 'ok' });
};
