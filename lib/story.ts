export type AnimationPreset = "none" | "fade" | "rise" | "flash";
export type StoryChoice = { id: string; label: string; targetId: string };
export type StoryNode = {
  id: string;
  title: string;
  body: string;
  type: "scene" | "ending";
  imageUrl: string;
  imageAlt: string;
  audioUrl: string;
  animation: AnimationPreset;
  choices: StoryChoice[];
};
export type StoryDocument = {
  title: string;
  summary: string;
  coverUrl: string;
  startNodeId: string;
  nodes: StoryNode[];
};
export type ChapterRecord = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  coverUrl: string;
  sortOrder: number;
  status: "draft" | "published" | "offline";
  version: number;
  draft: StoryDocument;
  published: StoryDocument | null;
  updatedAt: string;
};

export const demoStory: StoryDocument = {
  title: "雾港来信",
  summary: "午夜的渡口，一封写给失踪者的信改变了你的归途。",
  coverUrl: "",
  startNodeId: "arrival",
  nodes: [
    { id: "arrival", title: "渡口", body: "末班船离岸后，雾里只剩一盏摇晃的灯。你在长椅上发现一封没有署名的信，信封却写着你的名字。", type: "scene", imageUrl: "", imageAlt: "雾中的旧渡口", audioUrl: "", animation: "fade", choices: [{ id: "c1", label: "拆开信封", targetId: "letter" }, { id: "c2", label: "追上提灯的人", targetId: "chase" }] },
    { id: "letter", title: "旧日回声", body: "纸上只有一句话：别让钟声响过十二下。远处钟楼已经响起第十一声。", type: "scene", imageUrl: "", imageAlt: "泛黄的信纸", audioUrl: "", animation: "rise", choices: [{ id: "c3", label: "奔向钟楼", targetId: "light-ending" }] },
    { id: "chase", title: "雾中人", body: "那人停在潮水边，转身时竟有一张与你相同的脸。第十二声钟响起，海面裂开一道银色的路。", type: "scene", imageUrl: "", imageAlt: "月光下的银色海路", audioUrl: "", animation: "flash", choices: [{ id: "c4", label: "踏上海路", targetId: "sea-ending" }] },
    { id: "light-ending", title: "结局 · 留灯", body: "你在最后一刻按住钟摆。雾缓缓散去，清晨的第一艘船载回了那个失踪多年的人。", type: "ending", imageUrl: "", imageAlt: "黎明中的钟楼", audioUrl: "", animation: "fade", choices: [] },
    { id: "sea-ending", title: "结局 · 归潮", body: "你走进海上的月光。身后的港口逐渐缩小，而一段被遗忘的人生正在前方等待。", type: "ending", imageUrl: "", imageAlt: "通往远方的月光海路", audioUrl: "", animation: "fade", choices: [] },
  ],
};

export function validateStory(story: StoryDocument): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  story.nodes.forEach((node) => {
    if (!node.id.trim()) errors.push("存在未填写 ID 的节点");
    if (ids.has(node.id)) errors.push(`节点 ID 重复：${node.id}`);
    ids.add(node.id);
    if (!node.title.trim()) errors.push(`节点 ${node.id || "（未命名）"} 缺少标题`);
    if (!node.body.trim()) errors.push(`节点 ${node.id || "（未命名）"} 缺少正文`);
    if (node.type === "scene" && node.choices.length === 0) errors.push(`剧情节点 ${node.title} 没有选项`);
  });
  if (!ids.has(story.startNodeId)) errors.push("起始节点不存在");
  story.nodes.forEach((node) => node.choices.forEach((choice) => {
    if (!choice.label.trim()) errors.push(`${node.title} 存在空白选项`);
    if (!ids.has(choice.targetId)) errors.push(`${node.title} 的选项指向不存在的节点 ${choice.targetId}`);
  }));
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    story.nodes.find((node) => node.id === id)?.choices.forEach((choice) => visit(choice.targetId));
  };
  visit(story.startNodeId);
  story.nodes.filter((node) => !reachable.has(node.id)).forEach((node) => errors.push(`节点「${node.title}」无法从开头到达`));
  if (!story.nodes.some((node) => node.type === "ending" && reachable.has(node.id))) errors.push("故事没有可到达的结局");
  return [...new Set(errors)];
}
