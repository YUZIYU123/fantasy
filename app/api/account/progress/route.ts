import { readingSessionProgress } from "../../../../db/reading-session-progress";
import { assertSameOrigin, authErrorResponse } from "../../../../lib/auth";
import type { ReadingProgressUpdate } from "../../../../lib/reading-session";
import { sessionAuthorization } from "../../../../lib/session-authorization";

export async function GET(request: Request) {
  try {
    const identity = await sessionAuthorization.require(request);
    const chapterId = new URL(request.url).searchParams.get("chapterId");
    const progress = await readingSessionProgress.list(identity.id, chapterId);
    return Response.json({ progress: chapterId ? progress[0] || null : progress });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const identity = await sessionAuthorization.require(request);
    const body = await request.json() as ReadingProgressUpdate;
    await readingSessionProgress.save(identity.id, body);
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
