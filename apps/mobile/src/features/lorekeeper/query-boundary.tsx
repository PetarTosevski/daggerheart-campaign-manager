import { Component, type ReactNode } from "react";

import { ErrorState } from "../../ui/error-state";

type State = { failed: boolean; message: string };

export class LorekeeperSlotBoundary extends Component<{ children: ReactNode; label: string }, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState
        message={this.state.message || `${this.props.label} failed to load.`}
        onRetry={() => this.setState({ failed: false, message: "" })}
        title={this.props.label}
      />
    );
  }
}
