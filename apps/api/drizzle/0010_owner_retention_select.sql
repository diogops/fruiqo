-- Complemento da 0009: um DELETE com WHERE também aplica as policies de SELECT às linhas
-- que lê. Sem esta policy, a purga (SECURITY DEFINER, owner não superusuário) continuava
-- sem enxergar linhas de recommendation_runs.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY recommendation_runs_definer_retention_read ON recommendation_runs FOR SELECT TO %I USING (true)',
    current_user
  );
END $$;
