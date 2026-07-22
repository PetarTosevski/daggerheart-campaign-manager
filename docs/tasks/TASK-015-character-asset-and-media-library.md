# Task 015 — Character Asset and Media Library

## Objective

Create a unified private asset library for portraits, class artwork, sheet images, campaign art, maps, class recordings, and other user-owned media.

## Suggested schema

```text
assets
- id
- campaign_id
- asset_type
- name
- description nullable
- bucket
- object_path
- original_filename
- mime_type
- size_bytes
- checksum
- width nullable
- height nullable
- duration_seconds nullable
- status
- created_at
- updated_at
```

```text
asset_tags
- id
- campaign_id
- name
```

```text
asset_links
- id
- campaign_id
- asset_id
- entity_type
- entity_id
- role
- created_at
```

## Supported types

```text
CHARACTER_PORTRAIT
CLASS_ARTWORK
SHEET_IMAGE
CAMPAIGN_ART
MAP_IMAGE
AUDIO_RECORDING
AMBIENT_AUDIO_REFERENCE
OTHER
```

## Scope

Implement:

- Private upload and playback/preview.
- MIME, size, and metadata validation.
- Search, filters, tags, rename, archive, and usage tracking.
- Reusable asset picker.
- Character/class/sheet associations.
- Safe placeholders for broken references.
- RLS, tests, and documentation.

## Rules

- Preserve originals.
- No permanent public URLs.
- Prevent deletion while referenced.
- Prefer archival.
- Support only user-owned or properly licensed media.
- Do not assume third-party tools such as Pocket Bard expose an API.

## Acceptance criteria

- One unified private asset library exists.
- Character and class media use a reusable picker.
- User-owned audio can play securely.
- Usage is visible.
- Referenced assets cannot be silently deleted.
