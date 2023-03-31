import { PromisePool } from "@supercharge/promise-pool";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { NewsStoryContentBlock, PersistentDataSource, getWordCount } from "../../../data";
import { getGlobals } from "../../../globals";

function makeChunker(storage: PersistentDataSource) {
  return async (publication: string, version: number, wordsPerChunk: number) => {
    // fetch the story ids that require chunking
    const storyIds = await storage.listStoryIdsWithoutChunks(publication, version);
    console.log(`found ${storyIds.length} to be chunked`);
    // chunk the stories
    const { errors } = await PromisePool.for(storyIds)
      .withConcurrency(8)
      .process(async (storyId) => {
        // fetch the content from the database
        const { content } = await storage.findStoryById(publication, storyId);
        // chunk the content
        const chunks: NewsStoryContentBlock[][] = [];
        let currentChunk: NewsStoryContentBlock[] = [];
        for (let i = 0; i < content.length; i += 1) {
          currentChunk.push(content[i]);
          if (getWordCount(currentChunk) >= wordsPerChunk) {
            chunks.push(currentChunk);
            currentChunk = [];
            // TODO: overlap the chunks...
          }
        }
        if (currentChunk.length > 0) {
          // push the last chunk of content
          chunks.push(currentChunk);
        }
        console.log(`chunked story "${storyId}" into ${chunks.length} chunks`);
        // store the chunks in the database
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          await storage.insertChunk({
            content: chunks[chunkIndex],
            embedding: null,
            index: chunkIndex,
            publication: publication,
            storyId: storyId,
            version: version,
          });
        }
      });
    if (errors.length > 0) {
      throw errors[0]!.raw;
    }
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: false; error: string } | { ok: true }>
) {
  if (req.method !== "PUT") {
    res.status(400).send({ ok: false, error: 'invalid method, must be "PUT"' });
    return;
  }
  const globals = getGlobals();
  const body = z
    .object({
      publication: z.string(),
      version: z.number(),
      words_per_chunk: z.number(),
    })
    .parse(req.body);
  if (!(body.publication in globals.newsStoryDataSources)) {
    res.status(500).send({ ok: false, error: "invalid news story data source" });
    return;
  }
  const storage = globals.persistentDataSource;
  const chunk = makeChunker(storage);
  await chunk(body.publication, body.version, body.words_per_chunk);
  res.status(200).json({ ok: true });
}
