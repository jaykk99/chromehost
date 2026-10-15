import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMsg: string;
}

class ErrorBoundary extends Component<Props, State> {
  // `declare props: Props;` is not necessary as props are already typed in Component<Props, State>
  public state: State = {
    hasError: false,
    errorMsg: ""
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMsg: error.message + "\n" + error.stack };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        // Using Tailwind CSS classes for styling instead of inline styles
        // for better consistency with the rest of the application's UI.
        <div className="p-5 text-red-500 font-mono absolute inset-0 bg-neutral-950 flex flex-col items-center justify-center">
          <h1 className="text-xl font-bold mb-4">React Runtime Error Caught</h1>
          <pre className="whitespace-pre-wrap bg-neutral-900 border border-neutral-800 p-4 rounded-lg text-sm text-red-400 max-h-[70vh] overflow-auto w-full max-w-2xl">
            {this.state.errorMsg}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;