// Copyright (c) 2024 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// TODO(cleanup): C++ built-in modules do not yet support named exports, so we must define this
//   wrapper module that simply re-exports the classes from the built-in module.

import entrypoints from 'cloudflare-internal:workers';
import innerEnv from 'cloudflare-internal:env';
import innerTracing from 'cloudflare-internal:tracing';

export const WorkerEntrypoint = entrypoints.WorkerEntrypoint;
export const DurableObject = entrypoints.DurableObject;
export const RpcStub = entrypoints.RpcStub;
export const RpcPromise = entrypoints.RpcPromise;
export const RpcProperty = entrypoints.RpcProperty;
export const RpcTarget = entrypoints.RpcTarget;
export const ServiceStub = entrypoints.ServiceStub;


type StepStub = { do: (...args: unknown[]) => Promise<unknown> };
type StepCallback = (ctx: unknown, dedupName: string) => unknown;

class WorkflowEntrypointImpl extends entrypoints.WorkflowEntrypoint {
  // @ts-expect-error TS-private but callable via RPC; same convention as pipeline-transform.ts.
  // eslint-disable-next-line no-restricted-syntax
  private async _run_step(event: unknown, step: object): Promise<unknown> {
    const tracedStep = new Proxy(step, {
      get(target, prop, receiver): unknown {
        if (prop !== 'do') {
          return Reflect.get(target, prop, receiver);
        }
        const stub = target as StepStub;
        return (name: unknown, ...rest: unknown[]): Promise<unknown> => {
          // `step.do(name, config?, callback)`: callback is always the last argument.
          const userCb = rest[rest.length - 1] as StepCallback;
          rest[rest.length - 1] = (ctx: unknown, dedupName: string): unknown =>
            innerTracing.enterSpan('workflow_step_do', (span) => {
              span.setAttribute('cloudflare.workflow.step.name', String(name));
              span.setAttribute('cloudflare.workflow.step.unique_name', dedupName);
              return userCb(ctx, dedupName);
            });
          return stub.do(name, ...rest);
        };
      },
    });

    return (
      this as unknown as { run: (e: unknown, s: unknown) => Promise<unknown> }
    ).run(event, tracedStep);
  }
}

export const WorkflowEntrypoint = WorkflowEntrypointImpl;

export function withEnv(newEnv: unknown, fn: () => unknown): unknown {
  return innerEnv.withEnv(newEnv, fn);
}

export function withExports(newExports: unknown, fn: () => unknown): unknown {
  return innerEnv.withExports(newExports, fn);
}

export function withEnvAndExports(
  newEnv: unknown,
  newExports: unknown,
  fn: () => unknown
): unknown {
  return innerEnv.withEnvAndExports(newEnv, newExports, fn);
}

// A proxy for the workers env/bindings. Since env is imported as a module-level
// reference, the object identity cannot be changed. The proxy provides indirection,
// delegating to different underlying env objects based on async context (see withEnv()).
// Mutations via this proxy modify the current underlying env object in-place - if you're
// inside a withEnv() scope, mutations affect the override object, not the base environment.
export const env = new Proxy(
  {},
  {
    get(_: unknown, prop: string | symbol): unknown {
      const inner = innerEnv.getCurrentEnv();
      if (inner) {
        return Reflect.get(inner, prop);
      }
      return undefined;
    },

    set(_: unknown, prop: string | symbol, newValue: unknown): boolean {
      const inner = innerEnv.getCurrentEnv();
      if (inner) {
        return Reflect.set(inner, prop, newValue);
      }
      return true;
    },

    has(_: unknown, prop: string | symbol): boolean {
      const inner = innerEnv.getCurrentEnv();
      if (inner) {
        return Reflect.has(inner, prop);
      }
      return false;
    },

    ownKeys(_: unknown): ArrayLike<string | symbol> {
      const inner = innerEnv.getCurrentEnv();
      if (inner) {
        return Reflect.ownKeys(inner);
      }
      return [];
    },

    deleteProperty(_: unknown, prop: string | symbol): boolean {
      const inner = innerEnv.getCurrentEnv();
      if (inner) {
        return Reflect.deleteProperty(inner, prop);
      }
      return true;
    },

    defineProperty(
      _: unknown,
      prop: string | symbol,
      attr: PropertyDescriptor
    ): boolean {
      const inner = innerEnv.getCurrentEnv();
      if (inner) {
        return Reflect.defineProperty(inner, prop, attr);
      }
      return true;
    },

    getOwnPropertyDescriptor(
      _: unknown,
      prop: string | symbol
    ): PropertyDescriptor | undefined {
      const inner = innerEnv.getCurrentEnv();
      if (inner) {
        return Reflect.getOwnPropertyDescriptor(inner, prop);
      }
      return undefined;
    },
  }
);

// A proxy for the worker exports. Since exports is imported as a module-level
// reference, the object identity cannot be changed. The proxy provides indirection,
// delegating to different underlying exports objects based on async context (see
// withExports()). This proxy is read-only - mutations are not supported.
export const exports = new Proxy(
  {},
  {
    get(_: unknown, prop: string | symbol): unknown {
      const inner = innerEnv.getCurrentExports();
      if (inner) {
        return Reflect.get(inner, prop);
      }
      return undefined;
    },

    has(_: unknown, prop: string | symbol): boolean {
      const inner = innerEnv.getCurrentExports();
      if (inner) {
        return Reflect.has(inner, prop);
      }
      return false;
    },

    ownKeys(_: unknown): ArrayLike<string | symbol> {
      const inner = innerEnv.getCurrentExports();
      if (inner) {
        return Reflect.ownKeys(inner);
      }
      return [];
    },

    getOwnPropertyDescriptor(
      _: unknown,
      prop: string | symbol
    ): PropertyDescriptor | undefined {
      const inner = innerEnv.getCurrentExports();
      if (inner) {
        return Reflect.getOwnPropertyDescriptor(inner, prop);
      }
      return undefined;
    },
  }
);

export const waitUntil = entrypoints.waitUntil.bind(entrypoints);

// A proxy for the worker's cache context (ctx.cache). Since cache is imported as a module-level
// reference, the object identity cannot be changed. The proxy provides indirection, delegating
// to the current request's CacheContext. This ensures that cache remains entrypoint specific
// ensuring that the runtime always delegates the right host to clear.
export const cache = new Proxy(
  {},
  {
    get(_: unknown, prop: string | symbol): unknown {
      const inner = entrypoints.getCtxCache();
      if (inner) {
        const value: unknown = Reflect.get(inner, prop);
        // Bind methods to the underlying CacheContext so that `this` is correct
        // when calling e.g. cache.purge() through the proxy.
        if (typeof value === 'function') {
          return Function.prototype.bind.call(value, inner);
        }
        return value;
      }
      // Used to enable safe no-op access outside module init.
      return undefined;
    },

    has(_: unknown, prop: string | symbol): boolean {
      const inner = entrypoints.getCtxCache();
      if (inner) {
        return Reflect.has(inner, prop);
      }
      return false;
    },

    ownKeys(_: unknown): ArrayLike<string | symbol> {
      const inner = entrypoints.getCtxCache();
      if (inner) {
        return Reflect.ownKeys(inner);
      }
      return [];
    },

    getOwnPropertyDescriptor(
      _: unknown,
      prop: string | symbol
    ): PropertyDescriptor | undefined {
      const inner = entrypoints.getCtxCache();
      if (inner) {
        return Reflect.getOwnPropertyDescriptor(inner, prop);
      }
      return undefined;
    },
  }
);

export const tracing = innerTracing;
