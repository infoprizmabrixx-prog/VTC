import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import CoffeeCRMWorkspace from '../components/CoffeeCRMWorkspace';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: false,
    },
  },
});

export default function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position="top-right" toastOptions={{ duration: 3500, style: { background: '#1c1917', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' } }} />
      <CoffeeCRMWorkspace />
    </QueryClientProvider>
  );
}
