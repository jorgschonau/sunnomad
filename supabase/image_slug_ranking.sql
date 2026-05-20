create extension if not exists unaccent;

update places
set slug_base =
  regexp_replace(
    regexp_replace(
      lower(unaccent(trim(name))),
      '[^a-z0-9]+',
      '_',
      'g'
    ),
    '^_|_$',
    '',
    'g'
  )
  || '_' || lower(country_code);