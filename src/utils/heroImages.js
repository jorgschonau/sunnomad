// DEDICATED - mapped by place UUID from DB
// Re-enable after fixing file paths (goldie/, chatgpt/, arty/ subfolders)
const DEDICATED = {};

const GENERIC = {
  beach_atlantic:       require('../../assets/destinations/generic/eu_atlanticbeach.webp'),
  beach_med:            require('../../assets/destinations/generic/eu_spanishbeach.webp'),
  beach_generic:        require('../../assets/destinations/generic/eu_north_beach.webp'),
  // find sth better later for mountain
  mountain:             require('../../assets/destinations/generic/eu_alps_1.webp'),
  // find sth better later for natural_feature
  natural_feature:      require('../../assets/destinations/generic/picos_de_europa.webp'),
  // find sth better later for scenic_drive
  scenic_drive:         require('../../assets/destinations/generic/scenicdrive.webp'),

  small_town_eu_south:  require('../../assets/destinations/generic/eu_south_smalltown.webp'),
  small_town_eu_north:  require('../../assets/destinations/generic/eu_north_smalltown.webp'),
  small_town_eu_east:   require('../../assets/destinations/generic/eu_east_smalltown.webp'),
  small_town_eu_balkan: require('../../assets/destinations/generic/eu_balkan_smalltown.webp'),
  small_town_na:        require('../../assets/destinations/generic/na_smalltown.webp'),

  mid_town_eu_south:    require('../../assets/destinations/generic/eu_south_midtown.webp'),
  mid_town_eu_north:    require('../../assets/destinations/generic/eu_north_midtown.webp'),
  mid_town_eu_east:     require('../../assets/destinations/generic/eu_east_midtown.webp'),
  mid_town_eu_balkan:   require('../../assets/destinations/generic/eu_balkan_midtown.webp'),
  mid_town_na:          require('../../assets/destinations/generic/na_midtown.webp'),

  city_eu_south:        require('../../assets/destinations/generic/eu_south_city.webp'),
  city_eu_north:        require('../../assets/destinations/generic/eu_north_city.webp'),
  city_eu_east:         require('../../assets/destinations/generic/eu_east_city.webp'),
  city_eu_balkan:       require('../../assets/destinations/generic/eu_balkan_city.webp'),
  city_na:              require('../../assets/destinations/generic/na_city.webp'),
};

// DEBUG helper – true when a place has a dedicated (hand-picked) hero image
export const hasDedicatedHeroImage = (id) => !!id && !!DEDICATED[id];

export const getHeroImage = (dest) => {
  if (!dest) return null;

  // 1. Dedicated by UUID
  const id = dest.id || dest.placeId;
  if (id && DEDICATED[id]) return DEDICATED[id];

  // 2. Generic by type
  const rawType = dest.place_type || dest.placeType;
  const type = rawType?.toLowerCase().replace(/\s+/g, '_');
  const cc = (dest.countryCode || dest.country_code || '').toUpperCase();
  const region = dest.image_region;

  if (type === 'scenic_drive') return GENERIC.scenic_drive;

  if (type === 'beach') {
    if (cc === 'ES') return GENERIC.beach_med;
    const atlantic = ['PT','FR','IE','GB','MA'];
    const med = ['IT','HR','GR','ME','AL','MT'];
    if (atlantic.includes(cc)) return GENERIC.beach_atlantic;
    if (med.includes(cc)) return GENERIC.beach_med;
    return GENERIC.beach_generic;
  }

  if (['natural_park','national_park','natural_feature','nature_reserve'].includes(type))
    return GENERIC.natural_feature;

  if (type === 'mountain') return GENERIC.mountain;

  // 3. City/town by size + region (from places.image_region)
  const size =
    type === 'city' ? 'city'
    : type === 'medium_town' ? 'mid_town'
    : 'small_town';

  const reg =
    region === 'eu_south' ? 'eu_south'
    : region === 'eu_east' ? 'eu_east'
    : region === 'eu_balkan' ? 'eu_balkan'
    : region === 'na' ? 'na'
    : 'eu_north';

  return GENERIC[`${size}_${reg}`] || GENERIC.small_town_eu_north || null;
};
