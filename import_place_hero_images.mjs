import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const supabase = createClient(
  'https://skkkoxdobvimqpfqzbdx.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKET = 'dedicated'
const VARIANTS = ['arty', 'goldie', 'pexels', 'chatgpt']
const LOG_FILE = 'import_log.txt'
const PAGE_SIZE = 1000

function log(line) {
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function parseFilename(filename) {
  const dotIndex = filename.lastIndexOf('.')
  const basename = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename

  const parts = basename.split('_')
  if (parts.length < 2) {
    return { ok: false, reason: 'too_few_parts', filename }
  }

  const lastPart = parts[parts.length - 1]
  const secondLastPart = parts[parts.length - 2]

  let variant
  let sortOrder
  let imageSlugParts

  if (/^\d+$/.test(lastPart)) {
    sortOrder = Number(lastPart)
    variant = secondLastPart
    imageSlugParts = parts.slice(0, -2)
  } else {
    sortOrder = 1
    variant = lastPart
    imageSlugParts = parts.slice(0, -1)
  }

  const imageSlug = imageSlugParts.join('_')

  if (!imageSlug) return { ok: false, reason: 'missing_slug', filename }
  if (!VARIANTS.includes(variant)) return { ok: false, reason: 'bad_variant', filename }
  if (!Number.isInteger(sortOrder)) return { ok: false, reason: 'bad_sort', filename }

  return { ok: true, filename, imageSlug, variant, sortOrder }
}

async function importVariant(variant) {
  log(`\n=== ${variant.toUpperCase()} ===`)

  let ok = 0
  let fail = 0
  let offset = 0

  while (true) {
    const { data: files, error } = await supabase
      .storage
      .from(BUCKET)
      .list(variant, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      })

    if (error) {
      log(`LIST ERROR (${variant}, offset ${offset}): ${error.message}`)
      break
    }

    const batch = files || []
    log(`Fetched ${batch.length} files for ${variant} at offset ${offset}`)

    if (batch.length === 0) {
      break
    }

    for (const file of batch) {
      if (!file.name) continue

      const parsed = parseFilename(file.name)

      if (!parsed.ok) {
        log(`SKIP PARSE: ${file.name}`)
        fail++
        continue
      }

      const { imageSlug, sortOrder } = parsed
      const storagePath = `${variant}/${file.name}`

      const { data: place, error: placeError } = await supabase
        .from('places')
        .select('id')
        .eq('image_slug', imageSlug)
        .maybeSingle()

      if (placeError || !place) {
        log(`NO MATCH: ${file.name} -> ${imageSlug}`)
        fail++
        continue
      }

      const { error: upsertError } = await supabase
        .from('place_hero_images')
        .upsert(
          {
            place_id: place.id,
            variant,
            storage_path: storagePath,
            sort_order: sortOrder,
            is_active: true
          },
          { onConflict: 'storage_path' }
        )

      if (upsertError) {
        log(`UPSERT FAIL: ${file.name} -> ${upsertError.message}`)
        fail++
        continue
      }

      ok++
    }

    if (batch.length < PAGE_SIZE) {
      break
    }

    offset += PAGE_SIZE
  }

  return { ok, fail }
}

async function main() {
  fs.writeFileSync(LOG_FILE, 'IMPORT START\n')

  let totalOk = 0
  let totalFail = 0

  for (const variant of VARIANTS) {
    const res = await importVariant(variant)
    totalOk += res.ok
    totalFail += res.fail
  }

  log('\n=== DONE ===')
  log(`SUCCESS: ${totalOk}`)
  log(`FAILED: ${totalFail}`)
}

main().catch(err => {
  console.error(err)
})