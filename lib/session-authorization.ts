import { ensureSchema } from "../db";
import { optionalSessionIdentity } from "../db/session-identity";
import {
  clearCreatorSessionCookie,
  createCreatorSessionCookie,
  creatorAuthConfigured,
  hasCreatorSession,
  localAdminBypassEnabled,
  verifyCreatorPassword,
} from "./admin-auth";
import {
  createSessionAuthorization,
} from "./session-authorization-module";

export type {
  AdministratorIdentity,
  AdministratorSource,
  CreatorAccessDecision,
  CreatorAccessSurface,
  CreatorEntryReason,
} from "./session-authorization-module";
export { SessionAuthorizationError } from "./session-authorization-module";

const authorization = createSessionAuthorization({
  resolveAccount: async (request) => {
    await ensureSchema();
    return optionalSessionIdentity(request);
  },
  localAdministratorEnabled: localAdminBypassEnabled,
  sharedCredential: {
    configured: creatorAuthConfigured,
    hasSession: hasCreatorSession,
    verify: verifyCreatorPassword,
    createSessionCookie: createCreatorSessionCookie,
    clearSessionCookie: clearCreatorSessionCookie,
  },
});

export const sessionAuthorization = authorization;
