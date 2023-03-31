import { faker } from "@faker-js/faker";
import { v4 as uuid } from "uuid";
import { NewsStoryContentBlock, NewsStoryDataSource } from "../types";

export function makeFakerDataSource(): NewsStoryDataSource {
  return {
    async listLatestN(n) {
      return Array.from({ length: n }).map(() => ({ id: uuid() }));
    },

    async getStory(id) {
      const contentBlockCount = Math.floor(4 + Math.random() * 8);
      const makeContentBlock = (): NewsStoryContentBlock => ({
        type: "text",
        text: faker.lorem.paragraph(2),
      });
      return {
        content: Array.from({ length: contentBlockCount }).map(makeContentBlock),
        href: `https://example.com/${id}`,
        publication: "faker",
        publishedAt: new Date(),
        storyId: id,
        updatedAt: new Date(),
      };
    },
  };
}
