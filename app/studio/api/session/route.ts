import {
  sessionAuthorization,
} from "../../../../lib/session-authorization";
import { sessionAuthorizationResponse } from "../../../_session-authorization-http";

const noStore = { "cache-control": "no-store" };

export async function GET(request: Request) {
  try {
    const decision = await sessionAuthorization.resolveCreatorAccess(request, "author_workspace");
    return Response.json({ authenticated: decision.outcome === "allow", ...decision }, {
      headers: noStore,
    });
  } catch (error) {
    return sessionAuthorizationResponse(error);
  }
}
