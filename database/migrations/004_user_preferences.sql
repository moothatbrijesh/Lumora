-- Optional user-provided beliefs are never inferred. Personalization is off by default.
ALTER TABLE users ADD COLUMN faith text NOT NULL DEFAULT 'prefer_not_to_say'
  CHECK (faith IN ('prefer_not_to_say', 'hindu', 'sikh', 'muslim', 'christian', 'buddhist',
    'jewish', 'jain', 'spiritual', 'other', 'none'));
ALTER TABLE users ADD COLUMN faith_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT users_faith_opt_in
  CHECK (NOT faith_enabled OR faith <> 'prefer_not_to_say');
