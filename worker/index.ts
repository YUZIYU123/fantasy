/** Cloudflare Worker entry point for the interactive-fiction application. */
import handler from "vinext/server/app-router-entry";
import { accountLifecycle } from "../db/account-runtime";

const worker = {
  fetch: handler.fetch.bind(handler),
  scheduled(_controller: ScheduledController, _env: unknown, context: ExecutionContext) {
    context.waitUntil(accountLifecycle.execute({ action: "cleanup-expired-pending-accounts" }));
  },
};

export default worker;
