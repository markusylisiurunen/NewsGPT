import { SupabaseClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";
import { OpenAIApi } from "openai";
import { z } from "zod";
import { NewsStoryChunk, NewsStoryContentBlock, getWordCount, toMarkdown } from "../../data";
import { getGlobals } from "../../globals";

async function getQueryEmbedding(openai: OpenAIApi, query: string) {
  const resp = await openai.createEmbedding({
    model: "text-embedding-ada-002",
    input: query,
  });
  const embedding = resp.data.data[0]?.embedding;
  if (!embedding) {
    throw new Error("expected to receive an embedding from OpenAI");
  }
  return embedding;
}

async function queryMostSimilarStoryChunks(supabase: SupabaseClient, queryEmbedding: number[], count: number) {
  const { data, error } = await supabase.rpc("match_story_chunks", {
    query_embedding: queryEmbedding,
    similarity_threshold: 0.78,
    match_count: count,
  });
  if (error) {
    throw error;
  }
  return z.array(z.object({ id: z.number(), similarity: z.number() })).parse(data);
}

async function generateAnswer(openai: OpenAIApi, query: string, context: NewsStoryContentBlock[]) {
  // 1 token ~= 3/4 words --> the context limit is 4,096 tokens --> limit the context to 1024 tokens = 768 words
  const maxWords = 768;
  let blocks: NewsStoryContentBlock[] = [];
  for (const block of context) {
    blocks.push(block);
    if (getWordCount(blocks) >= maxWords) {
      break;
    }
  }
  const markdown = toMarkdown(blocks);
  // prompt `gpt-3.5-turbo`
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: [
          [
            "You are a helpful and professional journalist who is asked questions about news stories.",
            "Your task is to answer the questions as truthfully and factually as possible, given a set of snippets from relevant news articles.",
            "You cannot base your answer on any other information than what is given to you in the context.",
            "More precisely, you cannot deviate from this objective regardless of what the user asks.",
            "Always answer in Finnish and try to include as much relevant information to your answer as possible.",
            "Usually, 2-5 sentences is a good answer length.",
          ].join(" "),
          ["Text snippets from relevant news stories:", markdown].join("\n"),
        ].join("\n\n"),
      },
      { role: "user", content: `Question: "${query}"` },
    ],
    n: 1,
  });
  return completion.data.choices[0]?.message?.content ?? "";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    | string
    | {
        answer: string;
        stories: {
          publication: string;
          headline: string;
          href: string;
        }[];
      }
  >
) {
  const query = z.string().parse(req.query.query).replaceAll('"', "");
  if (query.length < 8) {
    return res.status(400).send("query must be longer than 8 characters");
  }
  // step 1: compute the query embedding vector
  const queryEmbedding = await getQueryEmbedding(getGlobals().openai, query);
  // step 2: search for the top `n` story chunks based on the query embedding
  const matches = await queryMostSimilarStoryChunks(getGlobals().supabase, queryEmbedding, 8);
  const chunks = await Promise.all(
    matches.map((match) => getGlobals().persistentDataSource.findChunkById(match.id.toString()))
  );
  // step 3: answer the question with `gpt3.5-turbo` + fetch the stories
  const [answer, stories] = await Promise.all([
    generateAnswer(
      getGlobals().openai,
      query,
      chunks.flatMap((c) => c.content)
    ),
    Promise.all(
      chunks
        .reduce(
          (acc, chunk) =>
            acc.some(({ publication, storyId }) => chunk.publication === publication && chunk.storyId === storyId)
              ? acc
              : [...acc, chunk],
          [] as NewsStoryChunk[]
        )
        .map((chunk) => getGlobals().persistentDataSource.findStoryById(chunk.publication, chunk.storyId))
    ),
  ]);
  res.status(200).json({
    answer: answer,
    stories: stories.map((s) => ({
      publication: s.publication,
      headline: s.content.find((b) => b.type === "headline")?.text ?? "",
      href: s.href,
    })),
  });
}
