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
const UPSERT_BATCH = 100

function log(line) {
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function parseFilename(filename) {
  const dotIndex = filename.lastIndexOf('.')
  const basename = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename
  const parts = basename.split('_')

  if (parts.length < 2) return { ok: false, reason: 'too_few_parts', filename }

  const lastPart = parts[parts.length - 1]
  const secondLastPart = parts[parts.length - 2]

  let variant, sortOrder, imageSlugParts

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

async function fetchAllFiles(variant) {
  const allFiles = []
  let offset = 0

  while (true) {
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list(variant, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } })

    if (error) {
      log(`LIST ERROR (${variant}, offset ${offset}): ${error.message}`)
      break
    }

    const batch = files || []
    log(`  Fetched ${batch.length} files at offset ${offset}`)
    allFiles.push(...batch)

    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return allFiles
}

async function importVariant(variant) {
  log(`\n=== ${variant.toUpperCase()} ===`)

  // 1. Fetch all files
  const allFiles = await fetchAllFiles(variant)
  log(`  Total files: ${allFiles.length}`)

  // 2. Parse filenames
  const parsed = []
  let parseFail = 0

  for (const file of allFiles) {
    if (!file.name) continue
    const result = parseFilename(file.name)
    if (!result.ok) {
      log(`  SKIP PARSE (${result.reason}): ${file.name}`)
      parseFail++
    } else {
      parsed.push(result)
    }
  }

  log(`  Parsed OK: ${parsed.length}, Parse fail: ${parseFail}`)

  if (parsed.length === 0) return { ok: 0, fail: parseFail }

  // 3. One query to resolve all slugs → place_ids
  const slugs = [...new Set(parsed.map(p => p.imageSlug))]
  log(`  Unique slugs: ${slugs.length}`)

  const { data: places, error: placesError } = await supabase
    .from('places')
    .select('id, image_slug')
    .in('image_slug', slugs)

  if (placesError) {
    log(`  PLACES QUERY ERROR: ${placesError.message}`)
    return { ok: 0, fail: parsed.length }
  }

  const slugToId = Object.fromEntries(places.map(p => [p.image_slug, p.id]))
  log(`  Matched slugs: ${places.length} / ${slugs.length}`)

  // Log unmatched slugs
  const unmatched = slugs.filter(s => !slugToId[s])
  if (unmatched.length > 0) {
    log(`  Unmatched slugs (${unmatched.length}):`)
    unmatched.forEach(s => log(`    - ${s}`))
  }

  // 4. Build upsert rows
  const rows = parsed
    .filter(p => slugToId[p.imageSlug])
    .map(p => ({
      place_id: slugToId[p.imageSlug],
      variant,
      storage_path: `${variant}/${p.filename}`,
      sort_order: p.sortOrder,
      is_active: true
    }))

  log(`  Rows to upsert: ${rows.length}`)

  // 5. Batch upserts
  let ok = 0
  let fail = parseFail + (parsed.length - rows.length) // parse fails + no-match

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    const { error: upsertError } = await supabase
      .from('place_hero_images')
      .upsert(batch, { onConflict: 'storage_path' })

    if (upsertError) {
      log(`  UPSERT BATCH ERROR (offset ${i}): ${upsertError.message}`)
      fail += batch.length
    } else {
      ok += batch.length
    }
  }

  log(`  Done — OK: ${ok}, Fail: ${fail}`)
  return { ok, fail }
}

async function main() {
  fs.writeFileSync(LOG_FILE, `IMPORT START: ${new Date().toISOString()}\n`)

  let totalOk = 0
  let totalFail = 0

  for (const variant of VARIANTS) {
    const res = await importVariant(variant)
    totalOk += res.ok
    totalFail += res.fail
  }

  log('\n=== DONE ===')
  log(`SUCCESS: ${totalOk}`)
  log(`FAILED:  ${totalFail}`)
}

main().catch(err => {
  log(`FATAL: ${err.message}`)
  console.error(err)
})