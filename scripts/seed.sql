-- 仅供本地演示的虚构菜单，不代表西南交通大学真实店铺、菜品或价格。
-- 不自动导入。先执行迁移，再手动运行 npm run db:seed。
-- 保留少量旧分类数据，用于验证 V1.1.1 的兼容映射与历史值保留。
INSERT INTO areas (id, name, type, sort_order, enabled, created_at, updated_at)
VALUES ('demo-area', '示例食堂（虚构）', 'canteen', 0, 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z');

INSERT INTO restaurants (id, area_id, name, category, location, enabled, created_at, updated_at)
VALUES ('demo-noodles', 'demo-area', '示例面食窗口', '粉面 / 面食', '演示位置', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-rice', 'demo-area', '示例米饭窗口', '快餐 / 盖饭', '演示位置', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-burger', 'demo-area', '示例汉堡窗口', '汉堡 / 炸鸡', '演示位置', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-hotpot', 'demo-area', '示例串串窗口', '火锅 / 串串', '演示位置', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-snack', 'demo-area', '示例小吃窗口', '小吃 / 轻食', '演示位置', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z');

INSERT INTO dishes (id, restaurant_id, name, category, price_cents, weight, notes, enabled, created_at, updated_at)
VALUES ('demo-beef-noodles', 'demo-noodles', '示例牛肉面', '粉面 / 米线', 1500, 1, '虚构演示菜品', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-egg-noodles', 'demo-noodles', '示例鸡蛋面', '粉面 / 米线', 1000, 1, '虚构演示菜品', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-legacy-noodle', 'demo-noodles', '示例旧式汤面', '面食', 1100, 1, '旧分类兼容示例', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-rice-dish', 'demo-rice', '示例盖饭', '米饭 / 套餐', 1200, 1, '虚构演示菜品', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-legacy-rice-dish', 'demo-rice', '示例旧盖饭', '米饭 / 盖饭', 1250, 1, '旧分类映射示例', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-burger-dish', 'demo-burger', '示例汉堡套餐', '汉堡 / 炸鸡', 1800, 1, '虚构演示菜品', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-hotpot-dish', 'demo-hotpot', '示例麻辣烫', '火锅 / 麻辣烫', 1600, 1, '旧店铺分类映射示例', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-snack-dish', 'demo-snack', '示例小笼包', '饺馄 / 面点', 900, 1, '旧小吃分类待重新归类示例', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z');
