export type BookshelfOperationState =
  | { status: "succeeded"; operationId: string }
  | { status: "auth_required"; operationId: string }
  | { status: "confirming"; operationId: string }
  | { status: "failed"; operationId: string; message: string };

export async function executeBookshelfOperation(input: {
  action: "add" | "remove";
  novelId: string;
  operationId?: string | null;
  timeoutMs?: number;
}): Promise<BookshelfOperationState> {
  const operationId = input.operationId || crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
  try {
    const response = await fetch("/api/account/bookshelf", {
      method: input.action === "add" ? "POST" : "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ novelId: input.novelId, operationId }),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { status: "auth_required", operationId };
    const body = await response.json() as { error?: string };
    return response.ok
      ? { status: "succeeded", operationId }
      : { status: "failed", operationId: response.status === 409 ? crypto.randomUUID() : operationId, message: body.error || "书架操作失败，请重试" };
  } catch {
    const resultController = new AbortController();
    const resultTimeout = setTimeout(() => resultController.abort(), Math.min(2_000, input.timeoutMs ?? 10_000));
    const result = await fetch(`/api/account/bookshelf/result?operationId=${encodeURIComponent(operationId)}`, {
      signal: resultController.signal,
    }).then((response) => response.ok ? response.json() as Promise<{ status?: string; result?: { reason?: string } }> : null)
      .catch(() => null)
      .finally(() => clearTimeout(resultTimeout));
    if (result?.status === "succeeded") return { status: "succeeded", operationId };
    if (result?.status === "failed") return {
      status: "failed", operationId,
      message: result.result?.reason === "unavailable" ? "这部小说当前不能加入书架" : "书架操作失败，请重试",
    };
    return { status: "confirming", operationId };
  } finally {
    clearTimeout(timeout);
  }
}
