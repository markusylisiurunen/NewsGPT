import { PromisePool } from "@supercharge/promise-pool";
import type { NextApiRequest, NextApiResponse } from "next";
import { OpenAIApi } from "openai";
import { z } from "zod";
import { PersistentDataSource, toMarkdown } from "../../../data";
import { getGlobals } from "../../../globals";

function makeEmbedder(storage: PersistentDataSource, openai: OpenAIApi) {
  // TODO: this is far from optimal...
  return async (publication: string, version: number) => {
    // fetch the stories for the publication
    const storyIds = await storage.listStoryIds(publication);
    console.log(`found ${storyIds.length} stories`);
    // process each article
    const { errors } = await PromisePool.for(storyIds)
      .withConcurrency(64)
      .process(async (storyId) => {
        // fetch the chunks
        const chunks = await storage.listChunks(publication, storyId, version);
        if (chunks.length === 0) {
          console.log(`no chunks found for "${storyId}", skipping`);
          return;
        }
        for (const chunk of chunks) {
          if (chunk.embedding !== null) {
            console.log(`chunk for story "${storyId}" already has an embedding, skipping`);
            continue;
          }
          // fetch the embedding from OpenAI
          const resp = await openai.createEmbedding({
            model: "text-embedding-ada-002",
            input: toMarkdown(chunk.content),
          });
          const embedding = resp.data.data[0]?.embedding;
          if (!embedding) {
            throw new Error("expected to receive an embedding from OpenAI");
          }
          // store the embedding in the database
          await storage.insertEmbedding(chunk.id, embedding);
          console.log(`done computing an embedding for a chunk for story "${storyId}"`);
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
  const body = z.object({ publication: z.string(), version: z.number() }).parse(req.body);
  if (!(body.publication in globals.newsStoryDataSources)) {
    res.status(500).send({ ok: false, error: "invalid news story data source" });
    return;
  }
  const [storage, openai] = [globals.persistentDataSource, globals.openai];
  const embed = makeEmbedder(storage, openai);
  await embed(body.publication, body.version);
  res.status(200).json({ ok: true });
}
