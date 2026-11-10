import { Component, Fragment, lazy, Suspense, type ReactNode } from "react";

import { errorMessage } from "../../../../src/lib/convex-errors";
import { Loading } from "./loading";

/**
 * `ErrorState` uses Reanimated (its button). Load it when something fails, not when this module is imported: the
 * campaign shell and every route import this file, and screen tests install the Reanimated mock only where they need
 * it. `require` rather than `import()`, which jest cannot run without `--experimental-vm-modules`.
 */
const ErrorState = lazy(() =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Promise.resolve({ default: (require("./error-state") as typeof import("./error-state")).ErrorState }),
);

/** The one error screen: `errorMessage` from the website's `src/lib/convex-errors`, and Try again. */
export function QueryError({ error, onRetry, title }: { error: unknown; onRetry: () => void; title?: string }) {
  return (
    <Suspense fallback={<Loading label="Loading" />}>
      <ErrorState message={errorMessage(error)} onRetry={onRetry} title={title ?? "Something went wrong"} />
    </Suspense>
  );
}

type Props = {
  children: ReactNode;
  /** Heading over the message; a slot names itself ("Fear"), a whole screen keeps the default. */
  title?: string;
};

type State = { error: unknown; attempt: number };

/**
 * The phone's one error boundary around a `useQuery` subtree (rule CL1). It shows `errorMessage` from the website's
 * `src/lib/convex-errors` (the `ConvexError` code's text, never a raw server message) and a Try again button.
 *
 * Try again clears the error and mounts the children afresh (the `attempt` key), so their queries subscribe again
 * and load from the server rather than rendering the error the failed subscription already held.
 */
export class QueryBoundary extends Component<Props, State> {
  override state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("Unknown error") };
  }

  private readonly retry = () => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));
  };

  override render() {
    const { error, attempt } = this.state;
    if (error !== null) return <QueryError error={error} onRetry={this.retry} title={this.props.title} />;
    return <Fragment key={attempt}>{this.props.children}</Fragment>;
  }
}
