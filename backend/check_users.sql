SELECT id, email, "fullName", is_active, email_verified, created_at 
FROM users 
ORDER BY created_at DESC 
LIMIT 5;
