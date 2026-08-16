import { bookshelfLifecycle } from "../../../../../db/bookshelf-lifecycle";
import { BookshelfError } from "../../../../../lib/bookshelf-lifecycle";
import { sessionAuthorization } from "../../../../../lib/session-authorization";
import { bookshelfLifecycleErrorResponse, bookshelfLifecycleResponse } from "../../../../_bookshelf-lifecycle-http";

export async function GET(request: Request) {
  try {
    const identity = await sessionAuthorization.require(request);
    const operationId = new URL(request.url).searchParams.get("operationId");
    if (!operationId) throw new BookshelfError("操作标识无效");
    return bookshelfLifecycleResponse(await bookshelfLifecycle.execute(
      { kind: "account", id: identity.id }, { action: "result", operationId },
    ));
  } catch (error) {
    return bookshelfLifecycleErrorResponse(error);
  }
}
