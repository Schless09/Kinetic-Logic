-- Platform admin enum: must run and commit before the value can be used in other objects.
-- See: https://www.postgresql.org/docs/current/sql-altertype.html (new enum value cannot be used in same transaction)
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'platform_admin';
