# PostgreSQL Database Setup Guide

## 📋 Prerequisites

### 1. Install PostgreSQL

#### Windows:
```bash
# Option 1: Download from official site
# Visit: https://www.postgresql.org/download/windows/

# Option 2: Using Chocolatey
choco install postgresql

# Option 3: Using winget
winget install PostgreSQL.PostgreSQL
```

#### macOS:
```bash
# Using Homebrew
brew install postgresql
brew services start postgresql
```

#### Linux (Ubuntu/Debian):
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 2. Create Database and User

#### Connect to PostgreSQL:
```bash
# Windows (psql in PostgreSQL bin directory)
psql -U postgres

# macOS/Linux
sudo -u postgres psql
```

#### Create Database and User:
```sql
-- Create database
CREATE DATABASE supfile_db;

-- Create user (replace 'your_password' with secure password)
CREATE USER supfile_user WITH PASSWORD 'your_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE supfile_db TO supfile_user;

-- Exit
\q
```

### 3. Configure Environment Variables

#### Copy environment file:
```bash
cd SupFile-API-IBR/backend
cp .env.example .env
```

#### Edit .env file:
```env
# Database Configuration
DATABASE_URL="postgresql://supfile_user:your_password@localhost:5432/supfile_db"

# JWT Secret (generate secure random string)
JWT_SECRET="your-super-secret-jwt-key-here-min-32-chars"

# Firebase Configuration (optional for OAuth)
FIREBASE_PROJECT_ID="your-firebase-project-id"
FIREBASE_CLIENT_EMAIL="your-firebase-service-account-email"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"

# Email Configuration (optional)
RESEND_API_KEY="your-resend-api-key"
FROM_EMAIL="noreply@yourdomain.com"

# Server Configuration
NODE_ENV="development"
PORT=3000

# CORS Configuration
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:19006,exp://192.168.1.100:19000"
```

### 4. Install Dependencies and Setup Database

#### Install Node.js dependencies:
```bash
cd SupFile-API-IBR/backend
npm install
```

#### Generate Prisma Client:
```bash
npm run db:generate
```

#### Run Database Migrations:
```bash
npm run db:push
```

#### (Optional) Reset Database:
```bash
npm run db:reset
```

### 5. Start the Backend Server

#### Development mode:
```bash
npm run dev
```

#### Production mode:
```bash
npm start
```

## 🔧 Troubleshooting

### Connection Issues:

#### "Connection refused":
```bash
# Check if PostgreSQL is running
# Windows: Check Services for "postgresql-x64-XX"
# macOS/Linux: sudo systemctl status postgresql

# Start PostgreSQL if not running
# Windows: Start the service
# macOS/Linux: sudo systemctl start postgresql
```

#### "Authentication failed":
```bash
# Check database credentials in .env
# Test connection manually:
psql "postgresql://supfile_user:password@localhost:5432/supfile_db"
```

#### "Database does not exist":
```bash
# Connect to PostgreSQL and create database
psql -U postgres
CREATE DATABASE supfile_db;
```

### Migration Issues:

#### "Prisma client generation failed":
```bash
# Clear Prisma cache
npx prisma generate --force
```

#### "Migration failed":
```bash
# Reset and retry
npm run db:reset
npm run db:push
```

### Port Issues:

#### "Port 3000 already in use":
```bash
# Find process using port 3000
netstat -ano | findstr :3000

# Kill process (replace PID)
taskkill /PID <PID> /F

# Or change port in .env
PORT=3001
```

## 📱 Testing the Setup

### 1. Test Database Connection:
```bash
cd SupFile-API-IBR/backend
node -e "
import prisma from './lib/prisma.js';
prisma.\$connect().then(() => console.log('✅ DB Connected')).catch(console.error);
"
```

### 2. Test API Endpoints:
```bash
# Test health endpoint
curl http://localhost:3000

# Test auth endpoint
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","fullName":"Test User"}'
```

### 3. Test with Mobile App:
- Start the React Native app
- Check console for connection test results
- Try to register/login

## 🔒 Security Notes

### Database Security:
- Use strong password for database user
- Limit database user privileges to necessary operations
- Consider using connection pooling for production

### Environment Variables:
- Never commit .env file to version control
- Use different secrets for development/production
- Rotate JWT secrets regularly

### Network Security:
- Configure firewall to allow only necessary ports
- Use HTTPS in production
- Implement rate limiting (already included)

## 📚 Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

---

**Status**: 🔄 **Ready for Database Setup**
