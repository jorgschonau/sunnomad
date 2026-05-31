import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const supabase = createClient(
  'https://skkkoxdobvimqpfqzbdx.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKET = 'dedicated'
const VARIANTS = ['arty', 'goldie', 'chatgpt', 'roadtrip', 'cast']

//'pexels',

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

  let variantIdx = -1
  for (let i = parts.length - 1; i >= 0; i--) {
    if (VARIANTS.includes(parts[i])) {
      variantIdx = i
      break
    }
  }
  if (variantIdx === -1) return { ok: false, reason: 'bad_variant', filename }

  const variant = parts[variantIdx]
  const imageSlugParts = parts.slice(0, variantIdx)
  const afterParts = parts.slice(variantIdx + 1)

  if (!imageSlugParts.length) return { ok: false, reason: 'missing_slug', filename }

  const imageSlug = imageSlugParts.join('_')

  let sortOrder = 1
  for (let i = afterParts.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(afterParts[i])) {
      sortOrder = Number(afterParts[i])
      break
    }
  }

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

    if (batch.length === 0) break

    for (const file of batch) {
      if (!file.name) continue

      const parsed = parseFilename(file.name)
      if (!parsed.ok) {
        log(`SKIP PARSE: ${file.name} -> ${parsed.reason}`)
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

    if (batch.length < PAGE_SIZE) break
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