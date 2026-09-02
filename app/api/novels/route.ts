import { creationLifecycle, CreationLifecycleError } from "../../../db/creation-lifecycle";

const publicHeaders = { "cache-control": "public, max-age=30, s-maxage=60" };

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const id = search.get("id");
    const chapterId = search.get("chapterId");
    if (id || chapterId) {
      const novel = await creationLifecycle.getPublicNovel({ id: id ?? undefined, chapterId: chapterId ?? undefined });
      if (!novel) return Response.json({ error: "小说不存在" }, { status: 404, headers: { "cache-control": "no-store" } });
      return Response.json({ novel }, { headers: publicHeaders });
    }
    const result = await creationLifecycle.listPublicNovels(search.get("slug"));
    return Response.json({ novels: result }, { headers: publicHeaders });
  } catch (error) {
    if (error instanceof CreationLifecycleError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    return Response.json({ error: "小说暂时不可用，请稍后重试" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
