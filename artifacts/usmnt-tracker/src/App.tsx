import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Layout } from '@/components/Layout';

import Dashboard from '@/pages/Dashboard';
import Players from '@/pages/Players';
import PlayerProfile from '@/pages/PlayerProfile';
import Fixtures from '@/pages/Fixtures';
import News from '@/pages/News';
import Injuries from '@/pages/Injuries';
import Transfers from '@/pages/Transfers';
import Rankings from '@/pages/Rankings';
import Schedule from '@/pages/Schedule';
import About from '@/pages/About';
import Transparency from '@/pages/Transparency';
import Admin from '@/pages/Admin';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Switch>
      {/* Admin panel — no Layout wrapper, full-page experience */}
      <Route path="/admin" component={Admin} />
      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/players" component={Players} />
            <Route path="/players/:id" component={PlayerProfile} />
            <Route path="/fixtures" component={Fixtures} />
            <Route path="/news" component={News} />
            <Route path="/injuries" component={Injuries} />
            <Route path="/transfers" component={Transfers} />
            <Route path="/rankings" component={Rankings} />
            <Route path="/schedule" component={Schedule} />
            <Route path="/about" component={About} />
            <Route path="/transparency" component={Transparency} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
