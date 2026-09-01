import { CreationLifecycleError, type CreationCommand, type CreationResult } from "../db/creation-lifecycle";

export function parseCreationCommand(entity: "novel" | "chapter" | "short", input: unknown): CreationCommand {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const action = typeof body.action === "string" ? body.action : "";
  const allowed = entity === "novel"
    ? ["create", "duplicate", "convert", "save", "submit", "withdraw", "reject", "publish", "offline", "delete", "rollback"]
    : entity === "short"
      ? ["create", "save", "submit", "withdraw", "reject", "publish", "offline", "delete", "rollback"]
      : ["create", "duplicate", "save", "submit", "withdraw", "reject", "publish", "offline", "delete", "rollback"];
  const label = entity === "novel" ? "小说" : entity === "short" ? "短篇" : "章节";
  if (!allowed.includes(action)) throw new CreationLifecycleError(`不支持的${label}操作`);
  if (!["create", "duplicate"].includes(action) && typeof body.id !== "string") {
    throw new CreationLifecycleError(`缺少${label} ID`);
  }
  return { ...body, entity, action } as CreationCommand;
}

export function creationLifecycleResponse(result: CreationResult) {
  return result.kind === "created"
    ? Response.json({ id: result.id, ...(result.chapterId ? { chapterId: result.chapterId } : {}) }, { status: 201 })
    : Response.json({ ok: true, ...(result.updatedAt ? { updatedAt: result.updatedAt } : {}) });
}

export function creationLifecycleErrorResponse(error: unknown) {
  if (!(error instanceof CreationLifecycleError)) return null;
  return Response.json({ error: error.message, ...(error.errors ? { errors: error.errors } : {}) }, { status: error.status });
}
