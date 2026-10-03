-- Existing databases: give the built-in Branch Manager role the finance rights it now has by default.
-- (Same as the SQLite migration of the same name.)
INSERT INTO role_permissions (role_id, permission_key, field_rules)
SELECT r.id, p.key, NULL
FROM roles r
JOIN permissions p ON p.key IN ('finance.expense.delete', 'finance.expense.export', 'finance.ledger.create')
WHERE r.code = 'branch_manager' AND r.is_system = true
ON CONFLICT DO NOTHING;
