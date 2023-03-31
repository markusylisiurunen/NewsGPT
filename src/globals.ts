import { SupabaseClient, createClient } from "@supabase/supabase-js";
import { Configuration, OpenAIApi } from "openai";
import { NewsStoryDataSource, PersistentDataSource, makeFakerDataSource } from "./data";
import { makeSupabaseDataSource } from "./data/supabase";

type Globals = {
  openai: OpenAIApi;
  supabase: SupabaseClient;
  persistentDataSource: PersistentDataSource;
  newsStoryDataSources: Record<string, NewsStoryDataSource>;
};

export function getGlobals(): Globals {
  return {
    openai: new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_TOKEN })),
    supabase: createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_TOKEN as string),
    persistentDataSource: makeSupabaseDataSource(process.env.SUPABASE_CONNECTION_STRING as string),
    newsStoryDataSources: {
      faker: makeFakerDataSource(),
    },
  };
}
