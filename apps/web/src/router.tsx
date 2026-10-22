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
import { DemoPage } from './auth/DemoPage.tsx';
import { Forgot } from './auth/Forgot.tsx';
import { Reset } from './auth/Reset.tsx';
import { SignIn } from './auth/SignIn.tsx';
import { SignUp } from './auth/SignUp.tsx';
import { BotPage } from './landing/BotPage.tsx';
import { Landing } from './landing/Landing.tsx';
import { PrivacyPage } from './landing/PrivacyPage.tsx';
import { TermsPage } from './landing/TermsPage.tsx';

export const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/bot', element: <BotPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/terms', element: <TermsPage /> },
  { path: '/signin', element: <SignIn /> },
  { path: '/signup', element: <SignUp /> },
  { path: '/signup/sent', element: <CheckEmail /> },
  { path: '/demo', element: <DemoPage /> },
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
  // The phase-0 design prototype grew into the landing page.
  { path: '/prototype', element: <Navigate to="/" replace /> },
  { path: '*', element: <Navigate to="/app" replace /> },
]);
