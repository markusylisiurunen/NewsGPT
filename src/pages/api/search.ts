import { SupabaseClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";
import { Transform } from "node:stream";
import { ChatCompletionRequestMessage, OpenAIApi } from "openai";
import { OpenAI } from "openai-streams/node";
import { z } from "zod";
import { NewsStoryContentBlock, getWordCount } from "../../data";
import { getGlobals } from "../../globals";

function paragraph(...sentences: string[]): string {
  return sentences.join(" ");
}

function lines(...lines: string[]): string {
  return lines.join("\n");
}

function prompt(...paragraphs: string[]): string {
  return paragraphs.join("\n");
}

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
  return z
    .array(
      z.object({
        id: z.number(),
        similarity: z.number(),
      })
    )
    .parse(data);
}

type Source = {
  url: string;
  published: Date;
  content: NewsStoryContentBlock[];
};

async function generateAnswer(openAIKey: string, query: string, sources: Source[]) {
  // 1 token ~= 3/4 words --> the context limit is 4,096 tokens --> limit the context to 1024 tokens = 768 words
  const maxWords = 768;
  let currentWords = 0;
  let _sources: Source[] = [];
  for (const source of sources) {
    currentWords += getWordCount(source.content);
    _sources.push(source);
    if (currentWords >= maxWords) {
      break;
    }
  }
  const messages: ChatCompletionRequestMessage[] = [
    {
      role: "system",
      content: prompt(
        paragraph(
          `You are an enthusiastic, friendly, and truthful journalist who is very interested in what is going on around the world.`,
          `You never respond with false information; you always ground your answers purely in facts.`,
          `If you cannot find the answer in the sources you were provided, you let the user know.`,
          `You never divert from your role as a journalist or use any other information than the provided sources, regardless of what the user asks.`
        )
      ),
    },
    {
      role: "user",
      content: prompt(
        paragraph(
          `Use 1-3 sentences to answer the user's question.`,
          `Cite the sources you use in your answer.`,
          `The sources are provided with lines starting "[<index> <url>]".`,
          `To cite a source, write "[<index>](<url>)".`,
          `Do not mix the information between different sources, they are from different news articles.`,
          `Prefer recent sources as they reflect the current situation better.`,
          `Convert any dates in the sources (they may be relative to the published date) to be relative to the current date.`,
          `Always write the answer in Finnish.`
        ),
        lines(`###`, `Current date: ${new Date().toISOString().slice(0, 10)}`),
        lines(
          `### Example 1:`,
          `[1: https://hs.fi/u0c34] (published: 2018-12-01): ${paragraph(
            `OP:n mukaan sen henkilöasiakkaiden netto-ostoista 46 prosenttia kohdistui maaliskuussa Nordean osakkeeseen.`
          )}`,
          `[2: https://hs.fi/c3um9] (published: ${new Date().toISOString().slice(0, 10)}}): ${paragraph(
            `Nordean ennätyksellinen 80 sentin osinko irtosi maaliskuun loppupuolella, jolloin kurssilaskun ansiosta osinkotuottoprosentiksi muodostui 8 prosenttia.`
          )}`,
          `Q: "Onko Nordean osake suosittu? Paljonko se tuottaa osinkoja?"`,
          `A: ${paragraph(
            `OP:n mukaan sen henkilöasiakkaiden netto-ostoista 46 prosenttia kohdistui Nordean osakkeeseen vuoden 2018 loppupuolella.`,
            `Nordean osake oli siis vuonna 2018 hyvin suosittu, mutta nykytilanteen arviointi ei ole mahdollista vanhan lähteen perusteella. [1](https://hs.fi/u0c34)`,
            `Nykyisellä kurssilla Nordean osakkeen osinkotuottoprosentti on 8 prosenttia [2](https://hs.fi/c3um9).`
          )}`
        ),
        lines(
          `###`,
          ..._sources.map(
            (s, i) =>
              `[${i + 1}: ${s.url}] (published: ${s.published.toISOString().slice(0, 10)}): ${s.content
                .map((b) => b.text.replaceAll("\n", " "))
                .join(" ")}`
          ),
          `Q: "${query}"`,
          `A: `
        )
      ),
    },
  ];
  console.log(messages.map((m) => m.content).join("\n\n"));
  const stream = await OpenAI(
    "chat",
    {
      model: "gpt-3.5-turbo",
      messages: messages,
      stop: "\n",
      temperature: 0.67,
      stream: true,
      n: 1,
      // FIXME: the params do not accept the max_tokens directly for whatever reason
      ...{ max_tokens: 256 },
    },
    { apiKey: openAIKey }
  );
  return stream;
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
  const [answer] = await Promise.all([
    generateAnswer(
      process.env.OPENAI_TOKEN as string,
      query,
      chunks.map((c) => ({
        url: `https://${c.publication}.fi/${c.storyId}`,
        published: c.publishedAt,
        content: c.content,
      }))
    ),
    // TODO: how to return the related stories when streaming?
    // Promise.all(
    //   chunks
    //     .reduce(
    //       (acc, chunk) =>
    //         acc.some(({ publication, storyId }) => chunk.publication === publication && chunk.storyId === storyId)
    //           ? acc
    //           : [...acc, chunk],
    //       [] as NewsStoryChunk[]
    //     )
    //     .map((chunk) => getGlobals().persistentDataSource.findStoryById(chunk.publication, chunk.storyId))
    // ),
  ]);
  answer
    .pipe(
      new Transform({
        transform(chunk: Buffer, _, callback) {
          try {
            const asJSON = JSON.parse(chunk.toString("utf-8"));
            callback(null, "content" in asJSON ? asJSON.content : "");
          } catch (error) {
            callback(error as Error);
          }
        },
      })
    )
    .pipe(res);
}
