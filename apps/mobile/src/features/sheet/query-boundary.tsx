import { Component, type ReactNode } from "react";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { ErrorState } from "../../ui/error-state";

type State = { error: Error | null };

/** Catches a failed query in this screen and offers a retry. */
export class QueryBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorState
        message={errorMessage(error)}
        onRetry={() => this.setState({ error: null })}
        title="Something went wrong"
      />
    );
  }
}
