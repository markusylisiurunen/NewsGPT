import { PromisePool } from "@supercharge/promise-pool";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import type { PersistentDataSource } from "../../../data";
import { NewsStoryDataSource } from "../../../data/types";
import { getGlobals } from "../../../globals";
import { sleep } from "../../../util";

function makeLatestScraper(newsStories: NewsStoryDataSource, storage: PersistentDataSource) {
  return async (publication: string, limit: number) => {
    // fetch the current news stories from the storage (to not unnecessarily do duplicate work)
    const existingStoryIds = await storage.listStoryIds(publication);
    // fetch the IDs of the `limit` latest stories from the publication
    console.log(`listing the latest ${limit} news stories from "${publication}"`);
    const latestLimitStoryIDs = await newsStories.listLatestN(limit);
    // fetch the actual stories with the help of PromisePool
    const { errors: storyErrors } = await PromisePool.for(latestLimitStoryIDs)
      .withConcurrency(8)
      .process(async ({ id }) => {
        if (existingStoryIds.includes(id)) {
          console.log(`story "${id}" from "${publication}" already exists, skipping...`);
          return;
        }
        console.log(`fetching story "${id}" from "${publication}"`);
        let attempts = 0;
        while (true) {
          attempts += 1;
          try {
            const story = await newsStories.getStory(id);
            if (story.content.length <= 3) {
              // skip stories with too little content
              console.log(`skipping story "${id}" because too little content`);
              return;
            }
            await storage.upsertStory(story);
            console.log(`story "${id}" persisted to database`);
            break;
          } catch (error) {
            if (attempts < 3) {
              console.log(`attempt ${attempts} failed for story "${id}", retrying...`);
              await sleep(500);
              continue;
            }
            // this story could not be scraped, log the error and continue
            if (error instanceof Error) {
              console.log(error.message);
            }
            break;
          }
        }
      });
    if (storyErrors.length > 0) {
      throw storyErrors[0]!.raw;
    }
    console.log(`done`);
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
  const body = z.object({ publication: z.string(), limit: z.number() }).parse(req.body);
  if (!(body.publication in globals.newsStoryDataSources)) {
    res.status(500).send({ ok: false, error: "invalid news story data source" });
    return;
  }
  const [storage, newsStories] = [globals.persistentDataSource, globals.newsStoryDataSources[body.publication]];
  const scrape = makeLatestScraper(newsStories, storage);
  await scrape(body.publication, body.limit);
  res.status(200).json({ ok: true });
}
