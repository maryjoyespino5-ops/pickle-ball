import { Component } from "react";
import { Link } from "react-router-dom";

/**
 * M9: Top-level error boundary. A render/runtime error in any page would
 * otherwise blank the whole SPA. This catches it, logs it, and shows a calm
 * recovery screen that keeps the user's session (no logout on error).
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.handleReload = this.handleReload.bind(this);
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Keep a breadcrumb for debugging without exposing it to the user.
    console.error("Unhandled UI error", error, info?.componentStack);
  }

  handleReload() {
    this.setState({ hasError: false });
    window.location.reload();
  }

  handleReset() {
    this.setState({ hasError: false });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="error-boundary-page">
        <section className="error-boundary-card">
          <span className="eyebrow">SOMETHING WENT WRONG</span>
          <h1>
            We hit a snag on <em>this page.</em>
          </h1>
          <p>
            Your account and bookings are safe. Try reloading — if it keeps
            happening, head back to the home page and try again.
          </p>
          <div className="error-boundary-actions">
            <button
              className="button"
              type="button"
              onClick={this.handleReload}>
              Reload the page
            </button>
            <Link className="button outline" to="/" onClick={this.handleReset}>
              Back to home
            </Link>
          </div>
        </section>
      </main>
    );
  }
}
