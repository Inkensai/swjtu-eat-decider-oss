-- Existing menus retain their previous behavior unless open-now filtering is enabled.
ALTER TABLE restaurants ADD COLUMN opening_hours TEXT NOT NULL DEFAULT '';
ALTER TABLE restaurants ADD COLUMN closed_today TEXT NOT NULL DEFAULT '';
ALTER TABLE dishes ADD COLUMN sold_out_on TEXT NOT NULL DEFAULT '';
