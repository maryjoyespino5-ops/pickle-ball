import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { SubscriptionProvider } from "./context/SubscriptionContext";
import { ScrollToTop } from "./components/common/ScrollToTop";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { AppRoutes } from "./routes/AppRoutes";

function App() {
  return (
    <AuthProvider>
      <SubscriptionProvider>
        <BrowserRouter>
          <ScrollToTop />
          <ErrorBoundary>
            <AppRoutes />
          </ErrorBoundary>
        </BrowserRouter>
      </SubscriptionProvider>
    </AuthProvider>
  );
}
export default App;
