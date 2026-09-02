import { creationLifecycle } from "../../../db/creation-lifecycle";
import { publicCreationErrorResponse, publicCreationHeaders } from "../../_public-creation-http";

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const id = search.get("id");
    const chapterId = search.get("chapterId");
    if (id || chapterId) {
      const novel = await creationLifecycle.getPublicNovel({ id: id ?? undefined, chapterId: chapterId ?? undefined });
      if (!novel) return Response.json({ error: "小说不存在" }, { status: 404, headers: { "cache-control": "no-store" } });
      return Response.json({ novel }, { headers: publicCreationHeaders });
    }
    const result = await creationLifecycle.listPublicNovels(search.get("slug"));
    return Response.json({ novels: result }, { headers: publicCreationHeaders });
  } catch (error) {
    return publicCreationErrorResponse(error, "小说暂时不可用，请稍后重试");
  }
}
