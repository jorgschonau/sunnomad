/**
 * ISO 3166-1 alpha-2 → continent bucket for client-side achievements.
 * Unknown codes return null (skipped for transcontinental tracking).
 */

const EU = new Set([
  'AD', 'AL', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR',
  'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT',
  'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'UA', 'VA', 'XK',
]);

const AF = new Set([
  'AO', 'BF', 'BI', 'BJ', 'BW', 'CD', 'CF', 'CG', 'CI', 'CM', 'CV', 'DJ', 'DZ', 'EG', 'EH', 'ER',
  'ET', 'GA', 'GH', 'GM', 'GN', 'GQ', 'GW', 'KE', 'KM', 'LR', 'LS', 'LY', 'MA', 'MG', 'ML', 'MR',
  'MU', 'MW', 'MZ', 'NA', 'NE', 'NG', 'RE', 'RW', 'SC', 'SD', 'SL', 'SN', 'SO', 'SS', 'ST', 'SZ',
  'TD', 'TG', 'TN', 'TZ', 'UG', 'YT', 'ZA', 'ZM', 'ZW',
]);

const ASIA = new Set([
  'AE', 'AF', 'AM', 'AZ', 'BD', 'BH', 'BN', 'BT', 'CN', 'GE', 'HK', 'ID', 'IL', 'IN', 'IQ', 'IR',
  'JO', 'JP', 'KG', 'KH', 'KP', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LK', 'MM', 'MN', 'MO', 'MV', 'MY',
  'NP', 'OM', 'PH', 'PK', 'PS', 'QA', 'RU', 'SA', 'SG', 'SY', 'TH', 'TJ', 'TL', 'TM', 'TR', 'TW',
  'UZ', 'VN', 'YE',
]);

const NA = new Set([
  'AG', 'AI', 'AW', 'BB', 'BL', 'BM', 'BQ', 'BS', 'BZ', 'CA', 'CR', 'CU', 'CW', 'DM', 'DO', 'GD',
  'GL', 'GP', 'GT', 'HN', 'HT', 'JM', 'KN', 'KY', 'LC', 'MF', 'MQ', 'MS', 'MX', 'NI', 'PA', 'PM',
  'PR', 'SV', 'TC', 'TT', 'US', 'VC', 'VG', 'VI',
]);

const SA = new Set([
  'AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'FK', 'GF', 'GY', 'PE', 'PY', 'SR', 'UY', 'VE',
]);

const OC = new Set([
  'AS', 'AU', 'CK', 'FJ', 'FM', 'GU', 'KI', 'MH', 'MP', 'NC', 'NF', 'NR', 'NU', 'NZ', 'PF', 'PG',
  'PN', 'PW', 'SB', 'TK', 'TO', 'TV', 'VU', 'WF', 'WS',
]);

/** @param {string|null|undefined} code ISO 3166-1 alpha-2 */
export function getContinentForCountry(code) {
  const cc = String(code || '').toUpperCase().trim();
  if (!cc) return null;
  if (EU.has(cc)) return 'EU';
  if (AF.has(cc)) return 'AF';
  if (NA.has(cc)) return 'NA';
  if (SA.has(cc)) return 'SA';
  if (OC.has(cc)) return 'OC';
  if (ASIA.has(cc)) return 'ASIA';
  return null;
}
