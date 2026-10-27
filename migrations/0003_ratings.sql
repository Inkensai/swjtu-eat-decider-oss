-- V1.2 匿名评分。
-- 店铺评分与菜品评分共用一张表，用 restaurant_id / dish_id 两列表达评分对象；
-- CHECK 保证二者恰有一个非空，因此店铺与菜品评分不会混淆，也无法用菜品 ID 冒充店铺 ID。
-- 外键 ON DELETE CASCADE 保证管理员删除店铺或菜品时不产生孤儿评分。

CREATE TABLE ratings (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('restaurant', 'dish')),
  restaurant_id TEXT REFERENCES restaurants(id) ON DELETE CASCADE,
  dish_id TEXT REFERENCES dishes(id) ON DELETE CASCADE,
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64),
  stars INTEGER NOT NULL CHECK (typeof(stars) = 'integer' AND stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (target_type = 'restaurant' AND restaurant_id IS NOT NULL AND dish_id IS NULL)
    OR (target_type = 'dish' AND dish_id IS NOT NULL AND restaurant_id IS NULL)
  )
);

-- 每个匿名身份对同一对象最多一条有效评分；重复提交走 UPSERT 更新原记录，
-- 唯一索引同时是并发重复提交的最终约束。
CREATE UNIQUE INDEX ratings_restaurant_identity ON ratings(identity_hash, restaurant_id) WHERE restaurant_id IS NOT NULL;
CREATE UNIQUE INDEX ratings_dish_identity ON ratings(identity_hash, dish_id) WHERE dish_id IS NOT NULL;
CREATE INDEX ratings_restaurant ON ratings(restaurant_id);
CREATE INDEX ratings_dish ON ratings(dish_id);

-- 匿名写请求的固定窗口限流（匿名身份与来源 IP 两个维度），不依赖前端存储。
CREATE TABLE rating_rate_limits (
  scope TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count BETWEEN 0 AND 100000)
);

CREATE INDEX rating_rate_limits_window ON rating_rate_limits(window_start);
