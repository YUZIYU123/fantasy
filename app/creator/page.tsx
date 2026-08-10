import type { Metadata } from "next";
import { CreatorEntry } from "./creator-entry";

export const metadata: Metadata = { title: "创作中心" };

export default function CreatorPage() {
  return <CreatorEntry />;
}
