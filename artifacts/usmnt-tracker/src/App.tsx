import React, { Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Layout } from '@/components/Layout';
import { MyPlayersProvider } from '@/context/MyPlayersContext';

// Admin pages stay eagerly loaded — they live outside the Layout wrapper and are
// used infrequently, so the lazy-load flash would be more disruptive than the
// tiny bundle cost of always including them.
import Admin from '@/pages/Admin';
import AdminReviewQueue from '@/pages/AdminReviewQueue';

// All other pages are lazy-loaded so each route's JS only parses on first
// navigation, reducing initial bundle parse time. The service worker
// pre-caches the resulting chunks in the background after first load.
const Dashboard    = React.lazy(() => import('@/pages/Dashboard'));
const Players      = React.lazy(() => import('@/pages/Players'));
const PlayerProfile = React.lazy(() => import('@/pages/PlayerProfile'));
const Fixtures     = React.lazy(() => import('@/pages/Fixtures'));
const MatchDetail  = React.lazy(() => import('@/pages/MatchDetail'));
const News         = React.lazy(() => import('@/pages/News'));
const Injuries     = React.lazy(() => import('@/pages/Injuries'));
const Transfers    = React.lazy(() => import('@/pages/Transfers'));
const Rankings     = React.lazy(() => import('@/pages/Rankings'));
const Schedule     = React.lazy(() => import('@/pages/Schedule'));
const About        = React.lazy(() => import('@/pages/About'));
const Transparency = React.lazy(() => import('@/pages/Transparency'));
const Recover      = React.lazy(() => import('@/pages/Recover'));
const NotFound     = React.lazy(() => import('@/pages/not-found'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 5 * 60 * 1000,
      // Keep cached data in memory for 30 minutes after the last subscriber
      // unmounts. This means returning to any recently-visited page within
      // half an hour renders instantly from cache rather than re-fetching.
      gcTime: 30 * 60 * 1000,
      retry: 1,
    },
  },
});

/** Minimal in-app spinner shown while a lazy page chunk loads. */
function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* Admin pages — no Layout wrapper, full-page experience */}
      <Route path="/admin" component={Admin} />
      <Route path="/admin/review" component={AdminReviewQueue} />
      <Route>
        <Layout>
          <Suspense fallback={<PageFallback />}>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/players" component={Players} />
              <Route path="/players/:id" component={PlayerProfile} />
              <Route path="/fixtures" component={Fixtures} />
              <Route path="/matches/:id" component={MatchDetail} />
              <Route path="/news" component={News} />
              <Route path="/injuries" component={Injuries} />
              <Route path="/transfers" component={Transfers} />
              <Route path="/rankings" component={Rankings} />
              <Route path="/schedule" component={Schedule} />
              <Route path="/about" component={About} />
              <Route path="/transparency" component={Transparency} />
              <Route path="/recover" component={Recover} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MyPlayersProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
          <SonnerToaster />
        </TooltipProvider>
      </MyPlayersProvider>
    </QueryClientProvider>
  );
}

export default App;
