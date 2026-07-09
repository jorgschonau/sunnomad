import 'react-native-gesture-handler';
import 'react-native-get-random-values';
import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { View, Image, Text, StyleSheet, Animated, Easing, ActivityIndicator, Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, Yellowtail_400Regular } from '@expo-google-fonts/yellowtail';
import * as Sentry from '@sentry/react-native';
import Toast from 'react-native-toast-message';
import { mixpanel, initMixpanel } from './src/services/mixpanel';
import { useAppLifecycle } from './src/hooks/useAppLifecycle';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
});
initMixpanel().then(() => mixpanel.track('App Opened'));
import MapScreen from './src/ui/screens/MapScreen';
import SettingsScreen from './src/ui/screens/SettingsScreen';
import CommunityScreen from './src/ui/screens/CommunityScreen';
const DestinationDetailScreen = React.lazy(() => import('./src/ui/screens/DestinationDetailScreen'));

function DestinationDetailRoute(props) {
  return (
    <Suspense
      fallback={
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F0EB' }}>
          <ActivityIndicator size="large" color="#C87840" />
        </View>
      }
    >
      <DestinationDetailScreen {...props} />
    </Suspense>
  );
}
import FavouritesScreen from './src/ui/screens/FavouritesScreen';
import LoginScreen from './src/ui/screens/LoginScreen';
import RegisterScreen from './src/ui/screens/RegisterScreen';
import ForgotPasswordScreen from './src/ui/screens/ForgotPasswordScreen';
import ResetPasswordScreen from './src/ui/screens/ResetPasswordScreen';
import ProfileScreen from './src/ui/screens/ProfileScreen';
import FeedbackScreen from './src/ui/screens/FeedbackScreen';

import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { UnitProvider } from './src/contexts/UnitContext';
import { startLocationPreload } from './src/utils/locationPreload';
import './src/i18n';
import { useTranslation } from 'react-i18next';

const AuthStack = createStackNavigator();
const AppStack = createStackNavigator();

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: false, duration: 0 });

function AuthNavigator() {
  const { theme } = useTheme();
  const { t } = useTranslation();

  return (
    <AuthStack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.background,
        },
        headerTintColor: theme.text,
        headerTitleStyle: {
          fontWeight: '600',
        },
      }}
    >
      <AuthStack.Screen
        name="Login"
        component={LoginScreen}
        options={{
          title: t('auth.login'),
          headerShown: false,
        }}
      />
      <AuthStack.Screen
        name="Register"
        component={RegisterScreen}
        options={{
          title: t('auth.signUp'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AuthStack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{
          title: t('auth.forgotPasswordTitle'),
          headerBackTitle: t('app.back'),
        }}
      />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  const { theme } = useTheme();
  const { t } = useTranslation();

  return (
    <AppStack.Navigator
      initialRouteName="Map"
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.background,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.1,
          shadowRadius: 3,
          elevation: 4,
        },
        headerTintColor: theme.text,
        headerTitleStyle: {
          fontWeight: '600',
        },
      }}
    >
      <AppStack.Screen
        name="Map"
        component={MapScreen}
        options={{
          title: t('app.title'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: t('app.settings'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="Community"
        component={CommunityScreen}
        options={{
          title: t('app.community'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="DestinationDetail"
        component={DestinationDetailRoute}
        options={{
          title: t('app.title'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="Favourites"
        component={FavouritesScreen}
        options={{
          title: t('app.favourites'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: t('profile.title', 'Profile'),
          headerBackTitle: t('app.back'),
        }}
      />
      <AppStack.Screen
        name="Feedback"
        component={FeedbackScreen}
        options={{
          title: t('feedbackScreen.title'),
          headerBackTitle: t('app.back'),
        }}
      />
    </AppStack.Navigator>
  );
}

const INTRO_LOGO_SIZE = 200;
const INTRO_HOLD_MS = 4500;
const DISSOLVE_GRID = 20;
const DISSOLVE_CELL = INTRO_LOGO_SIZE / DISSOLVE_GRID;
const DISSOLVE_MS = 1500;
const DISSOLVE_TILES_PER_TICK = 4;
const POST_DISSOLVE_PAUSE_MS = 800;
const SUNNOMAD_HOLD_MS = 1000;
const SPLASH_BG = '#F5F0EB';
const GOLDIE_LOGO = require('./assets/goldieapps.png');
const GOLDIE_SPLASH_DATE_KEY = 'goldieSplashLastDate';

const todayDateKey = () => new Date().toLocaleDateString('en-CA');

function shuffledIndices(count) {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const DISSOLVE_TILE_COUNT = DISSOLVE_GRID * DISSOLVE_GRID;

function PixelDissolveOverlay({ active, onDone }) {
  const orderRef = useRef(shuffledIndices(DISSOLVE_TILE_COUNT));
  const [shown, setShown] = useState(() => new Set());

  useEffect(() => {
    if (!active) {
      setShown(new Set());
      return undefined;
    }

    orderRef.current = shuffledIndices(DISSOLVE_TILE_COUNT);
    setShown(new Set());
    let idx = 0;
    const ticks = Math.ceil(DISSOLVE_TILE_COUNT / DISSOLVE_TILES_PER_TICK);
    const tickMs = DISSOLVE_MS / ticks;

    const id = setInterval(() => {
      const batch = [];
      for (let c = 0; c < DISSOLVE_TILES_PER_TICK && idx < orderRef.current.length; c++) {
        batch.push(orderRef.current[idx]);
        idx += 1;
      }
      if (batch.length > 0) {
        setShown((prev) => {
          const next = new Set(prev);
          batch.forEach((i) => next.add(i));
          return next;
        });
      }
      if (idx >= orderRef.current.length) {
        clearInterval(id);
        onDone?.();
      }
    }, tickMs);

    return () => clearInterval(id);
  }, [active, onDone]);

  if (!active) return null;

  return (
    <View style={splashStyles.dissolveOverlay} pointerEvents="none">
      {Array.from({ length: DISSOLVE_TILE_COUNT }, (_, i) => {
        if (!shown.has(i)) return null;
        const row = Math.floor(i / DISSOLVE_GRID);
        const col = i % DISSOLVE_GRID;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: col * DISSOLVE_CELL,
              top: row * DISSOLVE_CELL,
              width: DISSOLVE_CELL + 0.5,
              height: DISSOLVE_CELL + 0.5,
              backgroundColor: SPLASH_BG,
            }}
          />
        );
      })}
    </View>
  );
}

function RootNavigator() {
  const {
    isAuthenticated,
    loading,
    isPasswordRecovery,
    recoveryLinkError,
    clearRecoveryLinkError,
  } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [splashPhase, setSplashPhase] = useState(null);
  const [introReady, setIntroReady] = useState(false);
  const [fontsLoaded] = useFonts({ Yellowtail_400Regular });
  const [locationPreloaded, setLocationPreloaded] = useState(false);
  const [goldieHidden, setGoldieHidden] = useState(false);
  const [showSunnomad, setShowSunnomad] = useState(false);
  const presentsOpacity = useRef(new Animated.Value(0)).current;
  const onDissolveDone = useCallback(() => setGoldieHidden(true), []);

  useEffect(() => {
    if (!recoveryLinkError) return;
    Alert.alert(t('auth.error'), t('auth.recoveryLinkExpired'), [
      { text: 'OK', onPress: clearRecoveryLinkError },
    ]);
  }, [recoveryLinkError, clearRecoveryLinkError, t]);

  // Goldie intro+dissolve once per day; SunNomad splash every launch
  useEffect(() => {
    AsyncStorage.getItem(GOLDIE_SPLASH_DATE_KEY)
      .then((stored) => {
        if (stored === todayDateKey()) {
          setShowSunnomad(true);
          setSplashPhase('sunnomad');
        } else {
          setSplashPhase('intro');
        }
      })
      .catch(() => setSplashPhase('intro'));
  }, []);

  // Start location + AsyncStorage preload immediately (during splash)
  useEffect(() => {
    startLocationPreload()
      .then(() => setLocationPreloaded(true))
      .catch(() => setLocationPreloaded(true));
  }, []);

  // Intro phase: Goldie logo, then dissolve → pause → SunNomad
  useEffect(() => {
    if (splashPhase !== 'intro') return undefined;
    const introTimer = setTimeout(() => setSplashPhase('main'), INTRO_HOLD_MS);
    return () => clearTimeout(introTimer);
  }, [splashPhase]);

  // SunNomad-only (Goldie already shown today)
  useEffect(() => {
    if (splashPhase !== 'sunnomad' || !locationPreloaded) return;
    const t = setTimeout(() => setSplashPhase('done'), SUNNOMAD_HOLD_MS);
    return () => clearTimeout(t);
  }, [splashPhase, locationPreloaded]);

  // Goldie seen today — mark after intro → dissolve starts
  useEffect(() => {
    if (splashPhase !== 'main') return;
    AsyncStorage.setItem(GOLDIE_SPLASH_DATE_KEY, todayDateKey()).catch(() => {});
  }, [splashPhase]);

  // Main phase: dissolve + pause + SunNomad hold, then app (after preload ready)
  useEffect(() => {
    if (splashPhase !== 'main' || !locationPreloaded) return;
    const t = setTimeout(
      () => setSplashPhase('done'),
      DISSOLVE_MS + POST_DISSOLVE_PAUSE_MS + SUNNOMAD_HOLD_MS,
    );
    return () => clearTimeout(t);
  }, [splashPhase, locationPreloaded]);

  useEffect(() => {
    if (!fontsLoaded || splashPhase !== 'intro') return;
    Animated.timing(presentsOpacity, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fontsLoaded, splashPhase, presentsOpacity]);

  useEffect(() => {
    if (splashPhase !== 'main') return;
    presentsOpacity.setValue(0);
    setGoldieHidden(false);
    setShowSunnomad(false);
  }, [splashPhase, presentsOpacity]);

  useEffect(() => {
    if (!goldieHidden) return;
    const t = setTimeout(() => setShowSunnomad(true), POST_DISSOLVE_PAUSE_MS);
    return () => clearTimeout(t);
  }, [goldieHidden]);

  useEffect(() => {
    const safety = setTimeout(() => {
      setSplashPhase(prev => prev === 'done' ? prev : 'done');
    }, 15000);
    return () => clearTimeout(safety);
  }, []);

  const onIntroLayout = useCallback(() => {
    setIntroReady(true);
  }, []);

  useEffect(() => {
    if (splashPhase === 'done' || splashPhase === 'sunnomad') SplashScreen.hideAsync();
  }, [splashPhase]);

  useEffect(() => {
    if (splashPhase !== 'intro' || !fontsLoaded || !introReady) return;
    SplashScreen.hideAsync();
  }, [splashPhase, fontsLoaded, introReady]);

  if (splashPhase === null && !isPasswordRecovery) return null;

  const showSplash =
    !isPasswordRecovery
    && (
      splashPhase === 'intro'
      || splashPhase === 'main'
      || splashPhase === 'sunnomad'
      || (loading && splashPhase !== 'done')
    );

  if (showSplash) {
    const dissolving = splashPhase === 'main';
    const goldiePhase = splashPhase === 'intro' || splashPhase === 'main';
    return (
      <View
        style={splashStyles.container}
        onLayout={splashPhase === 'intro' ? onIntroLayout : undefined}
      >
        {(splashPhase === 'sunnomad' || showSunnomad) && (
          <View style={splashStyles.sunnomadLayer} pointerEvents="none">
            <Image
              source={require('./assets/sunnomad-logo.png')}
              style={splashStyles.logo}
              resizeMode="contain"
            />
          </View>
        )}

        {goldiePhase && (
        <View style={splashStyles.goldieLayer} pointerEvents="none">
          <View style={splashStyles.introLogoWrap}>
            <View style={splashStyles.logoBox}>
              {!goldieHidden && (
                <Image
                  source={GOLDIE_LOGO}
                  style={splashStyles.introLogo}
                  resizeMode="contain"
                />
              )}
              {dissolving && !goldieHidden && (
                <PixelDissolveOverlay active onDone={onDissolveDone} />
              )}
            </View>
          </View>
          {!dissolving && (
            <Animated.Text
              style={[
                splashStyles.presentsText,
                fontsLoaded && { fontFamily: 'Yellowtail_400Regular' },
                { opacity: presentsOpacity },
              ]}
            >
              Goldie presents
            </Animated.Text>
          )}
        </View>
        )}
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isPasswordRecovery ? (
        <ResetPasswordScreen />
      ) : isAuthenticated ? (
        <MainNavigator />
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F0EB',
  },
  goldieLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  sunnomadLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
    zIndex: 0,
  },
  introLogoWrap: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: -INTRO_LOGO_SIZE / 2,
    alignItems: 'center',
  },
  logoBox: {
    width: INTRO_LOGO_SIZE,
    height: INTRO_LOGO_SIZE,
    overflow: 'hidden',
  },
  introLogo: {
    width: INTRO_LOGO_SIZE,
    height: INTRO_LOGO_SIZE,
  },
  dissolveOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  presentsText: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: 95,
    textAlign: 'center',
    fontSize: 30,
    color: '#8B6914',
    letterSpacing: 1,
  },
  logo: {
    width: '85%',
    height: 140,
  },
});

function DevBuildBanner() {
  if (!__DEV__) return null;
  const version = Constants.nativeApplicationVersion ?? '?';
  const build = Constants.nativeBuildVersion ?? '?';
  return (
    <View style={devBannerStyles.wrap} pointerEvents="none">
      <Text style={devBannerStyles.text}>
        DEV · v{version} ({build})
        {Constants.expoConfig?.extra?.appVariant === 'development' ? ' · SunNomad Dev' : ''}
      </Text>
    </View>
  );
}

function App() {
  useAppLifecycle();
  return (
    <ThemeProvider>
      <UnitProvider>
        <AuthProvider>
          <GestureHandlerRootView style={devBannerStyles.root}>
            <StatusBar style="dark" backgroundColor="#F5F0EB" />
            <RootNavigator />
            <DevBuildBanner />
            <Toast />
          </GestureHandlerRootView>
        </AuthProvider>
      </UnitProvider>
    </ThemeProvider>
  );
}

const devBannerStyles = StyleSheet.create({
  root: { flex: 1 },
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 10,
    paddingTop: 4,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 9999,
  },
  text: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});

export default Sentry.wrap(App);
