// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Tests that an orphaned enterSpan (whose promise never settles) on a Durable Object
// does NOT delay the outcome event for the request. This exercises the actor-specific
// lifetime issue: on actors, IoOwn objects live on the delete queue until actor shutdown,
// so if an orphaned span's observer chain holds a strong ref to the BaseTracer, the
// outcome event is delayed until actor shutdown instead of firing at request end.
//
// The test makes two sequential requests to the same DO instance (same IoContext).
// Request 1 creates an orphaned enterSpan. Request 2 is a simple ping. The tail worker
// validates that all outcome events are received promptly — i.e., the orphaned span
// did not hold the outcome open.

import assert from 'node:assert';
import { DurableObject } from 'cloudflare:workers';

export class OrphanedSpanDO extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const { tracing } = await import('cloudflare:workers');

    if (url.pathname === '/orphan') {
      // Create an enterSpan whose callback returns a promise that never settles.
      // We do NOT await the result — the handler returns normally, but the span's
      // promise is abandoned, leaving the SpanImpl (and its observer chain) orphaned.
      tracing.enterSpan('orphaned-span', async (span) => {
        span.setAttribute('case', 'orphanedSpan');
        span.setAttribute('request', 'first');
        // This promise never settles.
        await new Promise(() => {});
      });

      return new Response('ok-orphan');
    }

    if (url.pathname === '/ping') {
      tracing.enterSpan('ping-span', (span) => {
        span.setAttribute('case', 'orphanedSpan');
        span.setAttribute('request', 'second');
      });
      return new Response('ok-ping');
    }

    return new Response('not found', { status: 404 });
  }
}

export default {
  async test(ctrl, env, ctx) {
    const id = env.ns.idFromName('orphaned-span-test');
    const stub = env.ns.get(id);

    // Request 1: creates an orphaned enterSpan
    const resp1 = await stub.fetch('http://do/orphan');
    assert.strictEqual(resp1.status, 200);
    assert.strictEqual(await resp1.text(), 'ok-orphan');

    // Request 2: simple ping to the same DO instance
    const resp2 = await stub.fetch('http://do/ping');
    assert.strictEqual(resp2.status, 200);
    assert.strictEqual(await resp2.text(), 'ok-ping');
  },
};
