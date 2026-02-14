const { supabase } = require('./_lib/auth');

module.exports = async (req, res) => {
  const base = 'https://mogumogu-omega.vercel.app';

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('slug, updated_at')
    .eq('published', true)
    .order('created_at', { ascending: false });

  const staticPages = [
    { url: '/', priority: '1.0', freq: 'daily' },
    { url: '/blog', priority: '0.8', freq: 'weekly' },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticPages.map((p) => `  <url>
    <loc>${base}${p.url}</loc>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
${(posts || []).map((p) => `  <url>
    <loc>${base}/blog/${p.slug}</loc>
    <lastmod>${new Date(p.updated_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, s-maxage=86400');
  res.send(xml);
};
