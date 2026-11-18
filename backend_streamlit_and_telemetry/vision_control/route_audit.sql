-- Apply once with the database owner; runtime never creates or changes schema.
CREATE TABLE IF NOT EXISTS public.amr_route_reviews (
  review_id varchar(32) PRIMARY KEY,
  owner_id varchar(32) NOT NULL,
  created_at_ms bigint NOT NULL,
  state varchar(32) NOT NULL,
  record text NOT NULL
);
-- Grant SELECT, INSERT, UPDATE on this table to a dedicated route coordinator
-- role, then put its DIRECT PostgreSQL URL in [vision_control].audit_url.
-- Do not grant DELETE or use the public read-only dashboard role.
