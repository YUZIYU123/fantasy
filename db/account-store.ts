import { and, eq } from "drizzle-orm";
import { getD1Binding, getDb } from ".";
import { accountOperationReceipts, accountPreferences, authTokens, registrationConsents, users } from "./schema";

export type AccountRecord = typeof users.$inferSelect;

export interface AccountStore {
  findByEmail(email: string): Promise<AccountRecord | undefined>;
  createPendingRegistration(input: {
    user: typeof users.$inferInsert;
    consent: typeof registrationConsents.$inferInsert;
    preference: typeof accountPreferences.$inferInsert;
    token: typeof authTokens.$inferInsert;
  }): Promise<void>;
  markVerificationSent(userId: string, sentAt: string, pendingExpiresAt: string): Promise<void>;
  createEmailVerificationToken(token: typeof authTokens.$inferInsert): Promise<void>;
  restartPendingRegistration(input: {
    userId: string;
    email: string;
    displayName: string;
    passwordHash: string;
    consent: { ageConfirmedAt: string; termsVersion: string; privacyVersion: string; confirmedAt: string };
    analyticsAllowed: boolean;
    revokedMarker: string;
    token: typeof authTokens.$inferInsert;
  }): Promise<boolean>;
  inspectEmailVerification(tokenHash: string, now: string): Promise<{
    state: "ready" | "used" | "expired" | "invalid";
    userId?: string;
  }>;
  activateAccount(input: {
    tokenHash: string;
    usedMarker: string;
    now: string;
    session: { id: string; tokenHash: string; expiresAt: string };
  }): Promise<AccountRecord | undefined>;
  findOperationReceipt(idempotencyHash: string): Promise<typeof accountOperationReceipts.$inferSelect | undefined>;
  createOperationReceipt(receipt: typeof accountOperationReceipts.$inferInsert): Promise<void>;
  finishOperationReceipt(idempotencyHash: string, input: {
    status: "succeeded" | "failed" | "uncertain";
    resultJson: string;
    updatedAt: string;
  }): Promise<void>;
  claimUncertainOperationReceipt(idempotencyHash: string, updatedAt: string): Promise<boolean>;
  cleanupExpired(now: string): Promise<{ removedPendingAccounts: number; removedOperationReceipts: number }>;
  setRegistrationAnalyticsPreference(userId: string, allowed: boolean, updatedAt: string): Promise<void>;
  findAccountPreferences(userId: string): Promise<typeof accountPreferences.$inferSelect | undefined>;
  updateGuideMemory(input: {
    userId: string;
    readingPreferencesJson: string;
    guideCompletedAt: string;
    updatedAt: string;
  }): Promise<void>;
  clearGuideMemory(userId: string, updatedAt: string): Promise<void>;
}

export const drizzleD1AccountStore: AccountStore = {
  async findByEmail(email) {
    return (await getDb().select().from(users).where(eq(users.email, email)).limit(1))[0];
  },
  async createPendingRegistration(input) {
    const db = getDb();
    await db.batch([
      db.insert(users).values(input.user),
      db.insert(registrationConsents).values(input.consent),
      db.insert(accountPreferences).values(input.preference),
      db.insert(authTokens).values(input.token),
    ]);
  },
  async markVerificationSent(userId, sentAt, pendingExpiresAt) {
    await getDb().update(users).set({
      lastVerificationSentAt: sentAt,
      pendingExpiresAt,
      updatedAt: sentAt,
    }).where(eq(users.id, userId));
  },
  async createEmailVerificationToken(token) {
    await getDb().insert(authTokens).values(token);
  },
  async restartPendingRegistration(input) {
    const d1 = getD1Binding();
    const pendingGuard = "EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'pending')";
    await d1.batch([
      d1.prepare(`UPDATE registration_consents
        SET age_confirmed_at = ?, terms_version = ?, privacy_version = ?, confirmed_at = ?
        WHERE user_id = ? AND ${pendingGuard}`)
        .bind(
          input.consent.ageConfirmedAt, input.consent.termsVersion, input.consent.privacyVersion,
          input.consent.confirmedAt, input.userId, input.userId,
        ),
      d1.prepare(`UPDATE auth_tokens SET used_at = ?
        WHERE user_id = ? AND type = 'verify_email' AND used_at IS NULL AND ${pendingGuard}`)
        .bind(input.revokedMarker, input.userId, input.userId),
      d1.prepare(`INSERT INTO auth_tokens (id, user_id, token_hash, type, expires_at)
        SELECT ?, ?, ?, 'verify_email', ? WHERE ${pendingGuard}`)
        .bind(input.token.id, input.userId, input.token.tokenHash, input.token.expiresAt, input.userId),
      d1.prepare(`UPDATE users SET email = ?, display_name = ?, password_hash = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'`)
        .bind(input.email, input.displayName, input.passwordHash, input.consent.confirmedAt, input.userId),
      d1.prepare(`UPDATE account_preferences SET registration_analytics_allowed = ?, updated_at = ?
        WHERE user_id = ? AND ${pendingGuard}`)
        .bind(input.analyticsAllowed ? 1 : 0, input.consent.confirmedAt, input.userId, input.userId),
    ]);
    const account = (await getDb().select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
    return account?.status === "pending" && account.email === input.email && account.passwordHash === input.passwordHash;
  },
  async inspectEmailVerification(tokenHash, now) {
    const token = (await getDb().select().from(authTokens).where(and(
      eq(authTokens.tokenHash, tokenHash),
      eq(authTokens.type, "verify_email"),
    )).limit(1))[0];
    if (!token) return { state: "invalid" };
    if (token.usedAt) return { state: "used", userId: token.userId };
    if (token.expiresAt <= now) return { state: "expired" };
    const user = (await getDb().select().from(users).where(eq(users.id, token.userId)).limit(1))[0];
    if (!user || user.status !== "pending") return { state: "invalid" };
    return { state: "ready", userId: token.userId };
  },
  async activateAccount(input) {
    const d1 = getD1Binding();
    await d1.batch([
      d1.prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at)
        SELECT ?, token.user_id, ?, ? FROM auth_tokens token
        JOIN users account ON account.id = token.user_id
        WHERE token.token_hash = ? AND token.type = 'verify_email' AND token.used_at IS NULL
          AND token.expires_at > ? AND account.status = 'pending'`)
        .bind(input.session.id, input.session.tokenHash, input.session.expiresAt, input.tokenHash, input.now),
      d1.prepare(`UPDATE auth_tokens SET used_at = ?
        WHERE token_hash = ? AND type = 'verify_email' AND used_at IS NULL AND expires_at > ?
          AND EXISTS (SELECT 1 FROM users WHERE users.id = auth_tokens.user_id AND users.status = 'pending')`)
        .bind(input.usedMarker, input.tokenHash, input.now),
      d1.prepare(`UPDATE users SET status = 'active', email_verified_at = ?, pending_expires_at = NULL, updated_at = ?
        WHERE status = 'pending' AND id = (SELECT user_id FROM auth_tokens
          WHERE token_hash = ? AND type = 'verify_email' AND used_at = ?)`)
        .bind(input.now, input.now, input.tokenHash, input.usedMarker),
    ]);
    const token = (await getDb().select().from(authTokens).where(eq(authTokens.tokenHash, input.tokenHash)).limit(1))[0];
    if (token?.usedAt !== input.usedMarker) return undefined;
    return (await getDb().select().from(users).where(eq(users.id, token.userId)).limit(1))[0];
  },
  async findOperationReceipt(idempotencyHash) {
    return (await getDb().select().from(accountOperationReceipts)
      .where(eq(accountOperationReceipts.idempotencyHash, idempotencyHash)).limit(1))[0];
  },
  async createOperationReceipt(receipt) {
    await getDb().insert(accountOperationReceipts).values(receipt);
  },
  async finishOperationReceipt(idempotencyHash, input) {
    await getDb().update(accountOperationReceipts).set(input)
      .where(eq(accountOperationReceipts.idempotencyHash, idempotencyHash));
  },
  async claimUncertainOperationReceipt(idempotencyHash, updatedAt) {
    const result = await getD1Binding().prepare(`UPDATE account_operation_receipts
      SET status = 'processing', updated_at = ?
      WHERE idempotency_hash = ? AND status = 'uncertain'`).bind(updatedAt, idempotencyHash).run();
    return Number(result.meta.changes ?? 0) === 1;
  },
  async cleanupExpired(now) {
    const d1 = getD1Binding();
    const expiredPending = "SELECT id FROM users WHERE status = 'pending' AND pending_expires_at IS NOT NULL AND pending_expires_at <= ?";
    const results = await d1.batch([
      d1.prepare(`DELETE FROM sessions WHERE user_id IN (${expiredPending})`).bind(now),
      d1.prepare(`DELETE FROM auth_tokens WHERE user_id IN (${expiredPending})`).bind(now),
      d1.prepare(`DELETE FROM registration_consents WHERE user_id IN (${expiredPending})`).bind(now),
      d1.prepare(`DELETE FROM account_preferences WHERE user_id IN (${expiredPending})`).bind(now),
      d1.prepare(`DELETE FROM users WHERE id IN (${expiredPending})`).bind(now),
      d1.prepare("DELETE FROM account_operation_receipts WHERE expires_at <= ?").bind(now),
    ]);
    return {
      removedPendingAccounts: Number(results[4]?.meta.changes ?? 0),
      removedOperationReceipts: Number(results[5]?.meta.changes ?? 0),
    };
  },
  async setRegistrationAnalyticsPreference(userId, allowed, updatedAt) {
    await getDb().insert(accountPreferences).values({
      userId, registrationAnalyticsAllowed: allowed, updatedAt,
    }).onConflictDoUpdate({
      target: accountPreferences.userId,
      set: { registrationAnalyticsAllowed: allowed, updatedAt },
    });
  },
  async findAccountPreferences(userId) {
    return (await getDb().select().from(accountPreferences).where(eq(accountPreferences.userId, userId)).limit(1))[0];
  },
  async updateGuideMemory(input) {
    await getDb().insert(accountPreferences).values({
      userId: input.userId,
      readingPreferencesJson: input.readingPreferencesJson,
      guideCompletedAt: input.guideCompletedAt,
      updatedAt: input.updatedAt,
    }).onConflictDoUpdate({
      target: accountPreferences.userId,
      set: {
        readingPreferencesJson: input.readingPreferencesJson,
        guideCompletedAt: input.guideCompletedAt,
        updatedAt: input.updatedAt,
      },
    });
  },
  async clearGuideMemory(userId, updatedAt) {
    await getDb().insert(accountPreferences).values({ userId, updatedAt })
      .onConflictDoUpdate({
        target: accountPreferences.userId,
        set: { readingPreferencesJson: "[]", guideCompletedAt: null, updatedAt },
      });
  },
};
