import { bookshelfLifecycle } from "../../../../db/bookshelf-lifecycle";
import { BookshelfError } from "../../../../lib/bookshelf-lifecycle";
import { assertSameOrigin, hashToken } from "../../../../lib/auth";
import { sessionAuthorization } from "../../../../lib/session-authorization";
import { bookshelfLifecycleErrorResponse, bookshelfLifecycleResponse } from "../../../_bookshelf-lifecycle-http";

export async function GET(request: Request) {
  try {
    const identity = await sessionAuthorization.require(request);
    const search = new URL(request.url).searchParams;
    const result = await bookshelfLifecycle.execute({ kind: "account", id: identity.id }, {
      action: "list", cursor: search.get("cursor"),
    });
    return bookshelfLifecycleResponse(result);
  } catch (error) {
    return bookshelfLifecycleErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await sessionAuthorization.require(request);
    const body = await request.json() as { novelId?: unknown; operationId?: unknown };
    if (typeof body.novelId !== "string" || !body.novelId) throw new BookshelfError("小说标识无效");
    if (typeof body.operationId !== "string") throw new BookshelfError("操作标识无效");
    const sourceKey = await hashToken(`bookshelf:${request.headers.get("cf-connecting-ip") || "unknown"}`);
    return bookshelfLifecycleResponse(await bookshelfLifecycle.execute(
      { kind: "account", id: identity.id }, { action: "add", novelId: body.novelId, operationId: body.operationId, sourceKey },
    ));
  } catch (error) {
    return bookshelfLifecycleErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await sessionAuthorization.require(request);
    const body = await request.json() as { novelId?: unknown; operationId?: unknown };
    if (typeof body.novelId !== "string" || !body.novelId) throw new BookshelfError("小说标识无效");
    if (typeof body.operationId !== "string") throw new BookshelfError("操作标识无效");
    const sourceKey = await hashToken(`bookshelf:${request.headers.get("cf-connecting-ip") || "unknown"}`);
    return bookshelfLifecycleResponse(await bookshelfLifecycle.execute(
      { kind: "account", id: identity.id }, { action: "remove", novelId: body.novelId, operationId: body.operationId, sourceKey },
    ));
  } catch (error) {
    return bookshelfLifecycleErrorResponse(error);
  }
}
