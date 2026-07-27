import AsyncStorage from '@react-native-async-storage/async-storage';

// Fake level system + ironic badges (see ROADMAP "Gamification Paket").
// Pure client-side joke features: based on app_open_count / favourites only,
// no backend. Badges are earned once and persisted in AsyncStorage.

const LEVELS = [
  { level: 1, minOpens: 0, nameKey: 'profile.fakeLevelName1' },
  { level: 2, minOpens: 10, nameKey: 'profile.fakeLevelName2' },
  { level: 3, minOpens: 25, nameKey: 'profile.fakeLevelName3' },
  { level: 4, minOpens: 50, nameKey: 'profile.fakeLevelName4' },
  { level: 5, minOpens: 100, nameKey: 'profile.fakeLevelName5' },
  { level: 6, minOpens: 200, nameKey: 'profile.fakeLevelName6' },
];

export function getFakeLevel(appOpens) {
  const opens = appOpens || 0;
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (opens >= lvl.minOpens) current = lvl;
  }
  const next = LEVELS[LEVELS.indexOf(current) + 1] ?? null;
  return {
    level: current.level,
    nameKey: current.nameKey,
    nextNameKey: next?.nameKey ?? null,
    nextMinOpens: next?.minOpens ?? null,
  };
}

const BADGES = [
  {
    id: 'certified_sun_chaser',
    icon: 'sunny-outline',
    nameKey: 'profile.badgeCertifiedName',
    descKey: 'profile.badgeCertifiedDesc',
    isMet: ({ appOpens }) => (appOpens || 0) >= 1,
  },
  {
    id: 'wrong_season_champion',
    icon: 'snow-outline',
    nameKey: 'profile.badgeWrongSeasonName',
    descKey: 'profile.badgeWrongSeasonDesc',
    isMet: ({ now }) => [11, 0, 1].includes(now.getMonth()), // Dec, Jan, Feb
  },
  {
    id: 'collector',
    icon: 'star-outline',
    nameKey: 'profile.badgeCollectorName',
    descKey: 'profile.badgeCollectorDesc',
    isMet: ({ favouriteCount }) => (favouriteCount || 0) >= 10,
  },
  {
    id: 'commitment_issues',
    icon: 'help-circle-outline',
    nameKey: 'profile.badgeCommitmentName',
    descKey: 'profile.badgeCommitmentDesc',
    isMet: ({ appOpens, favouriteCount }) => (appOpens || 0) >= 20 && (favouriteCount || 0) === 0,
  },
  {
    id: 'beta_veteran',
    icon: 'bug-outline',
    nameKey: 'profile.badgeBetaName',
    descKey: 'profile.badgeBetaDesc',
    isMet: ({ memberSince }) => !!memberSince && new Date(memberSince) < new Date('2026-09-01'),
  },
  {
    id: 'early_shift',
    icon: 'alarm-outline',
    nameKey: 'profile.badgeEarlyName',
    descKey: 'profile.badgeEarlyDesc',
    isMet: ({ now }) => now.getHours() >= 5 && now.getHours() < 7,
  },
  {
    id: 'night_shift',
    icon: 'moon-outline',
    nameKey: 'profile.badgeNightName',
    descKey: 'profile.badgeNightDesc',
    isMet: ({ now }) => now.getHours() < 5,
  },
  {
    id: 'friday_13',
    icon: 'skull-outline',
    nameKey: 'profile.badgeFriday13Name',
    descKey: 'profile.badgeFriday13Desc',
    isMet: ({ now }) => now.getDay() === 5 && now.getDate() === 13,
  },
];

const STORAGE_KEY = 'ironicBadgesEarned';

/**
 * Evaluate badge conditions, merge with previously earned badges (once earned,
 * always kept), persist, and return the full display list.
 * Returns { badges: [{id, icon, nameKey, descKey, earned}], newlyEarned: [id] }
 */
export async function resolveIronicBadges({ appOpens, favouriteCount, memberSince }) {
  let stored = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
    if (!Array.isArray(stored)) stored = [];
  } catch {
    stored = [];
  }

  const ctx = { appOpens, favouriteCount, memberSince, now: new Date() };
  const earnedSet = new Set(stored);
  const newlyEarned = [];

  for (const badge of BADGES) {
    if (!earnedSet.has(badge.id) && badge.isMet(ctx)) {
      earnedSet.add(badge.id);
      newlyEarned.push(badge.id);
    }
  }

  if (newlyEarned.length > 0) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...earnedSet])).catch(() => {});
  }

  return {
    badges: BADGES.map((b) => ({
      id: b.id,
      icon: b.icon,
      nameKey: b.nameKey,
      descKey: b.descKey,
      earned: earnedSet.has(b.id),
    })),
    newlyEarned,
  };
}
