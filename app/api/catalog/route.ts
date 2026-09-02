import { creationLifecycle, CreationLifecycleError } from "../../../db/creation-lifecycle";
import type { CatalogSection } from "../../../lib/story";

const publicHeaders = { "cache-control": "public, max-age=30, s-maxage=60" };

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const section = search.get("section");
    if (!section) {
      if (search.has("limit") || search.has("cursor")) throw new CreationLifecycleError("作品目录分类无效");
      return Response.json(await creationLifecycle.getPublicCatalogHome({ limitPerSection: 4 }), { headers: publicHeaders });
    }
    const limitValue = search.get("limit");
    const limit = limitValue === null || limitValue === "" ? 20 : Number(limitValue);
    const page = await creationLifecycle.listPublicCatalog({
      section: section as CatalogSection,
      limit,
      cursor: search.get("cursor"),
    });
    return Response.json(page, { headers: publicHeaders });
  } catch (error) {
    if (error instanceof CreationLifecycleError) {
      return Response.json({ error: error.message }, {
        status: error.status,
        headers: { "cache-control": "no-store" },
      });
    }
    return Response.json({ error: "作品目录暂时不可用，请稍后重试" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
