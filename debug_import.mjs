import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://skkkoxdobvimqpfqzbdx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNra2tveGRvYnZpbXFwZnF6YmR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzMwMTQzMCwiZXhwIjoyMDgyODc3NDMwfQ.airQX-UiKaOtAcsjhfSLHdgjYc8XjZ0-4GAauWW6Isw'
)

const BUCKET = 'place-heroes'
const VARIANT = 'goldie' // erst nur eine Variante testen
const PREFIX = `dedicated/${VARIANT}`

function parseFilename(filename) {
  const dotIndex = filename.lastIndexOf('.')
  const basename = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename

  const parts = basename.split('_')
  if (parts.length < 3) {
    return { ok: false, reason: 'too_few_parts', filename }
  }

  const sortOrderRaw = parts[parts.length - 1]
  const variant = parts[parts.length - 2]
  const imageSlug = parts.slice(0, -2).join('_')
  const sortOrder = Number(sortOrderRaw)

  if (!imageSlug) return { ok: false, reason: 'missing_slug', filename }
  if (!['arty', 'goldie', 'pexels', 'chatgpt'].includes(variant)) {
    return { ok: false, reason: 'invalid_variant', filename, variant }
  }
  if (!Number.isInteger(sortOrder)) {
    return { ok: false, reason: 'invalid_sort_order', filename, sortOrderRaw }
  }

  return { ok: true, imageSlug, variant, sortOrder, filename }
}

async function main() {
  console.log('Listing bucket path:', PREFIX)

  const { data: files, error: listError } = await supabase
    .storage
    .from(BUCKET)
    .list(PREFIX, { limit: 100, sortBy: { column: 'name', order: 'asc' } })

  if (listError) {
    console.error('LIST ERROR:', listError)
    process.exit(1)
  }

  console.log('FILES FOUND:', files?.length ?? 0)
  console.log(files)

  if (!files || files.length === 0) {
    console.log('Keine Dateien unter genau diesem Pfad gefunden.')
    process.exit(0)
  }

  for (const file of files) {
    if (!file.name) continue

    const parsed = parseFilename(file.name)
    console.log('\nFILE:', file.name)
    console.log('PARSED:', parsed)

    if (!parsed.ok) continue

    const { imageSlug, variant, sortOrder } = parsed
    const storagePath = `${PREFIX}/${file.name}`

    const { data: place, error: placeError } = await supabase
      .from('places')
      .select('id, image_slug, name_en')
      .eq('image_slug', imageSlug)
      .maybeSingle()

    console.log('PLACE LOOKUP:', { imageSlug, place, placeError })

    if (placeError || !place) continue

    const { data: upserted, error: upsertError } = await supabase
      .from('place_hero_images')
      .upsert(
        {
          place_id: place.id,
          variant,
          storage_path: storagePath,
          sort_order: sortOrder,
          is_active: true
        },
        {
          onConflict: 'storage_path'
        }
      )
      .select()

    console.log('UPSERT RESULT:', { upserted, upsertError })
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})