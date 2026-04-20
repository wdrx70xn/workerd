// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// JSRPC mock for the D1 eyeball's `D1Binding` WorkerEntrypoint. Exposes
// `.query()` / `.execute()` in the shape defined by `d1-binding-types.ts`
// and delegates storage + commit-token bookkeeping to the existing HTTP
// `d1-mock` service (`env.d1Mock.fetch(...)`). Delegating rather than
// re-implementing keeps both transports:
//
//  - hitting the same `D1MockDO` SQLite state (via the shared DO namespace
//    that `d1-mock` owns), and
//  - sharing the same `commitTokensReceived` / `commitTokensReturned`
//    accumulator used by the session-API tests.
//
// Inherits `.fetch()` from `WorkerEntrypoint`, which `d1-api.ts` still uses
// for `dump()` (not under test here — included for completeness so a test
// that calls `dump()` through the RPC binding doesn't blow up).

import { WorkerEntrypoint } from 'cloudflare:workers';

export class D1RpcMock extends WorkerEntrypoint {
  async query(req) {
    return await this._run(req, 'ROWS_AND_COLUMNS', '/query');
  }

  async execute(req) {
    return await this._run(req, 'NONE', '/execute');
  }

  // Defer to the HTTP mock for actual SQL execution and commit-token
  // stamping; translate the HTTP response shape into the RPC wire shape.
  async _run(req, resultsFormat, path) {
    const url = new URL(`http://d1-mock${path}`);
    url.searchParams.set('resultsFormat', resultsFormat);

    const headers = { 'content-type': 'application/json' };
    if (req.bookmarkOrConstraint) {
      headers['x-cf-d1-session-commit-token'] = req.bookmarkOrConstraint;
    }

    // The HTTP mock accepts either a single statement object or an array.
    // Match that so the shared `commitTokensReceived` tracker sees the same
    // request shape it would see from the HTTP path.
    const body =
      req.statements.length === 1 ? req.statements[0] : req.statements;

    const resp = await this.env.d1Mock.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const bookmark = resp.headers.get('x-cf-d1-session-commit-token');
    const parsed = await resp.json();
    const slots = Array.isArray(parsed) ? parsed : [parsed];

    return {
      bookmark,
      results: slots.map((s) => {
        if (!s.success) {
          return { success: false, error: s.error };
        }
        if (resultsFormat === 'NONE') {
          return { success: true, meta: s.meta };
        }
        // `ROWS_AND_COLUMNS`: `D1MockDO.runQuery` already emits
        // `{columns, rows}` — pass through verbatim.
        return { success: true, meta: s.meta, results: s.results };
      }),
    };
  }
}
