declare module "node:test" {
  const test: (name: string, fn: () => void | Promise<void>) => void;
  export default test;
}

declare module "node:assert/strict" {
  const assert: {
    equal: (actual: unknown, expected: unknown) => void;
    ok: (value: unknown) => void;
    match: (value: string, regexp: RegExp) => void;
    throws: (fn: () => unknown, error?: (error: unknown) => boolean) => void;
    rejects: (
      fn: () => Promise<unknown>,
      error?: (error: unknown) => boolean,
    ) => Promise<void>;
  };
  export default assert;
}
