-- 仅供本地演示的虚构菜单，不代表西南交通大学真实店铺、菜品或价格。
-- 不自动导入。先执行迁移，再手动运行 npm run db:seed。
INSERT INTO areas (id, name, type, sort_order, enabled, created_at, updated_at)
VALUES ('demo-area', '示例食堂（虚构）', 'canteen', 0, 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z');

INSERT INTO restaurants (id, area_id, name, category, location, enabled, created_at, updated_at)
VALUES ('demo-noodles', 'demo-area', '示例面食窗口', '面食', '演示位置', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-rice', 'demo-area', '示例米饭窗口', '米饭', '演示位置', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z');

INSERT INTO dishes (id, restaurant_id, name, category, price_cents, weight, notes, enabled, created_at, updated_at)
VALUES ('demo-beef-noodles', 'demo-noodles', '示例牛肉面', '面食', 1500, 1, '虚构演示菜品', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-egg-noodles', 'demo-noodles', '示例鸡蛋面', '面食', 1000, 1, '虚构演示菜品', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z'),
       ('demo-rice-dish', 'demo-rice', '示例盖饭', '米饭', 1200, 1, '虚构演示菜品', 1, '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z');
