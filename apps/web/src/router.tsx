import { createBrowserRouter, Navigate } from 'react-router';
import { AddPage } from './app/add/AddPage.tsx';
import { AlertsPage } from './app/AlertsPage.tsx';
import { ChannelsPage } from './app/ChannelsPage.tsx';
import { ChecksPage } from './app/ChecksPage.tsx';
import { ComparePage } from './app/ComparePage.tsx';
import { GroupsPage } from './app/GroupsPage.tsx';
import { ProductPage } from './app/product/ProductPage.tsx';
import { RequireAuth } from './app/RequireAuth.tsx';
import { SettingsPage } from './app/SettingsPage.tsx';
import { Shell } from './app/Shell.tsx';
import { SitesPage } from './app/SitesPage.tsx';
import { WatchlistPage } from './app/WatchlistPage.tsx';
import { CheckEmail } from './auth/CheckEmail.tsx';
import { Forgot } from './auth/Forgot.tsx';
import { Reset } from './auth/Reset.tsx';
import { SignIn } from './auth/SignIn.tsx';
import { SignUp } from './auth/SignUp.tsx';
import { Prototype } from './prototype/Prototype.tsx';

export const router = createBrowserRouter([
  // The landing page arrives with the demo; until then, straight to the dashboard.
  { path: '/', element: <Navigate to="/app" replace /> },
  { path: '/signin', element: <SignIn /> },
  { path: '/signup', element: <SignUp /> },
  { path: '/signup/sent', element: <CheckEmail /> },
  { path: '/forgot', element: <Forgot /> },
  { path: '/reset', element: <Reset /> },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <Shell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <WatchlistPage /> },
      { path: 'add', element: <AddPage /> },
      { path: 'p/:id', element: <ProductPage /> },
      { path: 'sites', element: <SitesPage /> },
      { path: 'checks', element: <ChecksPage /> },
      { path: 'groups', element: <GroupsPage /> },
      { path: 'groups/:id', element: <ComparePage /> },
      { path: 'alerts', element: <AlertsPage /> },
      { path: 'channels', element: <ChannelsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '/prototype', element: <Prototype /> },
  { path: '*', element: <Navigate to="/app" replace /> },
]);
