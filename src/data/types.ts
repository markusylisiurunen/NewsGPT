import { assertNever } from "../util";
import { z } from "zod";

export const NewsStoryContentBlock = z.object({
  type: z.union([z.literal("headline"), z.literal("heading"), z.literal("text")]),
  text: z.string(),
});
export type NewsStoryContentBlock = z.infer<typeof NewsStoryContentBlock>;

export function getWordCount(blocks: NewsStoryContentBlock[]): number {
  return blocks.map((b) => b.text.split(" ").length).reduce((sum, count) => sum + count, 0);
}

export function toMarkdown(blocks: NewsStoryContentBlock[]): string {
  return blocks
    .map((b) => {
      const type = b.type;
      switch (type) {
        case "headline":
          return `# ${b.text}`;
        case "heading":
          return `## ${b.text}`;
        case "text":
          return b.text;
        default:
          return assertNever(type);
      }
    })
    .join("\n\n");
}

export const NewsStory = z.object({
  content: z.array(NewsStoryContentBlock),
  href: z.string(),
  id: z.string(),
  publication: z.string(),
  publishedAt: z.instanceof(Date),
  storyId: z.string(),
  updatedAt: z.instanceof(Date).nullable(),
});
export type NewsStory = z.infer<typeof NewsStory>;

export const NewsStoryChunk = z.object({
  content: z.array(NewsStoryContentBlock),
  embedding: z.array(z.number()).nullable(),
  id: z.string(),
  index: z.number(),
  publication: z.string(),
  storyId: z.string(),
  version: z.number(),
});
export type NewsStoryChunk = z.infer<typeof NewsStoryChunk>;

export interface NewsStoryDataSource {
  listLatestN(n: number): Promise<{ id: string }[]>;
  getStory(id: string): Promise<Omit<NewsStory, "id">>;
}

export interface PersistentDataSource {
  // stories
  upsertStory(story: Omit<NewsStory, "id">): Promise<void>;
  listStoryIds(publication: string): Promise<string[]>;
  listStoryIdsWithoutChunks(publication: string, version: number): Promise<string[]>;
  findStoryById(publication: string, storyId: string): Promise<NewsStory>;

  // chunks of content
  insertChunk(chunk: Omit<NewsStoryChunk, "id">): Promise<void>;
  insertEmbedding(chunkId: string, embedding: number[]): Promise<void>;
  listChunks(publication: string, storyId: string, version: number): Promise<NewsStoryChunk[]>;
  findChunkById(chunkId: string): Promise<NewsStoryChunk>;
}
