-- Run once with the owner on the existing AMR database. No telemetry is changed.
-- One atomic statement prevents inherited read grants exposing operator reasons.
DO $route_audit$
BEGIN
  CREATE TABLE IF NOT EXISTS public.amr_route_reviews (
    review_id varchar(32) PRIMARY KEY,
    owner_id varchar(32) NOT NULL,
    created_at_ms bigint NOT NULL,
    state varchar(32) NOT NULL,
    record text NOT NULL
  );
  REVOKE ALL ON TABLE public.amr_route_reviews FROM PUBLIC;
  -- These are the existing general sensor roles, not operator-audit readers.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='amr_reader') THEN
    REVOKE ALL ON TABLE public.amr_route_reviews FROM amr_reader;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='amr_worker') THEN
    REVOKE ALL ON TABLE public.amr_route_reviews FROM amr_worker;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='amr_route_coordinator') THEN
    -- No credential is generated and no connection is enabled by provisioning.
    CREATE ROLE amr_route_coordinator NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='amr_route_coordinator'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)) THEN
    RAISE EXCEPTION 'Review the existing route coordinator role before granting access';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
      WHERE r.rolname='amr_route_coordinator') THEN
    RAISE EXCEPTION 'Route coordinator must not be a member of other roles';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      WHERE r.rolname='amr_route_coordinator' AND m.member<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
    RAISE EXCEPTION 'Review other members of the route coordinator role before granting access';
  END IF;
  GRANT USAGE ON SCHEMA public TO amr_route_coordinator;
  REVOKE ALL ON TABLE public.amr_route_reviews FROM amr_route_coordinator;
  GRANT SELECT, INSERT, UPDATE ON TABLE public.amr_route_reviews TO amr_route_coordinator;
END
$route_audit$;
-- Login remains disabled for a newly provisioned role. The owner activates its
-- private login and stores the direct URL in Streamlit only when commissioning.
-- Never put the owner URL or the general sensor reader URL in vision_control.
