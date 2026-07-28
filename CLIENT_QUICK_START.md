# NaijaPOS Quick Start

## 1. Clone / open the project

Open a terminal in the repo root:

```powershell
cd C:\Users\DELL\Dev\pos
```

## 2. Install dependencies

```powershell
npm install
```

## 3. Configure the database

Create or confirm `.env` contains a valid MySQL URL, for example:

```env
DATABASE_URL="mysql://root:GrinDa@localhost:3306/naijapos"
```

## 4. Prepare database

```powershell
npm run db:generate
npm run db:push
npm run db:seed
```

## 5. Start servers

API server:

```powershell
npm run dev:api
```

Admin web app:

```powershell
npm run dev
```

## 6. Open the app

- Admin app: `http://127.0.0.1:5173`
- API health: `http://127.0.0.1:4000/health`

## Notes

- Start MySQL first.
- Run the API before opening the web app.
- If there is an error on startup, check that MySQL is running and `DATABASE_URL` is correct.

## Quick verification

- Load the web UI
- Confirm login and settings pages work
- Browse `Catalog`, `Branches`, `Inventory`, `Sales`, and `Settings`
