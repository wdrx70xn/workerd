// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Tail worker for the orphaned-span test. Validates that the outcome event for a DO request
// containing an orphaned enterSpan (whose promise never settles) is received promptly,
// rather than being delayed until the actor's IoContext is torn down.
//
// Without the WeakRef<BaseTracer> fix in the SpanSubmitter, the orphaned enterSpan's
// SpanImpl (wrapped in IoOwn on the actor's delete queue) holds a strong addRef(BaseTracer)
// that prevents the BaseTracer destructor from running — delaying the outcome event until
// actor shutdown. With the fix, the submitter holds a WeakRef, so the BaseTracer dies with
// the IncomingRequest and the outcome fires on time.
//
// Detection: the test makes 2 DO requests (one with an orphaned span, one clean). Together
// with the test runner's own invocation, that's 3 outcome events total. With the fix, all 3
// outcomes are emitted promptly (during the main test, before the tail worker's validation
// test grabs the Worker::AsyncLock). Without the fix, the DO outcomes are delayed past the
// point where they can be processed, and the test times out.

import assert from 'node:assert';

const state = {
  totalOutcomes: 0,
};

export default {
  tailStream(event, env, ctx) {
    return (event) => {
      if (event.event.type === 'outcome') {
        state.totalOutcomes++;
      }
    };
  },
};

export const validateOrphanedSpanOutcome = {
  async test() {
    // We expect 3 outcome events: the test runner + /orphan DO request + /ping DO request.
    // Without the fix, the DO outcomes are held open by the orphaned span's strong ref to
    // the BaseTracer on the delete queue. They can't be processed while the validation test
    // holds the tail worker's lock, so the test times out.
    const TIMEOUT_MS = 5000;
    const EXPECTED_OUTCOMES = 3;

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Timed out waiting for outcomes after ${TIMEOUT_MS}ms — only ` +
                `${state.totalOutcomes} of ${EXPECTED_OUTCOMES} arrived. ` +
                `The orphaned enterSpan is likely holding the BaseTracer (and its ` +
                `outcome event) open on the IoContext delete queue.`
            )
          ),
        TIMEOUT_MS
      )
    );

    const waitForOutcomes = async () => {
      while (state.totalOutcomes < EXPECTED_OUTCOMES) {
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    await Promise.race([waitForOutcomes(), timeoutPromise]);

    assert.ok(
      state.totalOutcomes >= EXPECTED_OUTCOMES,
      `Expected at least ${EXPECTED_OUTCOMES} outcomes, got ${state.totalOutcomes}`
    );
  },
};
