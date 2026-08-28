import type { Metadata } from "next";
import { XiaowuGardenScreen } from "./screen";

export const metadata: Metadata = {
  title: "雾庭",
  description: "在世界树庭院里陪伴小雾成长。",
};

export default function XiaowuGardenPage() {
  return <XiaowuGardenScreen />;
}
