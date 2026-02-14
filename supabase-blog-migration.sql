-- ============================================
-- MoguMogu ブログ機能: Supabase マイグレーション
-- Supabase ダッシュボード → SQL Editor で実行してください
-- ============================================

-- ブログ記事テーブル
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  keyword TEXT,
  category TEXT CHECK (category IN (
    'basic', 'recipe', 'stage', 'food', 'allergy', 'tips', 'goods'
  )),
  baby_stage TEXT,
  published BOOLEAN DEFAULT true,
  views_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: 誰でも閲覧可能（公開記事のみ）
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blog_posts_public_read" ON blog_posts
  FOR SELECT USING (published = true);

-- Service Role からの挿入・更新を許可（API用）
CREATE POLICY "blog_posts_service_write" ON blog_posts
  FOR ALL USING (true) WITH CHECK (true);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category);
CREATE INDEX IF NOT EXISTS idx_blog_posts_created ON blog_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(published);
