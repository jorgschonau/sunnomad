update places
set slug_base =
  regexp_replace(
    lower(
      unaccent(
        trim(name)
      )
    ),
    '[^a-z0-9]+',  -- alles außer a-z, 0-9
    '_',
    'g'
  )
  || '_' || lower(country_code);