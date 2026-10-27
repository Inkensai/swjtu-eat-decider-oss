PRAGMA foreign_keys = ON;

CREATE TABLE areas (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('canteen', 'nearby', 'other')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE restaurants (
  id TEXT PRIMARY KEY NOT NULL,
  area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  category TEXT NOT NULL DEFAULT '' CHECK (length(category) <= 60),
  location TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 300),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dishes (
  id TEXT PRIMARY KEY NOT NULL,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  category TEXT NOT NULL DEFAULT '' CHECK (length(category) <= 60),
  price_cents INTEGER NOT NULL CHECK (typeof(price_cents) = 'integer' AND price_cents BETWEEN 0 AND 100000000),
  weight REAL NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0 AND 1000000),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX restaurants_area ON restaurants(area_id);
CREATE INDEX dishes_restaurant ON dishes(restaurant_id);
CREATE INDEX dishes_category ON dishes(category);
