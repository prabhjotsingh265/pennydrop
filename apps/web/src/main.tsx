import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { createQueryClient, prefetchDashboard } from './lib/queries.ts';
import { applyInitialTheme } from './lib/theme.ts';
import { router } from './router.tsx';
import './styles.css';

applyInitialTheme();
const queryClient = createQueryClient();
prefetchDashboard(queryClient, window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
