export default {
  expo: {
    name: 'SunNomad',  // Richtiger Name
    slug: 'sunnomad',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'cover',
      backgroundColor: '#F5E6D3',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.sunnomad.app',
    },
    android: {
      userInterfaceStyle: 'light',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#FF8C42',
      },
      package: 'com.sunnomad.app',
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    },
    web: {},
    plugins: [
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'SunNomad nutzt deinen Standort um Reiseziele in deiner Nähe zu finden.',
        },
      ],
      'expo-localization',
    ],
    extra: {
      eas: {
        projectId: '5df2c512-288e-4749-93ef-e5cb018de180',
      },
      // HARDCODE FÜR BETA (später EAS Secrets nutzen)
      supabaseUrl: "https://skkkoxdobvimqpfqzbdx.supabase.co",  // z.B. https://xxx.supabase.co
      supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNra2tveGRvYnZpbXFwZnF6YmR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMDE0MzAsImV4cCI6MjA4Mjg3NzQzMH0.b6aT0cpaET-M685gL1fj-uwcTWO0e6WNDvqTWhQpH6A",
    },
  },
};