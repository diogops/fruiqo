-- purge_expired_mood_runs() (0007) é SECURITY DEFINER: roda como a role dona das funções.
-- Com o owner NÃO superusuário (alinhamento local/Railway), o FORCE ROW LEVEL SECURITY vale
-- para ele, e a 0007 não criou a policy de retenção em recommendation_runs: a purga não
-- enxergava nenhuma linha e apagava zero, em silêncio (SEC-CTRL-50 quebrado).
-- Mesmo padrão da 0001 (users/shares/recommendations_definer_*): policy restrita à role
-- que roda a migração, e só DELETE, que é o que a purga faz.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY recommendation_runs_definer_retention ON recommendation_runs FOR DELETE TO %I USING (true)',
    current_user
  );
END $$;
