import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiRequestError } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui';
import { App } from './App';

import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
// Last, so its overrides win without needing higher specificity.
import '@/styles/responsive.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data here is edited by colleagues throughout the day, so a short stale
      // window plus refetch-on-focus keeps a returning tab honest without
      // hammering the API.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Retrying a 403 or a 422 just repeats a refusal. Only transient
        // failures are worth another attempt.
        if (error instanceof ApiRequestError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
