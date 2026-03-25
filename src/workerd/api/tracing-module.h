// Copyright (c) 2017-2025 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

#pragma once

#include <workerd/io/io-context.h>

namespace workerd::api {

// JavaScript-accessible span class that manages span ownership through IoContext.
//
// startSpan() creates a JsSpan but does NOT push it into the async context frame.  This
// matches the OTel tracer.startSpan() semantics where a span is created but not made
// "active" in the current context.  Span nesting via the async context frame requires a
// LIFO-safe scope (like withSpan / startActiveSpan); see IoContext::pushUserTraceSpan().
class JsSpan: public jsg::Object {
 public:
  JsSpan(kj::Maybe<IoOwn<TraceContext>> span);
  ~JsSpan() noexcept(false);

  // Ends the span, marking its completion. Once ended, the span cannot be modified.
  // If the span is not explicitly ended, it will be automatically ended when the
  // JsSpan object is destroyed.
  void end();
  // Sets an attribute on the span. Values can be string, number, boolean, or undefined.
  // If undefined is passed, the attribute is not set (allows optional chaining).
  // Note: We intentionally don't support BigInt/int64_t. JavaScript numbers (doubles)
  // are sufficient for most tracing use cases, and BigInt conversion to int64_t would
  // require handling truncation for values outside the int64_t range.
  void setAttribute(
      jsg::Lock& js, kj::String key, jsg::Optional<kj::OneOf<bool, double, kj::String>> value);

  JSG_RESOURCE_TYPE(JsSpan) {
    JSG_METHOD(end);
    JSG_METHOD(setAttribute);
    JSG_DISPOSE(end);
  }

 private:
  kj::Maybe<IoOwn<TraceContext>> span;
};

// Module that provides tracing capabilities for Workers.
// This module is available as "cloudflare-internal:tracing" and provides
// functionality to create and manage tracing spans.
class TracingModule: public jsg::Object {
 public:
  TracingModule() = default;
  TracingModule(jsg::Lock&, const jsg::Url&) {}

  // Creates a new tracing span with the given name but does NOT make it the active span
  // in the current async context.  This matches the OTel tracer.startSpan() semantics.
  // The caller is responsible for ending the span.  Child spans created while this span
  // is alive will NOT automatically inherit it as their parent — use startActiveSpan()
  // for that.
  jsg::Ref<JsSpan> startSpan(jsg::Lock& js, kj::String name);

  // Creates a new tracing span, makes it the active span in the current async context
  // for the duration of the callback, and returns the callback's result.  This matches
  // the OTel tracer.startActiveSpan() semantics.
  //
  // The span's user SpanParent is pushed into userTraceAsyncContextKey via a stack-scoped
  // StorageScope.  While the callback executes synchronously, getCurrentUserTraceSpan()
  // returns this span, so any nested makeUserTraceSpan() calls (e.g. from fetch
  // subrequests) inherit it as their parent.  The scope is destroyed when the callback
  // returns (LIFO-safe).  For async callbacks, V8's continuation-preserved embedder data
  // mechanism captures the frame at await points, so async continuations also see the
  // correct parent.
  //
  // The caller is still responsible for ending the span (typically in a finally block
  // inside the callback).
  //
  // Example usage:
  //   const result = tracing.startActiveSpan("my-op", (span) => {
  //     try {
  //       return doWork();
  //     } finally {
  //       span.end();
  //     }
  //   });
  jsg::Value startActiveSpan(
      jsg::Lock& js, kj::String name, jsg::Function<jsg::Value(jsg::Ref<JsSpan>)> fn);

  JSG_RESOURCE_TYPE(TracingModule) {
    JSG_METHOD(startSpan);
    JSG_METHOD(startActiveSpan);

    JSG_NESTED_TYPE(JsSpan);
  }
};

template <class Registry>
void registerTracingModule(Registry& registry, CompatibilityFlags::Reader flags) {
  registry.template addBuiltinModule<TracingModule>(
      "cloudflare-internal:tracing", workerd::jsg::ModuleRegistry::Type::INTERNAL);
}

template <typename TypeWrapper>
kj::Own<jsg::modules::ModuleBundle> getInternalTracingModuleBundle(auto featureFlags) {
  jsg::modules::ModuleBundle::BuiltinBuilder builder(
      jsg::modules::ModuleBundle::BuiltinBuilder::Type::BUILTIN_ONLY);
  static const auto kSpecifier = "cloudflare-internal:tracing"_url;
  builder.addObject<TracingModule, TypeWrapper>(kSpecifier);
  return builder.finish();
}
};  // namespace workerd::api

#define EW_TRACING_MODULE_ISOLATE_TYPES api::TracingModule, api::JsSpan
