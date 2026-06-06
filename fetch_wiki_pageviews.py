#!/usr/bin/env python3
import asyncio
import aiohttp
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

CONCURRENCY = 20
BATCH_SIZE = 500
REFRESH_DAYS = 30

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_date_range():
    end = datetime.now().replace(day=1) - timedelta(days=1)
    start = end.replace(year=end.year - 1, day=1)
    return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")


async def fetch_pageviews(session, title, start, end):
    url = (
        f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"
        f"/en.wikipedia/all-access/all-agents/{aiohttp.helpers.quote(title, safe='')}"
        f"/monthly/{start}/{end}"
    )
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
            if r.status != 200:
                return None
            data = await r.json()
            return sum(item["views"] for item in data.get("items", []))
    except Exception:
        return None


async def search_wikipedia_title(session, name, country_code):
    url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "list": "search",
        "srsearch": f"{name} {country_code}",
        "srlimit": 1,
        "format": "json"
    }
    try:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as r:
            if r.status != 200:
                return None
            data = await r.json()
            results = data.get("query", {}).get("search", [])
            return results[0]["title"] if results else None
    except Exception:
        return None


async def process_place(session, semaphore, place, start, end):
    async with semaphore:
        name = place["name_en"]
        country_code = place["country_code"]
        views = await fetch_pageviews(session, name, start, end)
        if views is None:
            title = await search_wikipedia_title(session, name, country_code)
            if title:
                views = await fetch_pageviews(session, title, start, end)
        return {"id": place["id"], "name": name, "views": views}


async def flush(results, today):
    found = 0
    for r in results:
        supabase.table("places").update({
            "wiki_pageviews_annual": r["views"],
            "wiki_pageviews_updated": today
        }).eq("id", r["id"]).execute()
        if r["views"] is not None:
            found += 1
    print(f"  Flushed {len(results)} places ({found} with data)")


async def main():
    start, end = get_date_range()
    print(f"Fetching pageviews {start} → {end}")

    cutoff = (datetime.now() - timedelta(days=REFRESH_DAYS)).date().isoformat()

    response = (
        supabase.table("places")
        .select("id, name_en, country_code")
        .eq("is_active", True)
        .or_(f"wiki_pageviews_updated.is.null,wiki_pageviews_updated.lt.{cutoff}")
        .execute()
    )

    # Filter NULL name_en in Python
    places = [p for p in response.data if p.get("name_en")]
    print(f"{len(places)} places to process")

    semaphore = asyncio.Semaphore(CONCURRENCY)
    today = datetime.now().date().isoformat()
    headers = {"User-Agent": "SunNomad/1.0 (hola@sunnomad.app)"}

    async with aiohttp.ClientSession(headers=headers) as session:
        tasks = [process_place(session, semaphore, p, start, end) for p in places]
        results = []

        for i, coro in enumerate(asyncio.as_completed(tasks)):
            result = await coro
            results.append(result)
            if (i + 1) % 100 == 0:
                print(f"  {i+1}/{len(places)} done...")
            if len(results) >= BATCH_SIZE:
                await flush(results, today)
                results = []

        if results:
            await flush(results, today)

    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
