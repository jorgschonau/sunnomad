import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { mixpanel } from '../services/mixpanel';

export function useAppLifecycle() {
  const sessionStart = useRef(Date.now());
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current;
      if (prev === 'active' && (next === 'inactive' || next === 'background')) {
        mixpanel.track('App Backgrounded', {
          session_seconds: Math.round((Date.now() - sessionStart.current) / 1000),
        });
      }
      if ((prev === 'inactive' || prev === 'background') && next === 'active') {
        mixpanel.track('App Foregrounded');
        sessionStart.current = Date.now();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);
}
