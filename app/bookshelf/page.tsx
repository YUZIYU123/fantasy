import type { Metadata } from "next";
import { BookshelfScreen } from "./screen";

export const metadata: Metadata = { title: "我的书架" };

export default function BookshelfPage() {
  return <BookshelfScreen />;
}
