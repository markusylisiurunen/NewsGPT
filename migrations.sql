create table stories (
  story_id           bigserial primary key,
  story_publication  text not null,
  story_story_id     text not null,
  story_href         text not null,
  story_published_at timestamptz not null,
  story_updated_at   timestamptz not null,
  story_content      jsonb not null,

  unique (story_publication, story_story_id)
);

create table story_chunks (
  story_id bigint references stories (story_id) on delete cascade not null,

  story_chunk_id        bigserial primary key,
  story_chunk_version   int not null,
  story_chunk_index     int not null,
  story_chunk_content   jsonb not null,
  story_chunk_embedding vector(1536),

  unique (story_id, story_chunk_version, story_chunk_index)
);

create or replace function match_story_chunks (
  query_embedding vector(1536),
  similarity_threshold float,
  match_count int
)
returns table (
  id bigint,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    story_chunks.story_chunk_id as id,
    1 - (story_chunks.story_chunk_embedding <=> query_embedding) as similarity
  from story_chunks
  where 1 - (story_chunks.story_chunk_embedding <=> query_embedding) > similarity_threshold
  order by story_chunks.story_chunk_embedding <=> query_embedding
  limit match_count;
end;
$$;
