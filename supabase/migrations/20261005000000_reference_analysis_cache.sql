-- Caches Gemini reference analyses per YouTube video so repeat requests
-- skip the model call. Only the analyze-reference function (service role) reads it.
create table if not exists public.reference_analysis_cache (
  video_id text primary key,
  analysis jsonb not null,
  model text not null default '',
  created_at timestamptz not null default now()
);

alter table public.reference_analysis_cache enable row level security;
