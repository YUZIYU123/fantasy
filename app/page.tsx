import type { Metadata } from "next";
import { StoryStudio } from "./story-studio";

export const metadata: Metadata = {
  title: "雾页 · 互动故事",
  description: "阅读会转弯的故事，也让每一次选择留下回声。",
};

export default function Home() {
  return <StoryStudio />;
}
