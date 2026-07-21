# MCAT Question Log — Online Edition

A private React + Vite MCAT question-log application using Supabase for login, database storage, and private image storage. It is ready for Vercel deployment.

## You only need to do four things

1. Create a free Supabase project.
2. Run `supabase-setup.sql` in the Supabase SQL Editor.
3. Upload this project to a private GitHub repository and import that repository into Vercel.
4. Add these Vercel environment variables before deploying:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`

Both values are shown in Supabase under Project Settings / API.

## What is already built

- Email/password account creation and sign-in
- Row-level security: each user can access only their own records
- Cloud database saving for questions and passages
- Private Supabase Storage uploads for passage and explanation images
- Existing JSON backup import/export
- Shared passages across multiple questions
- Dashboard, question log, add/edit, and exam-style review screen
- Installable web-app manifest

## Local test (optional)

Copy `.env.example` to `.env.local`, paste your Supabase values, and run:

```bash
npm install
npm run dev
```

## Deploy settings

Vercel should detect Vite automatically.

- Build command: `npm run build`
- Output directory: `dist`

Never put a Supabase secret/service-role key in this frontend. Use only the project publishable key.
