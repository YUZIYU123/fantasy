import { bookshelfLifecycle } from "../../../../../db/bookshelf-lifecycle";
import { BookshelfError } from "../../../../../lib/bookshelf-lifecycle";
import { sessionAuthorization } from "../../../../../lib/session-authorization";
import { bookshelfLifecycleErrorResponse, bookshelfLifecycleResponse } from "../../../../_bookshelf-lifecycle-http";

export async function GET(request: Request) {
  try {
    const identity = await sessionAuthorization.require(request);
    const novelId = new URL(request.url).searchParams.get("novelId");
    if (!novelId) throw new BookshelfError("小说标识无效");
    return bookshelfLifecycleResponse(await bookshelfLifecycle.execute(
      { kind: "account", id: identity.id }, { action: "membership", novelId },
    ));
  } catch (error) {
    return bookshelfLifecycleErrorResponse(error);
  }
}
