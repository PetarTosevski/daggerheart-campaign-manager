// Runs before each suite. Screen tests import React Native Testing Library themselves.
//
// While renderAsPlayer or renderAsGm has a client active, convex/react hooks
// record subscriptions and calls and reject a player touch of a GM function.
// Otherwise the real hooks are used. fear-proof.test.tsx replaces this mock
// for its own file (this setup runs first; that file's jest.mock runs next).
import { jest } from "@jest/globals";

jest.mock("react-native-safe-area-context", () => {
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: unknown }) => children,
    SafeAreaView: ({ children }: { children: unknown }) => children,
    useSafeAreaInsets: () => inset,
    initialWindowMetrics: { insets: inset, frame: { x: 0, y: 0, width: 0, height: 0 } },
  };
});

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
