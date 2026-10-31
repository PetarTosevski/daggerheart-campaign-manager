// Runs before each suite. Screen tests import React Native Testing Library themselves.
//
// While renderAsPlayer or renderAsGm has a client active, convex/react hooks
// record subscriptions and calls and reject a player touch of a GM function.
// Otherwise the real hooks are used. fear-proof.test.tsx replaces this mock
// for its own file (this setup runs first; that file's jest.mock runs next).
import { jest } from "@jest/globals";

type Hooks = {
  useQuery: (ref: unknown, ...args: unknown[]) => unknown;
  useMutation: (ref: unknown) => (args?: unknown) => unknown;
  useAction: (ref: unknown) => (args?: unknown) => unknown;
  usePaginatedQuery: (ref: unknown, ...args: unknown[]) => unknown;
};

type FakeHooks = Hooks & {
  hasActiveClient: () => boolean;
};

jest.mock("convex/react", () => {
  const actual = jest.requireActual("convex/react") as Hooks;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fake = require("./test/harness/mock-convex-react") as FakeHooks;
  return {
    ...actual,
    useQuery: (ref: unknown, ...args: unknown[]) =>
      fake.hasActiveClient() ? fake.useQuery(ref, ...args) : actual.useQuery(ref, ...args),
    useMutation: (ref: unknown) => (fake.hasActiveClient() ? fake.useMutation(ref) : actual.useMutation(ref)),
    useAction: (ref: unknown) => (fake.hasActiveClient() ? fake.useAction(ref) : actual.useAction(ref)),
    usePaginatedQuery: (ref: unknown, ...args: unknown[]) =>
      fake.hasActiveClient()
        ? fake.usePaginatedQuery(ref, ...args)
        : actual.usePaginatedQuery(ref, ...args),
  };
});
