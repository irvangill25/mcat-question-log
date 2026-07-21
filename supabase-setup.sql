-- MCAT Question Log: database + private image storage
-- Run this entire file once in Supabase: SQL Editor -> New query -> Run.

create table if not exists public.questions (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.questions enable row level security;

drop policy if exists "Users can read their own questions" on public.questions;
create policy "Users can read their own questions"
on public.questions for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can create their own questions" on public.questions;
create policy "Users can create their own questions"
on public.questions for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own questions" on public.questions;
create policy "Users can update their own questions"
on public.questions for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own questions" on public.questions;
create policy "Users can delete their own questions"
on public.questions for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.questions to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('question-images', 'question-images', false, 10485760)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760;

drop policy if exists "Users can view their own question images" on storage.objects;
create policy "Users can view their own question images"
on storage.objects for select
to authenticated
using (
  bucket_id = 'question-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can upload their own question images" on storage.objects;
create policy "Users can upload their own question images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'question-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their own question images" on storage.objects;
create policy "Users can update their own question images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'question-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'question-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their own question images" on storage.objects;
create policy "Users can delete their own question images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'question-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
