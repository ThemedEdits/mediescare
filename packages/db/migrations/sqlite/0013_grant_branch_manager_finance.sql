-- Existing databases: give the built-in Branch Manager role the finance rights it now has by default:
-- void expenses, export expenses, and make cash book entries (opening balance, corrections).
-- New databases already get them from the role definition. Safe to run twice, and it never touches a
-- custom role or a role the owner has already changed (it only adds the three rows).
INSERT OR IGNORE INTO role_permissions (role_id, permission_key, field_rules)
SELECT r.id, p.key, NULL
FROM roles r
JOIN permissions p ON p.key IN ('finance.expense.delete', 'finance.expense.export', 'finance.ledger.create')
WHERE r.code = 'branch_manager' AND r.is_system = 1;
