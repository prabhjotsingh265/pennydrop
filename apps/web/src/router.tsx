import { createBrowserRouter, Navigate } from 'react-router';
import { RequireAuth } from './app/RequireAuth.tsx';
import { Shell } from './app/Shell.tsx';
import { WatchlistPage } from './app/WatchlistPage.tsx';
import { CheckEmail } from './auth/CheckEmail.tsx';
import { SignIn } from './auth/SignIn.tsx';
import { SignUp } from './auth/SignUp.tsx';
import { Prototype } from './prototype/Prototype.tsx';

export const router = createBrowserRouter([
  // The landing page arrives with the demo; until then, straight to the dashboard.
  { path: '/', element: <Navigate to="/app" replace /> },
  { path: '/signin', element: <SignIn /> },
  { path: '/signup', element: <SignUp /> },
  { path: '/signup/sent', element: <CheckEmail /> },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <Shell />
      </RequireAuth>
    ),
    children: [{ index: true, element: <WatchlistPage /> }],
  },
  { path: '/prototype', element: <Prototype /> },
  { path: '*', element: <Navigate to="/app" replace /> },
]);
