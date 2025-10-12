# Testing Authentication Endpoints

## Setup

1. Start Docker services:

```bash
docker-compose up
```

2. Start SvelteKit app:

```bash
cd apps/syr
pnpm dev
```

## Test Registration

```bash
curl -X POST http://localhost:5173/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "SecurePass123",
    "display_name": "Alice"
  }'
```

**Expected Response (201):**

```json
{
	"status": "success",
	"data": {
		"user": {
			"id": "...",
			"username": "alice",
			"did": "did:web:localhost:5173:users:alice",
			"role": "USER",
			"created_at": "...",
			"updated_at": "..."
		},
		"profile": {
			"id": "...",
			"user_id": "...",
			"display_name": "Alice",
			"created_at": "...",
			"updated_at": "..."
		},
		"token": "eyJ..."
	}
}
```

## Test Login

```bash
curl -X POST http://localhost:5173/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "SecurePass123"
  }'
```

**Expected Response (200):**

```json
{
  "status": "success",
  "data": {
    "user": { ... },
    "profile": { ... },
    "token": "eyJ..."
  }
}
```

## Test Logout

```bash
# Use the token from login/register
curl -X POST http://localhost:5173/api/auth/logout \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Expected Response (200):**

```json
{
	"status": "success",
	"data": {
		"message": "Logged out successfully"
	}
}
```

## Test Error Cases

### Duplicate Username

```bash
curl -X POST http://localhost:5173/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "SecurePass123",
    "display_name": "Alice Again"
  }'
```

**Expected Response (409):**

```json
{
	"status": "error",
	"error": {
		"code": "CONFLICT",
		"message": "Username already exists"
	}
}
```

### Invalid Credentials

```bash
curl -X POST http://localhost:5173/api/auth/login \
  -H "Content-Type": "application/json" \
  -d '{
    "username": "alice",
    "password": "WrongPassword"
  }'
```

**Expected Response (401):**

```json
{
	"status": "error",
	"error": {
		"code": "INVALID_CREDENTIALS",
		"message": "Invalid username or password"
	}
}
```

### Validation Error

```bash
curl -X POST http://localhost:5173/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "ab",
    "password": "weak",
    "display_name": "Test"
  }'
```

**Expected Response (400):**

```json
{
	"status": "error",
	"error": {
		"code": "VALIDATION_ERROR",
		"message": "Invalid input data"
	}
}
```

## Check Database with Surrealist

1. Open http://localhost:8091
2. Connect to: `ws://localhost:8000/rpc`
3. Namespace: `syr`
4. Database: `syr`
5. User: `root`
6. Password: `syr-dev-password`

**Query users:**

```sql
SELECT * FROM user;
```

**Query profiles:**

```sql
SELECT * FROM profile;
```

**Query sessions:**

```sql
SELECT * FROM session;
```
