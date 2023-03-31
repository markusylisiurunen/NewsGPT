import { Pool } from "pg";
import { z } from "zod";
import { NewsStory, NewsStoryChunk, NewsStoryContentBlock, PersistentDataSource } from "../types";

const StoryRow = z.object({
  story_id: z.string(),
  story_publication: z.string(),
  story_story_id: z.string(),
  story_href: z.string(),
  story_published_at: z.string().or(z.instanceof(Date)),
  story_updated_at: z.string().or(z.instanceof(Date)),
  story_content: z.array(NewsStoryContentBlock),
});
type StoryRow = z.infer<typeof StoryRow>;

const StoryChunkRow = z.object({
  story_id: z.string(),
  story_chunk_id: z.string(),
  story_chunk_version: z.number(),
  story_chunk_index: z.number(),
  story_chunk_content: z.array(NewsStoryContentBlock),
  story_chunk_embedding: z.string().nullable(),
});
type StoryChunkRow = z.infer<typeof StoryChunkRow>;

export function makeSupabaseDataSource(connectionString: string): PersistentDataSource {
  const pool = new Pool({ connectionString });
  return {
    async upsertStory(story) {
      await pool.query(
        `
        INSERT INTO stories (
          story_publication,
          story_story_id,
          story_href,
          story_published_at,
          story_updated_at,
          story_content
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (story_publication, story_story_id) DO UPDATE SET
          story_href = EXCLUDED.story_href,
          story_published_at = EXCLUDED.story_published_at,
          story_updated_at = EXCLUDED.story_updated_at,
          story_content = EXCLUDED.story_content
        `,
        [
          story.publication,
          story.storyId,
          story.href,
          story.publishedAt.toISOString(),
          story.updatedAt?.toISOString() ?? null,
          JSON.stringify(story.content),
        ]
      );
    },

    async listStoryIds(publication) {
      const result = await pool.query<Pick<StoryRow, "story_story_id">>(
        `
        SELECT story_story_id
        FROM stories
        WHERE story_publication = $1
        `,
        [publication]
      );
      return z
        .array(StoryRow.pick({ story_story_id: true }))
        .parse(result.rows)
        .map((r) => r.story_story_id);
    },

    async listStoryIdsWithoutChunks(publication, version) {
      const result = await pool.query<Pick<StoryRow, "story_story_id">>(
        `
        SELECT story_story_id
        FROM stories
        WHERE
          story_publication = $1 AND
          NOT EXISTS (
            SELECT *
            FROM story_chunks
            WHERE
              story_chunks.story_id = stories.story_id AND
              story_chunk_version = $2
          )
        `,
        [publication, version]
      );
      return z
        .array(StoryRow.pick({ story_story_id: true }))
        .parse(result.rows)
        .map((r) => r.story_story_id);
    },

    async findStoryById(publication, storyId) {
      const result = await pool.query<StoryRow>(
        `
        SELECT *
        FROM stories
        WHERE
          story_publication = $1 AND
          story_story_id = $2
        `,
        [publication, storyId]
      );
      const first = StoryRow.parse(result.rows[0]);
      return {
        content: first.story_content,
        href: first.story_href,
        id: first.story_id,
        publication: first.story_publication,
        publishedAt: new Date(first.story_published_at),
        storyId: first.story_story_id,
        updatedAt: new Date(first.story_updated_at),
      } satisfies NewsStory;
    },

    async insertChunk(chunk) {
      await pool.query(
        `
        INSERT INTO story_chunks (
          story_id,
          story_chunk_version,
          story_chunk_index,
          story_chunk_content,
          story_chunk_embedding
        )
        VALUES ((SELECT story_id FROM stories WHERE story_publication = $1 AND story_story_id = $2), $3, $4, $5, $6)
        `,
        [
          chunk.publication,
          chunk.storyId,
          chunk.version,
          chunk.index,
          JSON.stringify(chunk.content),
          chunk.embedding ? JSON.stringify(chunk.embedding) : null,
        ]
      );
    },

    async insertEmbedding(chunkId, embedding) {
      await pool.query(
        `
        UPDATE story_chunks
        SET story_chunk_embedding = $1
        WHERE story_chunk_id = $2
        `,
        [JSON.stringify(embedding), chunkId]
      );
    },

    async listChunks(publication, storyId, version) {
      const result = await pool.query<StoryChunkRow & StoryRow>(
        `
        SELECT *
        FROM story_chunks
          NATURAL JOIN stories
        WHERE
          story_id = (
            SELECT story_id
            FROM stories
            WHERE
              story_publication = $1 AND
              story_story_id = $2
          ) AND
          story_chunk_version = $3
        ORDER BY story_chunk_index ASC
        `,
        [publication, storyId, version]
      );
      return z
        .array(StoryRow.and(StoryChunkRow))
        .parse(result.rows)
        .map(
          (r): NewsStoryChunk => ({
            content: r.story_chunk_content,
            embedding: r.story_chunk_embedding ? JSON.parse(r.story_chunk_embedding) : null,
            id: r.story_chunk_id,
            index: r.story_chunk_index,
            publication: r.story_publication,
            storyId: r.story_story_id,
            version: r.story_chunk_version,
          })
        );
    },

    async findChunkById(chunkId) {
      const result = await pool.query<StoryChunkRow & StoryRow>(
        `
        SELECT *
        FROM story_chunks
          NATURAL JOIN stories
        WHERE story_chunk_id = $1
        `,
        [chunkId]
      );
      const first = StoryRow.and(StoryChunkRow).parse(result.rows[0]);
      return {
        content: first.story_chunk_content,
        embedding: first.story_chunk_embedding ? JSON.parse(first.story_chunk_embedding) : null,
        id: first.story_chunk_id,
        index: first.story_chunk_index,
        publication: first.story_publication,
        storyId: first.story_story_id,
        version: first.story_chunk_version,
      } satisfies NewsStoryChunk;
    },
  };
}
