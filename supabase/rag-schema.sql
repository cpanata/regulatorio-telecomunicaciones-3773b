create extension if not exists vector with schema extensions;

create table if not exists public.rag_documents (
  id uuid primary key,
  title text not null,
  filename text not null,
  storage_path text not null unique,
  source_url text,
  published_at date,
  content_sha256 text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.rag_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.rag_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists rag_chunks_embedding_hnsw_idx
  on public.rag_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.rag_documents enable row level security;
alter table public.rag_chunks enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rag-documents', 'rag-documents', false, 5242880, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.ingest_rag_document(
  p_document_id uuid,
  p_title text,
  p_filename text,
  p_storage_path text,
  p_source_url text,
  p_published_at date,
  p_content_sha256 text,
  p_chunks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.rag_documents (
    id, title, filename, storage_path, source_url, published_at, content_sha256
  ) values (
    p_document_id, p_title, p_filename, p_storage_path, p_source_url, p_published_at, p_content_sha256
  );

  insert into public.rag_chunks (document_id, chunk_index, content, embedding)
  select
    p_document_id,
    (item->>'chunk_index')::integer,
    item->>'content',
    (item->'embedding')::text::extensions.vector(768)
  from jsonb_array_elements(p_chunks) as chunks(item);

  return p_document_id;
end;
$$;

create or replace function public.match_rag_chunks(
  p_query_embedding extensions.vector(768),
  p_match_threshold real default 0.45,
  p_match_count integer default 6
)
returns table (
  document_id uuid,
  title text,
  filename text,
  source_url text,
  published_at date,
  content text,
  similarity real
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    d.title,
    d.filename,
    d.source_url,
    d.published_at,
    c.content,
    (1 - (c.embedding OPERATOR(extensions.<=>) p_query_embedding))::real
  from public.rag_chunks as c
  join public.rag_documents as d on d.id = c.document_id
  where 1 - (c.embedding OPERATOR(extensions.<=>) p_query_embedding) >= p_match_threshold
  order by c.embedding OPERATOR(extensions.<=>) p_query_embedding
  limit least(greatest(p_match_count, 1), 8);
$$;

create table if not exists public.rag_chat_rate_limits (
  client_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (client_hash, window_start)
);

alter table public.rag_chat_rate_limits enable row level security;

create or replace function public.consume_rag_chat_rate_limit(
  p_client_hash text,
  p_max_requests integer default 20,
  p_window_seconds integer default 3600
)
returns table (allowed boolean, remaining integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_max_requests < 1 or p_max_requests > 100 or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit configuration';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rag_chat_rate_limits (client_hash, window_start, request_count)
  values (p_client_hash, v_window_start, 1)
  on conflict (client_hash, window_start)
  do update set request_count = public.rag_chat_rate_limits.request_count + 1
  returning request_count into v_count;

  delete from public.rag_chat_rate_limits
  where window_start < now() - interval '2 days';

  return query select
    v_count <= p_max_requests,
    greatest(p_max_requests - v_count, 0),
    v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on public.rag_documents, public.rag_chunks, public.rag_chat_rate_limits from public, anon, authenticated;
revoke all on function public.ingest_rag_document(uuid, text, text, text, text, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.match_rag_chunks(extensions.vector, real, integer) from public, anon, authenticated;
revoke all on function public.consume_rag_chat_rate_limit(text, integer, integer) from public, anon, authenticated;

grant all on public.rag_documents, public.rag_chunks, public.rag_chat_rate_limits to service_role;
grant execute on function public.ingest_rag_document(uuid, text, text, text, text, date, text, jsonb) to service_role;
grant execute on function public.match_rag_chunks(extensions.vector, real, integer) to service_role;
grant execute on function public.consume_rag_chat_rate_limit(text, integer, integer) to service_role;
