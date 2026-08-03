import AsyncStorage from '@react-native-async-storage/async-storage';
import { DestinationBadge } from '../domain/destinationBadge';

// Fake level system + ironic badges (see ROADMAP "Gamification Paket").
// Pure client-side joke features: based on app_open_count / favourites /
// fullscreen cast sightings — no backend. Badges earned once → AsyncStorage.

const TRACKABLE_WEATHER_BADGES = new Set(Object.values(DestinationBadge));
const WEATHER_BADGE_TARGET = TRACKABLE_WEATHER_BADGES.size;

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

const USAGE_KEY = 'ironicUsageStats';
const DETAIL_TARGET = 25;
const RADIUS_FIDGET_TARGET = 20;
const COUNTRY_TARGET = 15;
const DRIVE_TARGET = 10;
const FERNWEH_KM = 1000;
const RADIUS_MAX_KM = 5000;
/** Metric floor is 50; imperial floor ~40km (25mi). */
const RADIUS_MIN_KM = 51;

const HOMESPOT_METHODS_TARGET = 2;

const EMPTY_USAGE = {
  detailViews: 0,
  radiusChanges: 0,
  radiusMinHit: false,
  radiusMaxHit: false,
  countries: [],
  driveTaps: 0,
  fernwehHit: false,
  weatherBadges: [],
  centerViaSearch: false,
  centerViaLongPress: false,
  refViaGps: false,
  refViaManual: false,
};

function emptyUsage() {
  return { ...EMPTY_USAGE, countries: [], weatherBadges: [] };
}

async function getUsageStats() {
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    if (!raw) return emptyUsage();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyUsage();
    const countries = Array.isArray(parsed.countries)
      ? parsed.countries
          .map((c) => String(c || '').toUpperCase().trim())
          .filter((c) => c.length === 2)
      : [];
    const weatherBadges = Array.isArray(parsed.weatherBadges)
      ? parsed.weatherBadges.filter((id) => TRACKABLE_WEATHER_BADGES.has(id))
      : [];
    return {
      detailViews: Number(parsed.detailViews) || 0,
      radiusChanges: Number(parsed.radiusChanges) || 0,
      radiusMinHit: !!parsed.radiusMinHit,
      radiusMaxHit: !!parsed.radiusMaxHit,
      countries: [...new Set(countries)],
      driveTaps: Number(parsed.driveTaps) || 0,
      fernwehHit: !!parsed.fernwehHit,
      weatherBadges: [...new Set(weatherBadges)],
      centerViaSearch: !!parsed.centerViaSearch,
      centerViaLongPress: !!parsed.centerViaLongPress,
      refViaGps: !!parsed.refViaGps,
      refViaManual: !!parsed.refViaManual,
    };
  } catch {
    return emptyUsage();
  }
}

async function saveUsageStats(stats) {
  try {
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}

/**
 * Count a destination detail open; also track unique countries and fernweh distance.
 * @param {{ countryCode?: string|null, distanceKm?: number|null }} [meta]
 */
export async function trackDetailViewed(meta = {}) {
  const stats = await getUsageStats();
  stats.detailViews += 1;
  const cc = String(meta.countryCode || '').toUpperCase().trim();
  if (cc.length === 2 && !stats.countries.includes(cc)) {
    stats.countries.push(cc);
  }
  const dist = Number(meta.distanceKm);
  if (Number.isFinite(dist) && dist >= FERNWEH_KM) {
    stats.fernwehHit = true;
  }
  await saveUsageStats(stats);
}

/** Count a radius change; flag min/max when hit. */
export async function trackRadiusChanged(radiusKm) {
  const km = Number(radiusKm);
  if (!Number.isFinite(km)) return;
  const stats = await getUsageStats();
  stats.radiusChanges += 1;
  if (km <= RADIUS_MIN_KM) stats.radiusMinHit = true;
  if (km >= RADIUS_MAX_KM) stats.radiusMaxHit = true;
  await saveUsageStats(stats);
}

/** Count a "Drive there" tap. */
export async function trackDriveThereTapped() {
  const stats = await getUsageStats();
  stats.driveTaps += 1;
  await saveUsageStats(stats);
}

/** Record weather trophies seen on a destination detail card. */
export async function trackWeatherBadgesSeen(badgeIds) {
  if (!Array.isArray(badgeIds) || badgeIds.length === 0) return;
  const stats = await getUsageStats();
  let changed = false;
  for (const id of badgeIds) {
    if (TRACKABLE_WEATHER_BADGES.has(id) && !stats.weatherBadges.includes(id)) {
      stats.weatherBadges.push(id);
      changed = true;
    }
  }
  if (changed) await saveUsageStats(stats);
}

/**
 * Mark a homespot method: search field select or map long-press.
 * @param {'search'|'longPress'} method
 */
export async function trackCenterMethod(method) {
  if (method !== 'search' && method !== 'longPress') return;
  const stats = await getUsageStats();
  if (method === 'search' && !stats.centerViaSearch) {
    stats.centerViaSearch = true;
    await saveUsageStats(stats);
  } else if (method === 'longPress' && !stats.centerViaLongPress) {
    stats.centerViaLongPress = true;
    await saveUsageStats(stats);
  }
}

/**
 * Mark a reference-pin menu choice: GPS or last manual place.
 * @param {'gps'|'manual'} mode
 */
export async function trackRefMode(mode) {
  if (mode !== 'gps' && mode !== 'manual') return;
  const stats = await getUsageStats();
  if (mode === 'gps' && !stats.refViaGps) {
    stats.refViaGps = true;
    await saveUsageStats(stats);
  } else if (mode === 'manual' && !stats.refViaManual) {
    stats.refViaManual = true;
    await saveUsageStats(stats);
  }
}

const REF_METHODS_TARGET = 2;

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

const COLLECTOR_TARGET = 10;

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
    descKey: 'profile.badgeCollectorDesc1',
    showProgress: true,
    isMet: ({ favouriteCount }) => (favouriteCount || 0) >= COLLECTOR_TARGET,
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
    descKey: 'profile.badgeCastDesc1',
    // Progress always visible; unlocks when the full cast has been seen in fullscreen.
    showProgress: true,
    isMet: ({ discoveredCount }) =>
      (discoveredCount || 0) >= DISCOVERABLE_CHARACTER_COUNT,
  },
  {
    id: 'detail_junkie',
    icon: 'eye-outline',
    nameKey: 'profile.badgeDetailName',
    descKey: 'profile.badgeDetailDesc1',
    showProgress: true,
    isMet: ({ detailViews }) => (detailViews || 0) >= DETAIL_TARGET,
  },
  {
    id: 'radius_fidget',
    icon: 'resize-outline',
    nameKey: 'profile.badgeRadiusFidgetName',
    descKey: 'profile.badgeRadiusFidgetDesc1',
    showProgress: true,
    isMet: ({ radiusChanges }) => (radiusChanges || 0) >= RADIUS_FIDGET_TARGET,
  },
  {
    id: 'radius_min',
    icon: 'locate-outline',
    nameKey: 'profile.badgeRadiusMinName',
    descKey: 'profile.badgeRadiusMinDescOff',
    showProgress: true,
    isMet: ({ radiusMinHit }) => !!radiusMinHit,
  },
  {
    id: 'radius_max',
    icon: 'globe-outline',
    nameKey: 'profile.badgeRadiusMaxName',
    descKey: 'profile.badgeRadiusMaxDescOff',
    showProgress: true,
    isMet: ({ radiusMaxHit }) => !!radiusMaxHit,
  },
  {
    id: 'country_hopper',
    icon: 'flag-outline',
    nameKey: 'profile.badgeCountryName',
    descKey: 'profile.badgeCountryDesc1',
    showProgress: true,
    isMet: ({ countryCount }) => (countryCount || 0) >= COUNTRY_TARGET,
  },
  {
    id: 'drive_junkie',
    icon: 'car-outline',
    nameKey: 'profile.badgeDriveName',
    descKey: 'profile.badgeDriveDesc1',
    showProgress: true,
    isMet: ({ driveTaps }) => (driveTaps || 0) >= DRIVE_TARGET,
  },
  {
    id: 'fernweh',
    icon: 'airplane-outline',
    nameKey: 'profile.badgeFernwehName',
    descKey: 'profile.badgeFernwehDescOff',
    showProgress: true,
    isMet: ({ fernwehHit }) => !!fernwehHit,
  },
  {
    id: 'weather_trophy_tourist',
    icon: 'trophy-outline',
    nameKey: 'profile.badgeWeatherTrophyName',
    descKey: 'profile.badgeWeatherTrophyDesc1',
    showProgress: true,
    isMet: ({ weatherBadgeCount }) => (weatherBadgeCount || 0) >= WEATHER_BADGE_TARGET,
  },
  {
    id: 'snow_king_spotter',
    icon: 'snow-outline',
    nameKey: 'profile.badgeSnowKingName',
    descKey: 'profile.badgeSnowKingDescOff',
    showProgress: true,
    isMet: ({ snowKingHit }) => !!snowKingHit,
  },
  {
    id: 'homespot_pro',
    icon: 'navigate-outline',
    nameKey: 'profile.badgeHomespotName',
    descKey: 'profile.badgeHomespotDesc1',
    showProgress: true,
    isMet: ({ homespotMethods }) => (homespotMethods || 0) >= HOMESPOT_METHODS_TARGET,
  },
  {
    id: 'pin_switcher',
    icon: 'compass-outline',
    nameKey: 'profile.badgePinName',
    descKey: 'profile.badgePinDesc1',
    showProgress: true,
    isMet: ({ refMethods }) => (refMethods || 0) >= REF_METHODS_TARGET,
  },
];

function progressDescKey(count, total, prefix) {
  const n = count || 0;
  if (n <= 0) return `${prefix}1`;
  if (n >= total) return `${prefix}5`;
  if (n >= Math.ceil(total * 0.75)) return `${prefix}4`;
  if (n >= Math.ceil(total * 0.4)) return `${prefix}3`;
  return `${prefix}2`;
}

function badgeDescKey(badge, ctx) {
  if (badge.id === 'cast_spotter') {
    return progressDescKey(ctx.discoveredCount, DISCOVERABLE_CHARACTER_COUNT, 'profile.badgeCastDesc');
  }
  if (badge.id === 'collector') {
    return progressDescKey(ctx.favouriteCount, COLLECTOR_TARGET, 'profile.badgeCollectorDesc');
  }
  if (badge.id === 'detail_junkie') {
    return progressDescKey(ctx.detailViews, DETAIL_TARGET, 'profile.badgeDetailDesc');
  }
  if (badge.id === 'radius_fidget') {
    return progressDescKey(ctx.radiusChanges, RADIUS_FIDGET_TARGET, 'profile.badgeRadiusFidgetDesc');
  }
  if (badge.id === 'country_hopper') {
    return progressDescKey(ctx.countryCount, COUNTRY_TARGET, 'profile.badgeCountryDesc');
  }
  if (badge.id === 'drive_junkie') {
    return progressDescKey(ctx.driveTaps, DRIVE_TARGET, 'profile.badgeDriveDesc');
  }
  if (badge.id === 'weather_trophy_tourist') {
    return progressDescKey(ctx.weatherBadgeCount, WEATHER_BADGE_TARGET, 'profile.badgeWeatherTrophyDesc');
  }
  if (badge.id === 'homespot_pro') {
    const n = ctx.homespotMethods || 0;
    if (n <= 0) return 'profile.badgeHomespotDesc1';
    if (n >= HOMESPOT_METHODS_TARGET) return 'profile.badgeHomespotDesc3';
    return 'profile.badgeHomespotDesc2';
  }
  if (badge.id === 'pin_switcher') {
    const n = ctx.refMethods || 0;
    if (n <= 0) return 'profile.badgePinDesc1';
    if (n >= REF_METHODS_TARGET) return 'profile.badgePinDesc3';
    return 'profile.badgePinDesc2';
  }
  if (badge.id === 'radius_min') {
    return ctx.radiusMinHit ? 'profile.badgeRadiusMinDescOn' : 'profile.badgeRadiusMinDescOff';
  }
  if (badge.id === 'radius_max') {
    return ctx.radiusMaxHit ? 'profile.badgeRadiusMaxDescOn' : 'profile.badgeRadiusMaxDescOff';
  }
  if (badge.id === 'fernweh') {
    return ctx.fernwehHit ? 'profile.badgeFernwehDescOn' : 'profile.badgeFernwehDescOff';
  }
  if (badge.id === 'snow_king_spotter') {
    return ctx.snowKingHit ? 'profile.badgeSnowKingDescOn' : 'profile.badgeSnowKingDescOff';
  }
  return badge.descKey;
}

function badgeDescParams(badge, ctx) {
  if (badge.id === 'cast_spotter') {
    return { count: ctx.discoveredCount, total: DISCOVERABLE_CHARACTER_COUNT };
  }
  if (badge.id === 'collector') {
    return {
      count: Math.min(ctx.favouriteCount || 0, COLLECTOR_TARGET),
      total: COLLECTOR_TARGET,
    };
  }
  if (badge.id === 'detail_junkie') {
    return {
      count: Math.min(ctx.detailViews || 0, DETAIL_TARGET),
      total: DETAIL_TARGET,
    };
  }
  if (badge.id === 'radius_fidget') {
    return {
      count: Math.min(ctx.radiusChanges || 0, RADIUS_FIDGET_TARGET),
      total: RADIUS_FIDGET_TARGET,
    };
  }
  if (badge.id === 'country_hopper') {
    return {
      count: Math.min(ctx.countryCount || 0, COUNTRY_TARGET),
      total: COUNTRY_TARGET,
    };
  }
  if (badge.id === 'drive_junkie') {
    return {
      count: Math.min(ctx.driveTaps || 0, DRIVE_TARGET),
      total: DRIVE_TARGET,
    };
  }
  if (badge.id === 'weather_trophy_tourist') {
    return {
      count: Math.min(ctx.weatherBadgeCount || 0, WEATHER_BADGE_TARGET),
      total: WEATHER_BADGE_TARGET,
    };
  }
  if (badge.id === 'homespot_pro') {
    return {
      count: Math.min(ctx.homespotMethods || 0, HOMESPOT_METHODS_TARGET),
      total: HOMESPOT_METHODS_TARGET,
    };
  }
  if (badge.id === 'pin_switcher') {
    return {
      count: Math.min(ctx.refMethods || 0, REF_METHODS_TARGET),
      total: REF_METHODS_TARGET,
    };
  }
  return undefined;
}

const STORAGE_KEY = 'ironicBadgesEarned';

/**
 * Evaluate badge conditions, merge with previously earned badges (once earned,
 * always kept), and return the full display list.
 * Pass `{ persist: false }` for teaser counts (Profile/Settings) so unlocks +
 * sparkles still fire when the Achievements screen resolves with persist.
 * Returns { badges: [{id, icon, nameKey, descKey, earned, descParams?}], newlyEarned: [id] }
 */
export async function resolveIronicBadges(
  { appOpens, favouriteCount, memberSince },
  { persist = true } = {}
) {
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
  const usage = await getUsageStats();
  const countryCount = usage.countries.length;
  const weatherBadgeCount = usage.weatherBadges.length;
  const snowKingHit = usage.weatherBadges.includes(DestinationBadge.SNOW_KING);
  const homespotMethods =
    (usage.centerViaSearch ? 1 : 0) + (usage.centerViaLongPress ? 1 : 0);
  const refMethods = (usage.refViaGps ? 1 : 0) + (usage.refViaManual ? 1 : 0);
  const ctx = {
    appOpens,
    favouriteCount,
    memberSince,
    discoveredCount,
    detailViews: usage.detailViews,
    radiusChanges: usage.radiusChanges,
    radiusMinHit: usage.radiusMinHit,
    radiusMaxHit: usage.radiusMaxHit,
    countryCount,
    driveTaps: usage.driveTaps,
    fernwehHit: usage.fernwehHit,
    weatherBadgeCount,
    snowKingHit,
    homespotMethods,
    refMethods,
    now: new Date(),
  };
  const earnedSet = new Set(stored);
  const newlyEarned = [];

  for (const badge of BADGES) {
    if (!earnedSet.has(badge.id) && badge.isMet(ctx)) {
      earnedSet.add(badge.id);
      newlyEarned.push(badge.id);
    }
  }

  if (persist && newlyEarned.length > 0) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...earnedSet])).catch(() => {});
  }

  const progressCtx = {
    discoveredCount,
    favouriteCount: favouriteCount || 0,
    detailViews: usage.detailViews,
    radiusChanges: usage.radiusChanges,
    radiusMinHit: usage.radiusMinHit,
    radiusMaxHit: usage.radiusMaxHit,
    countryCount,
    driveTaps: usage.driveTaps,
    fernwehHit: usage.fernwehHit,
    weatherBadgeCount,
    snowKingHit,
    homespotMethods,
    refMethods,
  };

  return {
    badges: BADGES.map((b) => ({
      id: b.id,
      icon: b.icon,
      nameKey: b.nameKey,
      descKey: badgeDescKey(b, progressCtx),
      earned: earnedSet.has(b.id),
      showProgress: !!b.showProgress,
      descParams: b.showProgress ? badgeDescParams(b, progressCtx) : undefined,
    })),
    newlyEarned: persist ? newlyEarned : [],
  };
}
