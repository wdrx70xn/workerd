// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import tracing from 'cloudflare-internal:tracing';

export type Span = ReturnType<typeof tracing.startSpan>;

/**
 * Helper function to wrap operations with tracing spans.
 * Automatically handles span lifecycle for both sync and async operations.
 *
 * @param name - The operation name for the span
 * @param fn - The function to execute within the span context
 * @returns The result of the function
 *
 * @example
 * // Synchronous usage
 * const result = withSpan('prepare', (span) => {
 *   span.setAttribute('query', sql);
 *   return new PreparedStatement(sql);
 * });
 *
 * @example
 * // Asynchronous usage
 * const result = await withSpan('exec', async (span) => {
 *   span.setAttribute('query', sql);
 *   return await database.execute(sql);
 * });
 *
 * @note Generator functions are not currently supported and will have their
 * spans ended immediately after the generator object is returned, not when
 * the generator is exhausted.
 */
export function withSpan<T>(
  name: string,
  fn: (span: ReturnType<typeof tracing.startSpan>) => T
): T {
  // Use startActiveSpan to push the span into the async context frame for the duration
  // of fn.  This ensures that child spans created inside fn (e.g. from fetch subrequests)
  // automatically inherit this span as their parent.  The StorageScope that seeds the
  // frame lives on the C++ stack inside startActiveSpan, guaranteeing LIFO destruction.
  // V8's continuation-preserved embedder data captures the frame at await points, so
  // async continuations inside fn also see the correct parent.
  return tracing.startActiveSpan(name, (span) => {
    try {
      const result = fn(span);

      // Handle async results - ensure span ends after completion
      if (result instanceof Promise) {
        return Promise.resolve(result).finally(() => {
          span.end();
        }) as T;
      }

      // Synchronous result - end span immediately
      span.end();
      return result;
    } catch (error) {
      span.end();
      throw error;
    }
  });
}
