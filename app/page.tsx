import type { Metadata } from "next";
import { StoryStudio } from "./story-studio";

export const metadata: Metadata = {
  title: "幻界 Fantasy · 互动小说宇宙",
  description: "穿过裂隙，阅读会转弯的故事。",
};

export default function Home() {
  return <StoryStudio />;
}
