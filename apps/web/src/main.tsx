import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider } from "antd";
import "antd/dist/reset.css";
import "./styles.css";
import { App } from "./app/App";
import { RootErrorBoundary } from "./app/RootErrorBoundary";
import { AuthGate, AuthProvider } from "./features/auth/AuthProvider";
import { ContextGate } from "./features/foundation/ContextGate";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root application mount point");

createRoot(rootElement).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#145a8d",
          colorInfo: "#145a8d",
          borderRadius: 8,
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <AuthProvider>
        <AuthGate>
          <AntdApp>
            <QueryClientProvider client={queryClient}>
              <ContextGate>
                <RootErrorBoundary>
                  <BrowserRouter>
                    <App />
                  </BrowserRouter>
                </RootErrorBoundary>
              </ContextGate>
            </QueryClientProvider>
          </AntdApp>
        </AuthGate>
      </AuthProvider>
    </ConfigProvider>
  </StrictMode>,
);
