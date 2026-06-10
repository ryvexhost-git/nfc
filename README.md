# NFC-RYV

Standalone NFC card wallet app with separate frontend and backend.

This project is generic and has no external brand content or assets.

## Structure

```text
backend/   Express API for cards, login, balance, and debits
frontend/  Vite React NFC web app
```

## Features

- White-label business settings
- Business name, logo URL, primary color, address, support phone/email
- Currency symbol and daily debit limit
- Card prefix configuration
- Admin login
- Card creation and activation/blocking
- Balance top-up screen
- Customer NFC card login
- Daily debit protection
- Transaction history
- CSV transaction export

## Local Setup

Install dependencies:

```bash
npm run install:all
```

Start the backend:

```bash
npm run dev:backend
```

Start the frontend:

```bash
npm run dev:frontend
```

Open:

```text
http://localhost:5173/TCB-8645
```

Admin:

```text
http://localhost:5173/admin
```

Demo card:

```text
Card: TCB-8645
Password: 1234
Starting balance: Rs.250
Daily debit limit: Rs.50
Admin username: admin
Admin password: admin123
```

## NFC URL Format

Write either format to an NFC card:

```text
https://your-subdomain.example.com/TCB-8645
https://your-subdomain.example.com/?card=TCB-8645
```

## Create Your Own Git Repo

When you are ready:

```bash
cd NFC-RYV
git init
git add .
git commit -m "Initial NFC-RYV app"
git branch -M main
git remote add origin <your-new-repo-url>
git push -u origin main
```

## Production Notes

The included backend uses a JSON file for easy setup and local testing. For production with real stored value cards, replace the JSON file with a managed database such as PostgreSQL, MySQL, Supabase, Neon, PlanetScale, or MongoDB.

Set a strong `JWT_SECRET` in production.

## Deployment

Frontend on Vercel:

```text
Root Directory: frontend
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

Before deploying the frontend, update `frontend/vercel.json` and replace:

```text
https://your-backend-domain.example.com
```

with your deployed backend URL.

Backend:

Deploy `backend/` to a Node hosting provider such as Render, Railway, Fly.io, or a VPS.

```text
Root Directory: backend
Start Command: npm start
Environment Variables: JWT_SECRET, DAILY_DEBIT_LIMIT, CORS_ORIGIN
```

Vercel serverless functions are not recommended for the current JSON-file backend because card balance updates need persistent storage.
