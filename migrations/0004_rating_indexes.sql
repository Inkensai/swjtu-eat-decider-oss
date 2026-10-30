-- Personal ratings use identity alone, without either partial-index predicate.
CREATE INDEX ratings_identity ON ratings(identity_hash);

-- Stable keyset pagination for all ratings and common target filters.
CREATE INDEX ratings_updated_id ON ratings(updated_at DESC, id DESC);
CREATE INDEX ratings_type_updated_id ON ratings(target_type, updated_at DESC, id DESC);
CREATE INDEX ratings_restaurant_updated_id ON ratings(restaurant_id, updated_at DESC, id DESC);
CREATE INDEX ratings_dish_updated_id ON ratings(dish_id, updated_at DESC, id DESC);
