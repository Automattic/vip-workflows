#!/usr/bin/env python3
"""
Generate realistic test blog posts via LM Studio and publish to WordPress.

All posts use the classic car restoration topic. Each post gets:
- LLM-generated title, content (2-4 paragraphs), excerpt, and tag suggestions
- A relevant Unsplash featured image (automotive/classic car)
- Distributed across the target month with no empty days, 80% weekday bias
- Published times between 9am-5pm ET
- Categories from a curated list (LLM picks 1-2) plus "Test Content" for cleanup
- Random author from existing test authors
- _test_content meta for easy bulk cleanup

Usage:
    python tools/create-test-content.py --count 30
    python tools/create-test-content.py --count 30 --month 2
    python tools/create-test-content.py --count 30 --dry-run
    python tools/create-test-content.py --delete
"""

import argparse
import calendar
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

WP_URL = os.environ["WP_URL"].rstrip("/")
WP_AUTH = (os.environ["WP_USER"], os.environ["WP_APP_PASSWORD"])
LM_STUDIO_URL = os.environ["LM_STUDIO_URL"].rstrip("/")
UNSPLASH_KEY = os.environ.get("UNSPLASH_ACCESS_KEY", "")

API = f"{WP_URL}/wp-json/wp/v2"
ET = ZoneInfo("America/New_York")

CATEGORIES = [
    {"name": "Test Content", "slug": "test-content"},
    {"name": "Restoration", "slug": "restoration"},
    {"name": "Parts & Sourcing", "slug": "parts-sourcing"},
    {"name": "Buyer's Guide", "slug": "buyers-guide"},
    {"name": "Events & Shows", "slug": "events-shows"},
    {"name": "Shop Life", "slug": "shop-life"},
]

UNSPLASH_QUERIES = [
    "classic car restoration",
    "vintage automobile",
    "muscle car engine",
    "garage workshop car",
    "classic car interior",
    "vintage car show",
    "car engine rebuild",
    "old truck restoration",
    "classic car paint",
    "hot rod custom",
]


# ---------------------------------------------------------------------------
# WordPress helpers
# ---------------------------------------------------------------------------

def ensure_categories() -> dict[str, int]:
    """Create categories if they don't exist. Returns {slug: id}."""
    existing = {}
    page = 1
    while True:
        resp = requests.get(f"{API}/categories", auth=WP_AUTH, params={"per_page": 100, "page": page})
        if resp.status_code != 200 or not resp.json():
            break
        for cat in resp.json():
            existing[cat["slug"]] = cat["id"]
        page += 1

    result = {}
    for cat in CATEGORIES:
        if cat["slug"] in existing:
            result[cat["slug"]] = existing[cat["slug"]]
        else:
            resp = requests.post(f"{API}/categories", auth=WP_AUTH, json={"name": cat["name"], "slug": cat["slug"]})
            if resp.status_code == 201:
                result[cat["slug"]] = resp.json()["id"]
                print(f"  Created category: {cat['name']}")
            else:
                print(f"  ERROR creating category {cat['name']}: {resp.status_code}")
    return result


def ensure_tags(tag_names: list[str]) -> list[int]:
    """Get or create tags by name. Returns list of tag IDs."""
    tag_ids = []
    for name in tag_names:
        slug = name.lower().replace(" ", "-").replace("'", "")
        resp = requests.get(f"{API}/tags", auth=WP_AUTH, params={"slug": slug})
        if resp.status_code == 200 and resp.json():
            tag_ids.append(resp.json()[0]["id"])
            continue
        resp = requests.post(f"{API}/tags", auth=WP_AUTH, json={"name": name, "slug": slug})
        if resp.status_code == 201:
            tag_ids.append(resp.json()["id"])
    return tag_ids


def get_test_authors() -> list[dict]:
    """Fetch test authors (identified by author* slug pattern)."""
    authors = []
    page = 1
    while True:
        resp = requests.get(f"{API}/users", auth=WP_AUTH, params={"per_page": 100, "page": page, "roles": "author"})
        if resp.status_code != 200:
            break
        batch = resp.json()
        if not batch:
            break
        for user in batch:
            slug = user.get("slug", "")
            if slug.startswith("author") and slug.removeprefix("author").isdigit():
                authors.append({"id": user["id"], "name": user["name"]})
        page += 1
    return authors


def upload_featured_image(image_url: str, filename: str, post_title: str = "") -> int | None:
    """Download image and upload to WP media library. Returns attachment ID."""
    try:
        img_resp = requests.get(image_url, timeout=15)
        if img_resp.status_code != 200:
            return None

        content_type = img_resp.headers.get("content-type", "image/jpeg")
        resp = requests.post(
            f"{API}/media",
            auth=WP_AUTH,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Type": content_type,
            },
            data=img_resp.content,
        )
        if resp.status_code == 201:
            media_id = resp.json()["id"]
            title = f"[Test Content] {post_title}" if post_title else "[Test Content]"
            requests.post(
                f"{API}/media/{media_id}",
                auth=WP_AUTH,
                json={"title": title},
            )
            return media_id
    except Exception as e:
        print(f"    Image upload failed: {e}")
    return None


def get_unsplash_image() -> tuple[str, str] | None:
    """Fetch a random classic car image from Unsplash. Returns (url, filename)."""
    if not UNSPLASH_KEY:
        return None

    query = random.choice(UNSPLASH_QUERIES)
    try:
        resp = requests.get(
            "https://api.unsplash.com/photos/random",
            params={"query": query, "orientation": "landscape"},
            headers={"Authorization": f"Client-ID {UNSPLASH_KEY}"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            url = data["urls"]["regular"]
            photo_id = data["id"]
            return url, f"classic-car-{photo_id}.jpg"
    except Exception:
        pass
    return None


def html_paragraphs_to_blocks(html: str) -> str:
    """
    Turn HTML body copy into Gutenberg serialized blocks (core/paragraph per <p>).
    WordPress REST API stores this in post_content; the block editor opens it as blocks.
    Text outside <p>...</p> pairs is kept as extra paragraph blocks (no silent drop).
    """
    raw = (html or "").strip()
    if not raw:
        return "<!-- wp:paragraph -->\n<p></p>\n<!-- /wp:paragraph -->"

    def orphan_gap_to_block(gap: str) -> str | None:
        text = gap.strip()
        if not text:
            return None
        inner = text if re.match(r"^<p\b", text, re.IGNORECASE) else f"<p>{text}</p>"
        return f"<!-- wp:paragraph -->\n{inner}\n<!-- /wp:paragraph -->"

    pattern = re.compile(r"<p\b[^>]*>[\s\S]*?</p>", re.IGNORECASE)
    blocks: list[str] = []
    last_end = 0

    for m in pattern.finditer(raw):
        orphan = orphan_gap_to_block(raw[last_end : m.start()])
        if orphan:
            blocks.append(orphan)
        blocks.append(f"<!-- wp:paragraph -->\n{m.group(0).strip()}\n<!-- /wp:paragraph -->")
        last_end = m.end()

    tail = orphan_gap_to_block(raw[last_end:])
    if tail:
        blocks.append(tail)

    return "\n\n".join(blocks)


# ---------------------------------------------------------------------------
# Date distribution
# ---------------------------------------------------------------------------

def generate_publish_dates(count: int, month: int) -> list[datetime]:
    """
    Distribute posts across the given month.
    - Every day gets at least one post
    - 80% land on weekdays, 20% on weekends
    - Times between 9am-5pm ET
    - Posts cluster naturally (some days get 2-3)
    """
    year = datetime.now(ET).year
    days_in_month = calendar.monthrange(year, month)[1]

    all_days = [datetime(year, month, d, tzinfo=ET) for d in range(1, days_in_month + 1)]
    weekdays = [d for d in all_days if d.weekday() < 5]
    weekends = [d for d in all_days if d.weekday() >= 5]
    total_days = len(all_days)

    dates = []

    if count >= total_days:
        # Guarantee one post per day first.
        for day in all_days:
            dates.append(day)
        remaining = count - total_days
    else:
        # Fewer posts than days: still spread them but pick days with weekday bias.
        chosen_days = []
        n_weekday = min(int(count * 0.8), len(weekdays))
        n_weekend = count - n_weekday
        if n_weekend > len(weekends):
            n_weekend = len(weekends)
            n_weekday = count - n_weekend
        chosen_days = random.sample(weekdays, n_weekday) + random.sample(weekends, n_weekend)
        for day in chosen_days:
            dates.append(day)
        remaining = 0

    # Distribute remaining posts with 80/20 weekday bias.
    for _ in range(remaining):
        if random.random() < 0.8 and weekdays:
            dates.append(random.choice(weekdays))
        elif weekends:
            dates.append(random.choice(weekends))
        else:
            dates.append(random.choice(weekdays))

    # Add random time (9am-5pm ET) to each date.
    result = []
    for d in dates:
        hour = random.randint(9, 16)
        minute = random.randint(0, 59)
        second = random.randint(0, 59)
        result.append(d.replace(hour=hour, minute=minute, second=second))

    random.shuffle(result)
    return result


# ---------------------------------------------------------------------------
# LLM content generation
# ---------------------------------------------------------------------------

CATEGORY_NAMES = [c["name"] for c in CATEGORIES if c["slug"] != "test-content"]

SYSTEM_PROMPT = f"""You are an automotive journalist writing for a classic car restoration blog.
Your audience is enthusiasts who restore vintage American and European cars from the 1950s-1970s.

Write engaging, knowledgeable content that feels like a real editorial publication.
Vary your tone: some posts are technical how-tos, some are opinion pieces, some are event recaps,
some are buyer's advice, some are personal shop stories.

For each post, return valid JSON (no markdown fences) with these fields:
- "title": compelling headline (no quotes around it in the title itself)
- "content": HTML with 2-4 paragraphs, each in its own <p>...</p> (inline <strong>, <em>, <a> allowed). Each <p> becomes one Gutenberg paragraph block.
- "excerpt": 1-2 sentence summary for card/list views
- "tags": array of 2-4 relevant tags (e.g. "Mustang", "Rust Repair", "Carburetor Tuning")
- "categories": array of 1-2 category names from this list: {CATEGORY_NAMES}

Do NOT repeat topics. Each post should cover a distinct angle."""


def generate_post_content(post_number: int, total: int) -> dict | None:
    """Call LM Studio to generate a single post."""
    user_prompt = (
        f"Generate post {post_number} of {total} for our classic car restoration blog. "
        f"Pick a fresh angle you haven't used before. Return only the JSON object."
    )

    try:
        resp = requests.post(
            f"{LM_STUDIO_URL}/chat/completions",
            json={
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.9,
                "max_tokens": 1500,
            },
            timeout=120,
        )

        if resp.status_code != 200:
            print(f"    LLM error: {resp.status_code}")
            return None

        raw = resp.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown fences if the model wraps them anyway.
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            if raw.endswith("```"):
                raw = raw[: raw.rfind("```")]
        return json.loads(raw)

    except json.JSONDecodeError as e:
        print(f"    Failed to parse LLM response as JSON: {e}")
        print(f"    Raw: {raw[:200]}")
        return None
    except Exception as e:
        print(f"    LLM request failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Post creation
# ---------------------------------------------------------------------------

def create_post(
    post_data: dict,
    publish_date: datetime,
    author_id: int,
    category_map: dict[str, int],
    dry_run: bool = False,
) -> bool:
    """Create a single WordPress post."""
    # Resolve categories.
    cat_ids = [category_map["test-content"]]
    for cat_name in post_data.get("categories", []):
        slug = cat_name.lower().replace(" ", "-").replace("&", "").replace("'", "").strip("-")
        for known_slug, known_id in category_map.items():
            if known_slug == slug or cat_name == next(
                (c["name"] for c in CATEGORIES if c["slug"] == known_slug), ""
            ):
                cat_ids.append(known_id)
                break

    # Resolve tags.
    tag_names = post_data.get("tags", [])

    date_str = publish_date.strftime("%Y-%m-%dT%H:%M:%S")
    status = "publish" if publish_date <= datetime.now(ET) else "future"

    title = post_data.get("title", "Untitled Test Post")
    content = html_paragraphs_to_blocks(post_data.get("content", "<p>Test content.</p>"))
    excerpt = post_data.get("excerpt", "")

    if dry_run:
        print(f"  [DRY RUN] {title}")
        print(f"    Date: {publish_date.strftime('%b %d %I:%M%p ET')} ({status})")
        print(f"    Author ID: {author_id}")
        print(f"    Tags: {tag_names}")
        return True

    tag_ids = ensure_tags(tag_names) if tag_names else []

    # Upload featured image.
    featured_id = None
    image_result = get_unsplash_image()
    if image_result:
        img_url, img_filename = image_result
        featured_id = upload_featured_image(img_url, img_filename, title)

    payload = {
        "title": title,
        "content": content,
        "excerpt": excerpt,
        "status": status,
        "date": date_str,
        "author": author_id,
        "categories": list(set(cat_ids)),
        "tags": tag_ids,
    }
    if featured_id:
        payload["featured_media"] = featured_id

    resp = requests.post(f"{API}/posts", auth=WP_AUTH, json=payload)
    if resp.status_code == 201:
        post = resp.json()
        img_note = " + image" if featured_id else ""
        print(f"  Created: {title} (ID: {post['id']}, {status}, {publish_date.strftime('%b %d %I:%M%p')}{img_note})")
        return True

    print(f"  ERROR: {resp.status_code} {resp.text[:200]}")
    return False


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

def delete_test_content():
    """Delete all posts in the 'test-content' category, plus their media."""
    # Find the test-content category.
    resp = requests.get(f"{API}/categories", auth=WP_AUTH, params={"slug": "test-content"})
    if resp.status_code != 200 or not resp.json():
        print("  'Test Content' category not found. Nothing to delete.")
        return

    cat_id = resp.json()[0]["id"]

    count = 0
    images = 0
    page = 1
    while True:
        r = requests.get(
            f"{API}/posts",
            auth=WP_AUTH,
            params={"per_page": 100, "page": page, "categories": cat_id, "status": "publish,future,draft", "_fields": "id,featured_media"},
        )
        if r.status_code != 200 or not r.json():
            break
        batch = r.json()
        count += len(batch)
        images += sum(1 for p in batch if p.get("featured_media"))
        page += 1

    if count == 0:
        print("  No test content posts found.")
        return

    print(f"\n  Found {count} posts and {images} featured images to delete.")
    confirm = input("  Proceed? [y/N] ").strip().lower()
    if confirm != "y":
        print("  Aborted.")
        return

    print(f"\nDeleting posts in 'Test Content' category (ID: {cat_id})...")

    deleted = 0
    while True:
        resp = requests.get(
            f"{API}/posts",
            auth=WP_AUTH,
            params={"per_page": 100, "categories": cat_id, "status": "publish,future,draft"},
        )
        if resp.status_code != 200 or not resp.json():
            break
        for post in resp.json():
            if post.get("featured_media"):
                requests.delete(
                    f"{API}/media/{post['featured_media']}",
                    auth=WP_AUTH,
                    params={"force": True},
                )
            requests.delete(f"{API}/posts/{post['id']}", auth=WP_AUTH, params={"force": True})
            print(f"  Deleted: {post['title']['rendered']} (ID: {post['id']})")
            deleted += 1

    print(f"\nDeleted {deleted} test posts.")

    # Remove the category itself if now empty.
    resp = requests.get(f"{API}/categories/{cat_id}", auth=WP_AUTH)
    if resp.status_code == 200 and resp.json().get("count", 0) == 0:
        requests.delete(f"{API}/categories/{cat_id}", auth=WP_AUTH, params={"force": True})
        print("  Removed empty 'Test Content' category.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate test blog posts via LLM")
    parser.add_argument("--count", type=int, default=30, help="Number of posts (default: 30)")
    parser.add_argument("--month", type=int, default=datetime.now().month, help="Target month as number, e.g. 2=Feb, 12=Dec (default: current month)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without creating posts")
    parser.add_argument("--delete", action="store_true", help="Delete all test content")
    args = parser.parse_args()

    if args.delete:
        print("=== Cleanup Test Content ===\n")
        delete_test_content()
        return

    print("=== Generate Test Content ===\n")

    # 1. Ensure categories exist.
    print("Setting up categories...")
    category_map = ensure_categories()
    if "test-content" not in category_map:
        print("FATAL: Could not create 'Test Content' category.")
        sys.exit(1)
    print()

    # 2. Get test authors.
    print("Fetching test authors...")
    authors = get_test_authors()
    if not authors:
        print("No test authors found. Run create-test-authors.py first.")
        sys.exit(1)
    print(f"  Found {len(authors)} test authors: {', '.join(a['name'] for a in authors)}\n")

    # 3. Generate publish schedule.
    print("Generating publish schedule...")
    dates = generate_publish_dates(args.count, args.month)
    dates_sorted = sorted(dates)
    past = sum(1 for d in dates_sorted if d <= datetime.now(ET))
    future = len(dates_sorted) - past
    weekday_count = sum(1 for d in dates_sorted if d.weekday() < 5)
    print(f"  {len(dates)} posts: {past} published, {future} scheduled")
    print(f"  {weekday_count} weekday ({weekday_count * 100 // len(dates)}%), {len(dates) - weekday_count} weekend\n")

    # 4. Generate and create posts.
    print("Generating posts...\n")
    success = 0
    for i, publish_date in enumerate(dates_sorted, 1):
        author = random.choice(authors)
        print(f"[{i}/{args.count}] Generating content...")

        post_data = generate_post_content(i, args.count)
        if not post_data:
            print("  Skipping (LLM failure).\n")
            continue

        if create_post(post_data, publish_date, author["id"], category_map, dry_run=args.dry_run):
            success += 1

        # Brief pause to be kind to LM Studio and Unsplash rate limits.
        if not args.dry_run and i < args.count:
            time.sleep(1)

        print()

    print(f"=== Done: {success}/{args.count} posts created ===")


if __name__ == "__main__":
    main()
