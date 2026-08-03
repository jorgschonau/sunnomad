import AsyncStorage from '@react-native-async-storage/async-storage';

// Fake level system + ironic badges (see ROADMAP "Gamification Paket").
// Pure client-side joke features: based on app_open_count / favourites /
// fullscreen cast sightings — no backend. Badges earned once → AsyncStorage.

// Active human CAST (CAST − DISABLED_CHARACTERS in generate_hero_images.py).
// Keep in sync when characters are added/removed from the generator roster.
export const DISCOVERABLE_CHARACTERS = [
  'alessandra', 'amber', 'chad', 'charlotte', 'conrad', 'dale', 'diana', 'diaz',
  'djordje', 'ingrid', 'isabella', 'jack_mae', 'jade', 'jelena', 'jonas_lara',
  'katja', 'kelek', 'luca', 'lyra', 'maya', 'metka', 'miles', 'naomi', 'rosa',
  'sofia', 'stacy', 'tammy', 'tasha', 'thea', 'tyler', 'valentina', 'werra',
  'yosra', 'yuki', 'zara',
];
export const DISCOVERABLE_CHARACTER_COUNT = DISCOVERABLE_CHARACTERS.length;
const DISCOVERABLE_SET = new Set(DISCOVERABLE_CHARACTERS);
const DISCOVERED_KEY = 'discoveredCharacters';

/** Persist character if discoverable; returns true when newly added. */
export async function markCharacterDiscovered(character) {
  if (!character || !DISCOVERABLE_SET.has(character)) return false;
  let stored = [];
  try {
    const raw = await AsyncStorage.getItem(DISCOVERED_KEY);
    if (raw) stored = JSON.parse(raw);
    if (!Array.isArray(stored)) stored = [];
  } catch {
    stored = [];
  }
  if (stored.includes(character)) return false;
  stored.push(character);
  try {
    await AsyncStorage.setItem(DISCOVERED_KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }
  return true;
}

async function getDiscoveredCharacters() {
  try {
    const raw = await AsyncStorage.getItem(DISCOVERED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => DISCOVERABLE_SET.has(id)) : [];
  } catch {
    return [];
  }
}

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
  {
    id: 'cast_spotter',
    icon: 'people-outline',
    nameKey: 'profile.badgeCastName',
    descKey: 'profile.badgeCastDesc',
    // Progress always visible; unlocks when the full cast has been seen in fullscreen.
    showProgress: true,
    isMet: ({ discoveredCount }) =>
      (discoveredCount || 0) >= DISCOVERABLE_CHARACTER_COUNT,
  },
];

const STORAGE_KEY = 'ironicBadgesEarned';

/**
 * Evaluate badge conditions, merge with previously earned badges (once earned,
 * always kept), persist, and return the full display list.
 * Returns { badges: [{id, icon, nameKey, descKey, earned, descParams?}], newlyEarned: [id] }
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

  const discovered = await getDiscoveredCharacters();
  const discoveredCount = discovered.length;
  const ctx = { appOpens, favouriteCount, memberSince, discoveredCount, now: new Date() };
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
      showProgress: !!b.showProgress,
      descParams: b.showProgress
        ? { count: discoveredCount, total: DISCOVERABLE_CHARACTER_COUNT }
        : undefined,
    })),
    newlyEarned,
  };
}
