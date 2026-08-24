#!/usr/bin/env python3
"""
Create test authors in WordPress via REST API.

Creates 9 authors (Author 1 through Author 9) with test email addresses.
Emails use @test.local. Identified by slug pattern (author1, author2...) for cleanup.

Usage:
    python tools/create-test-authors.py
    python tools/create-test-authors.py --count 5
    python tools/create-test-authors.py --delete   # Remove all test authors
"""

import argparse
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv
import os

load_dotenv(Path(__file__).parent / ".env")

WP_URL = os.environ["WP_URL"].rstrip("/")
WP_AUTH = (os.environ["WP_USER"], os.environ["WP_APP_PASSWORD"])
API = f"{WP_URL}/wp-json/wp/v2"


def get_test_authors():
    """Fetch all authors with @test.local emails."""
    authors = []
    page = 1
    while True:
        resp = requests.get(
            f"{API}/users",
            auth=WP_AUTH,
            params={"per_page": 100, "page": page, "roles": "author"},
        )
        if resp.status_code != 200:
            break
        batch = resp.json()
        if not batch:
            break
        for user in batch:
            email = user.get("email", "") or user.get("slug", "")
            if email.endswith("@test.local") or user.get("slug", "").startswith("author"):
                authors.append(user)
        page += 1
    return authors


def create_authors(count: int):
    """Create test authors."""
    # First register the meta field so WP accepts it.
    created = []
    for i in range(1, count + 1):
        username = f"author{i}"
        display_name = f"Author {i}"
        email = f"author{i}@test.local"

        resp = requests.post(
            f"{API}/users",
            auth=WP_AUTH,
            json={
                "username": username,
                "email": email,
                "password": "TestAuthor123!",
                "name": display_name,
                "first_name": "Author",
                "last_name": str(i),
                "roles": ["author"],
            },
        )

        if resp.status_code == 201:
            user = resp.json()
            print(f"  Created: {display_name} (ID: {user['id']}, {email})")
            created.append(user)
        elif resp.status_code == 400 and "existing_user" in resp.text:
            print(f"  Skipped: {display_name} (already exists)")
        else:
            print(f"  ERROR creating {display_name}: {resp.status_code} {resp.text}")

    return created


def delete_test_authors():
    """Delete all test authors (reassign posts to admin user 1)."""
    authors = get_test_authors()
    if not authors:
        print("  No test authors found.")
        return

    for author in authors:
        name = author.get("name", author.get("slug", f"ID {author['id']}"))
        resp = requests.delete(
            f"{API}/users/{author['id']}",
            auth=WP_AUTH,
            params={"reassign": 1, "force": True},
        )
        if resp.status_code == 200:
            print(f"  Deleted: {name} (ID: {author['id']})")
        else:
            print(f"  ERROR deleting {name}: {resp.status_code} {resp.text}")


def main():
    parser = argparse.ArgumentParser(description="Create test authors in WordPress")
    parser.add_argument("--count", type=int, default=9, help="Number of authors (default: 9)")
    parser.add_argument("--delete", action="store_true", help="Delete all test authors instead")
    args = parser.parse_args()

    print("=== Test Authors ===\n")

    if args.delete:
        print("Deleting test authors...")
        delete_test_authors()
    else:
        print(f"Creating {args.count} test authors...")
        create_authors(args.count)

    print("\nDone!")


if __name__ == "__main__":
    main()
