import { lazy, Suspense } from 'react';
import { PaperFilters } from './components/PaperFilters.tsx';
import { LoadingScreen } from './screens/LoadingScreen.tsx';
import { TitleScreen } from './screens/TitleScreen.tsx';
import { ROUTES, useRoute } from './router.ts';

// 3D screens are code-split: the title screen stays light and loads instantly.
const LookdevScreen = lazy(() => import('./screens/LookdevScreen.tsx'));
const BattleScreen = lazy(() => import('./screens/BattleScreen.tsx'));
const CampaignScreen = lazy(() => import('./screens/CampaignScreen.tsx'));
const OptionsScreen = lazy(() => import('./screens/OptionsScreen.tsx'));

function CurrentScreen() {
  const path = useRoute();
  switch (path) {
    case ROUTES.lookdev:
      return <LookdevScreen />;
    case ROUTES.battle:
      return <BattleScreen />;
    case ROUTES.campaign:
      return <CampaignScreen />;
    case ROUTES.options:
      return <OptionsScreen />;
    default:
      return <TitleScreen />;
  }
}

export function App() {
  return (
    <>
      <PaperFilters />
      <Suspense fallback={<LoadingScreen label="Préparation du champ de bataille" />}>
        <CurrentScreen />
      </Suspense>
    </>
  );
}
