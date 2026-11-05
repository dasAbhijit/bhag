# Bhag

Split bills with friends and family. Amounts in ₹.

- Design: [docs/DESIGN.md](docs/DESIGN.md)
- Live app: https://dasabhijit.github.io/bhag/

## Develop

```bash
cp .env.example .env.local   # add the Supabase anon key
npm install
npm run dev
npm test
```

Secrets: only the Supabase URL and the anon/publishable key are used in the browser. Never commit the service-role key.
