import { creationLifecycle } from "../../../db/creation-lifecycle";
import type { CatalogSection } from "../../../lib/story";
import { publicCreationErrorResponse, publicCreationHeaders } from "../../_public-creation-http";

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const section = search.get("section");
    if (!section) {
      return Response.json(await creationLifecycle.getPublicCatalogHome({ limitPerSection: 4 }), { headers: publicCreationHeaders });
    }
    const limitValue = search.get("limit");
    const limit = limitValue === null || limitValue === "" ? 20 : Number(limitValue);
    const page = await creationLifecycle.listPublicCatalog({
      section: section as CatalogSection,
      limit,
      cursor: search.get("cursor"),
    });
    return Response.json(page, { headers: publicCreationHeaders });
  } catch (error) {
    return publicCreationErrorResponse(error, "作品目录暂时不可用，请稍后重试");
  }
}
