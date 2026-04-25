# BlockSpace EOI Leasing App

One-page **Expression of Interest (EOI)** property leasing app for **BlockSpace Technologies Ltd Leasing**.

This app collects applicant/KYC details (including **passport and NIN uploads**), lets the applicant select optional included items via checkboxes, and generates a **non-binding EOI PDF** which is emailed to:

- **Admin** (with PDF + uploads attached)
- **Client** (PDF-only auto-reply)

## Local development

Install dependencies:

```bash
npm install
```

Run locally with Netlify Functions:

```bash
npm run netlify:dev
```

- App: `http://localhost:8888`
- Functions: `/.netlify/functions/*` (proxied through `/api/*`)

## Environment variables

Set these in **Netlify environment variables** (or locally via `.env`):

- **Supabase (client)**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

- **Supabase (server / functions)**
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

- `RESEND_API_KEY`: your Resend API key
- `FROM_EMAIL`: a verified sender, e.g. `BlockSpace Leasing <leasing@yourdomain.com>`
- `ADMIN_EMAIL`: the admin inbox that receives all submissions

Optional (local testing):
- `DISABLE_EMAILS=true` to skip sending emails while still generating PDFs and returning a reference ID.

## Supabase setup

1. In Supabase SQL editor, paste and run:
   - `supabase/schema.sql`
2. In Supabase Auth:
   - Enable **Email + Password**
   - Create your admin user(s)
3. Copy keys/URL:
   - Project URL → `VITE_SUPABASE_URL` and `SUPABASE_URL`
   - Anon public key → `VITE_SUPABASE_ANON_KEY`
   - Service role key → `SUPABASE_SERVICE_ROLE_KEY` (server only)

## Admin UI

- Visit `/admin` and sign in using Supabase email/password.
- Update base rent + line items.
- Public EOI page (`/`) reflects changes immediately.

## Netlify deploy

1. Push the repo to GitHub.
2. Create a new Netlify site from the repo.
3. Build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
4. Add environment variables (Supabase + Resend).
5. Deploy.

## Config you’ll customize

- Estate agent list: `src/data/agents.ts`
- Base rent + line items: managed in Supabase via `/admin` (seed defaults are in `supabase/schema.sql`)

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
