import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Result } from "antd";

type RootErrorBoundaryProps = { children: ReactNode };
type RootErrorBoundaryState = { error: Error | null };

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Unhandled application error", { error, errorInfo });
  }

  render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title="应用遇到未处理错误"
          subTitle="业务数据没有被静默修改。请重试；如果持续失败，请携带 requestId 联系维护者。"
          extra={
            <Button
              onClick={() => {
                window.location.reload();
              }}
            >
              重新加载
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
