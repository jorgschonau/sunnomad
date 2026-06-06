#!/usr/bin/env python3
"""
Analyze duplicate hero images and recommend which to keep based on composition.
Usage: python3 analyze_dupes.py
"""
import os, base64, anthropic
from pathlib import Path
from collections import defaultdict

client = anthropic.Anthropic()
tmp = '/private/tmp'
dupes_dir = Path(f'{tmp}/sunnomad_dupes')

if not dupes_dir.exists():
    print(f"No dupes folder found at {dupes_dir}")
    exit()

files = list(dupes_dir.glob('dupe_*.webp'))
if not files:
    print("No dupe files found.")
    exit()

groups = defaultdict(list)
for f in files:
    parts = f.name.split('_')
    group_num = parts[1]
    groups[group_num].append(f)

print(f'Analyzing {len(groups)} duplicate groups...\n')
print('=' * 60)

for gnum, gfiles in sorted(groups.items()):
    if len(gfiles) < 2:
        continue

    scores = []
    for f in sorted(gfiles):
        try:
            img = f.read_bytes()
            b64 = base64.standard_b64encode(img).decode()
            r = client.messages.create(
                model='claude-sonnet-4-20250514',
                max_tokens=80,
                messages=[{'role': 'user', 'content': [
                    {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/webp', 'data': b64}},
                    {'type': 'text', 'text': 'Rate this travel hero image 1-10. Consider: location fills frame well, character naturally placed in lower third, top 20% clear for text overlay, good light. Reply ONLY: SCORE|REASON (one word reason)'}
                ]}]
            )
            result = r.content[0].text.strip()
            score = int(result.split('|')[0].strip())
            reason = result.split('|')[1].strip() if '|' in result else '?'
            scores.append((score, reason, f.name))
        except Exception as e:
            scores.append((0, 'error', f.name))

    scores.sort(reverse=True)
    print(f'\nGroup {gnum}:')
    for i, (score, reason, name) in enumerate(scores):
        tag = '✅ KEEP' if i == 0 else '🗑  DEL '
        print(f'  {tag} [{score}/10] {reason} — {name}')

print('\n' + '=' * 60)
print('Done. Review above and delete the DEL files manually.')
