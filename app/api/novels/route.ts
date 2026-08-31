import { creationLifecycle } from "../../../db/creation-lifecycle";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const result = await creationLifecycle.listPublicNovels(search.get("slug"));
  return Response.json({ novels: result }, {
    headers: { "cache-control": "public, max-age=30, s-maxage=60" },
  });
}
