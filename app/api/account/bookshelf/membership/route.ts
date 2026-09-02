import { bookshelfLifecycle } from "../../../../../db/bookshelf-lifecycle";
import { BookshelfError } from "../../../../../lib/bookshelf-lifecycle";
import { sessionAuthorization } from "../../../../../lib/session-authorization";
import { bookshelfLifecycleErrorResponse, bookshelfLifecycleResponse } from "../../../../_bookshelf-lifecycle-http";

export async function GET(request: Request) {
  try {
    const identity = await sessionAuthorization.require(request);
    const novelIds = new URL(request.url).searchParams.getAll("novelId");
    if (novelIds.length === 0) throw new BookshelfError("小说标识无效");
    return bookshelfLifecycleResponse(await bookshelfLifecycle.execute(
      { kind: "account", id: identity.id }, novelIds.length === 1
        ? { action: "membership", novelId: novelIds[0] }
        : { action: "membership-batch", novelIds },
    ));
  } catch (error) {
    return bookshelfLifecycleErrorResponse(error);
  }
}
