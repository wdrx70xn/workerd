// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { strictEqual } from 'node:assert';

export const ctxAccessPropertyExists = {
  test(controller, env, ctx) {
    // When enable_ctx_access is enabled, the property should exist on ctx
    // (as a lazy instance property), even though its value is undefined
    // because setAccess() is only called by the host runtime (edgeworker).
    strictEqual('access' in ctx, true);
    strictEqual(ctx.access, undefined);
  },
};
