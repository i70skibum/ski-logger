# Ski logger

Collects public conditions data for Copper, Winter Park, Arapahoe Basin, and Eldora every
15 minutes, so the ski dashboard has its own history of I-70 traffic, snow, and forecasts.

It runs on GitHub Actions (free for public repos) and saves everything as CSV files in `data/`.

## What gets logged

| Folder | Source | How often | What's in it |
|---|---|---|---|
| `data/snotel/` | USDA SNOTEL stations | hourly readings | Snow depth, snow water equivalent, precip, temperature at Copper Mountain, Grizzly Peak (A-Basin), Berthoud Summit (Winter Park), Lake Eldora |
| `data/forecast/` | National Weather Service | every 3 hours | Per mountain: forecast snow, temp range, max wind and gusts, max precip chance for the next 0-24, 24-48, 48-72 hours |
| `data/afd/` | NWS Boulder office | each new issue | The forecasters' written discussion, as text files |
| `data/events/` | CDOT COtrip | every 15 min, changes only | When closures, traction/chain laws, winter driving alerts, incidents, and road work start and end on I-70 (Vail Pass to C-470), US 40, US 6, and CO 119 |
| `data/speed/` | CDOT COtrip (key) | every 15 min | I-70 speeds (mph) from Copper to C-470: one row per snapshot, one column per road segment. `segments.csv` gives each segment's direction and coordinates. Blank means CDOT's confidence was low |
| `data/road_conditions/` | CDOT COtrip (key) | changes only | Official condition reports (dry, wet, snow packed, icy) for I-70 in the mountains, US 40 including Berthoud Pass, US 6 including Loveland Pass, CO 119 |
| `data/travel/` | CDOT COtrip (key) | when reported | I-70 segment travel times, kept only when CDOT reports a nonzero value |
| `data/errors.csv` | | | Any source that failed on a given run |

Files are split by month (`2026-11.csv`). SNOTEL times are Mountain Standard Time (the
stations don't observe daylight saving); everything else is Denver local time with its offset.

## Setup

1. Create a **public** GitHub repo and add these files, keeping the `.github/workflows/` folder path.
2. In the repo, go to **Actions** and enable workflows if prompted, then open **ski-logger** and
   click **Run workflow** to test it. A `data/` folder should appear within a minute or two.
3. For travel times, request a free key at <https://manage-api.cotrip.org/> and add it under
   **Settings > Secrets and variables > Actions > New repository secret** with the name
   `CDOT_API_KEY`. Until then, the snow, forecast, and road event data still log normally.
