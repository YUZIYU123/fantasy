import { creationLifecycle } from "../../../db/creation-lifecycle";
import { publicCreationErrorResponse, publicCreationHeaders } from "../../_public-creation-http";

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const limitValue = search.get("limit");
    const result = await creationLifecycle.getPublicCatalog({
      section: search.get("section"),
      limit: limitValue === null ? undefined : Number(limitValue),
      cursor: search.get("cursor"),
    });
    return Response.json(result, { headers: publicCreationHeaders });
  } catch (error) {
    return publicCreationErrorResponse(error, "作品目录暂时不可用，请稍后重试");
  }
}
