-- Advisor flagged log_deletion_audit()/restrict_staff_order_update() as
-- callable directly via PostgREST RPC (they're SECURITY DEFINER and public).
-- Calling a trigger function outside trigger context already fails at the
-- Postgres level ("trigger functions can only be called as triggers"), so
-- there's no real exploit path, but revoking direct EXECUTE closes the lint
-- explicitly. Does not affect the triggers themselves — trigger firing is
-- invoked by the engine as part of DML, not via EXECUTE privilege.
revoke execute on function public.log_deletion_audit() from anon, authenticated;
revoke execute on function public.restrict_staff_order_update() from anon, authenticated;
