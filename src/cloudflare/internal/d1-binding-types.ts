// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  DUPLICATED FILE — keep in sync with the D1 eyeball worker
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Source of truth lives in the D1 monorepo at
 * `workers/shared/src/d1-binding-types.ts`. workerd is OSS and cannot depend
 * on `d1-shared`, so the types are duplicated verbatim.
 *
 * When editing: update the D1 copy in the same MR, and do NOT rename or
 * retype existing fields (breaks the live wire during rolling deploys). Add
 * new optional fields instead. Bump `D1_BINDING_WIRE_VERSION` only once this
 * has shipped to production.
 *
 * This copy deliberately omits `D1BindingProps` — workerd is the caller of
 * this RPC surface, never the callee; `ctx.props` is an EWC/eyeball concern
 * and has no consumer on the workerd side.
 */

/**
 * Wire format version. Diagnostic only — not used for runtime dispatch, since
 * the wire contract is additive-only.
 */
export const D1_BINDING_WIRE_VERSION = 1;

/** A single statement in a batch. Same shape as the HTTP wire's body entries. */
export interface D1RpcStatement {
  sql: string;
  params: unknown[];
}

/**
 * Request payload for `D1BindingInterface.query()` and `execute()`.
 *
 * `accountId` / `databaseId` are deliberately NOT on the wire — they come
 * from `ctx.props` (EWC-stamped, unforgeable). Accepting them here would let
 * any user Worker claim to be any account.
 *
 * `resultsFormat` is deliberately NOT on the wire — the RPC path is always
 * `ROWS_AND_COLUMNS` for `query()` and implicitly `NONE` for `execute()`.
 *
 * `isReadOnly` is deliberately NOT on the wire — the eyeball infers it from
 * the parsed SQL (same as HTTP today).
 */
export interface D1RpcRequest {
  /**
   * One or more SQL statements. Single-statement callers wrap in a
   * one-element array so batch and single paths share one wire shape.
   */
  statements: D1RpcStatement[];

  /**
   * Session commit token or session constraint. Same semantics as today's
   * `x-cf-d1-session-commit-token` HTTP header:
   *   - `""`                     → no session (always primary)
   *   - `"first-primary"`        → first query to primary, then sessioned
   *   - `"first-unconstrained"`  → first query anywhere, then sessioned
   *   - any other string         → a specific bookmark to satisfy
   */
  bookmarkOrConstraint: string;
}

/** Rows-and-columns result shape. Each row is an array parallel to `columns`. */
export interface D1RowsAndColumns<T = unknown> {
  columns: string[];
  rows: T[][];
}

/**
 * Per-statement metadata. Mirrors workerd's `D1Meta` in `d1-api.ts` verbatim
 * so customers see the same `meta` object across HTTP and RPC transports.
 */
export interface D1RpcStatementMeta {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;

  /** Region of the DO instance that executed the query. */
  served_by_region?: string;

  /** True iff the DO instance that executed the query was the primary. */
  served_by_primary?: boolean;

  timings?: {
    /** SQL-only execution time on the DO, excluding network latency. */
    sql_duration_ms: number;
  };

  /** Total attempts including retries, populated by the eyeball. */
  total_attempts?: number;
}

/**
 * Per-statement result inside a batch response:
 *
 * - `query()`:   `{ success: true, meta, results: D1RowsAndColumns }`
 * - `execute()`: `{ success: true, meta }` (no `results`)
 * - error:       `{ success: false, error, isUserCaused? }`
 *
 * Errors are returned **in-band** (not thrown) so `isUserCaused` and the
 * `D1_ERROR:` prefix convention reach workerd/edge-api intact.
 */
export type D1RpcStatementResult<T = unknown> =
  | { success: true; meta: D1RpcStatementMeta; results: D1RowsAndColumns<T> }
  | { success: true; meta: D1RpcStatementMeta }
  | { success: false; error: string; isUserCaused?: boolean };

/**
 * Response payload from `D1BindingInterface.query()` / `execute()`.
 *
 * On success, `results.length === request.statements.length` (one slot per
 * statement). On failure, `results` is a **single-element array** with the
 * failure variant — the DO runs batches atomically via `transactionSync`,
 * so a single failure rolls back the whole batch and no earlier statements
 * commit. Workerd's shim consumes this shape via `firstIfArray(results)` +
 * a throw on `results[0].success === false` inside `_sendOrThrow`.
 */
export interface D1RpcBatchResponse<T = unknown> {
  results: D1RpcStatementResult<T>[];

  /**
   * Updated session commit token after the batch committed. `null` on
   * early-return branches that historically did not stamp the bookmark
   * header (deleted DB, resetting DB, long-running task,
   * replica-import-in-progress).
   */
  bookmark: string | null;
}

/**
 * JSRPC surface exposed by the D1 eyeball to user Worker bindings.
 * Implemented as `D1Binding` in `workers/v3/src/eyeball_v3.ts` (D1 monorepo),
 * consumed by `d1-api.ts` via the `EyeballRpcStub` type alias.
 *
 * `dump()` is intentionally absent — deprecated v1-alpha API, stays on
 * HTTP via the inherited `.fetch()` handler.
 */
export interface D1BindingInterface {
  /** Execute statement(s) and return rows. HTTP equivalent: `/query?resultsFormat=ROWS_AND_COLUMNS`. */
  query<T = unknown>(req: D1RpcRequest): Promise<D1RpcBatchResponse<T>>;

  /** Execute statement(s) without returning rows. HTTP equivalent: `/execute`. */
  execute<T = unknown>(req: D1RpcRequest): Promise<D1RpcBatchResponse<T>>;
}
