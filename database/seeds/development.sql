-- Fictional, local development data. No usable login credentials.
-- Re-running preserves existing sample records and user edits.
INSERT INTO users (id, email, display_name)
VALUES ('10000000-0000-4000-8000-000000000001', 'demo@example.invalid', 'Demo Explorer')
ON CONFLICT DO NOTHING;

INSERT INTO journal_entries (id, user_id, title, body)
SELECT '20000000-0000-4000-8000-000000000001', id, 'A small beginning',
  'Today I made time for a short walk and a moment of reflection.'
FROM users WHERE id = '10000000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;

INSERT INTO goals (id, user_id, title, description)
SELECT '30000000-0000-4000-8000-000000000001', id, 'Make time to reflect',
  'Write a few lines about my day three times this week.'
FROM users WHERE id = '10000000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;

INSERT INTO mood_entries (id, user_id, score, note, recorded_on)
SELECT '40000000-0000-4000-8000-000000000001', id, 4,
  'Feeling hopeful about taking the first step.', DATE '2026-01-01'
FROM users WHERE id = '10000000-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;

INSERT INTO motivation_quotes (content) VALUES
  ('Small steps still move you forward.'),
  ('You can begin again at your own pace.'),
  ('Make room for progress, not perfection.')
ON CONFLICT DO NOTHING;
