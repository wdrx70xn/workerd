// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export class Span {
  // Sets an attribute on this span. If value is undefined, the attribute is not set.
  setAttribute(key: string, value: string | number | boolean | undefined): void;
  // Closes the span
  end(): void;
}

// Creates a span without making it active in the current async context.
// Child spans created while this span exists will NOT automatically inherit it as parent.
function startSpan(name: string): Span;

// Creates a span, makes it active in the current async context for the duration of fn,
// and returns fn's result.  Child spans created inside fn (e.g. from fetch subrequests)
// will automatically inherit this span as their parent.  The caller must still end() the
// span (typically in a finally block inside fn).
function startActiveSpan<T>(name: string, fn: (span: Span) => T): T;
