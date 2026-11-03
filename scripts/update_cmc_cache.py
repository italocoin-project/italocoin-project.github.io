#!/usr/bin/env python3
"""Fetch the latest CoinMarketCap listings and write the static site cache."""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_KEY = os.environ.get("CMC_API_KEY", "").strip()
if not API_KEY:
    sys.exit("ERROR: missing CMC_API_KEY repository secret")

url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?start=1&limit=300&convert=USD"
request = urllib.request.Request(
    url,
    headers={"X-CMC_PRO_API_KEY": API_KEY, "Accept": "application/json"},
)
try:
    with urllib.request.urlopen(request, timeout=40) as response:
        payload = json.loads(response.read().decode("utf-8"))
except Exception as exc:
    sys.exit(f"ERROR: CoinMarketCap request failed: {exc}")

status = payload.get("status") or {}
if status.get("error_code", 0) != 0:
    sys.exit("ERROR: CoinMarketCap API: " + str(status.get("error_message", "unknown error")))

coins = []
for item in payload.get("data", []):
    usd = ((item.get("quote") or {}).get("USD") or {})
    coins.append({
        "id": item.get("slug"),
        "cmc_id": item.get("id"),
        "name": item.get("name"),
        "symbol": item.get("symbol"),
        "rank": item.get("cmc_rank"),
        "price": usd.get("price"),
        "change_24h": usd.get("percent_change_24h"),
        "change_7d": usd.get("percent_change_7d"),
        "change_30d": usd.get("percent_change_30d"),
        "market_cap": usd.get("market_cap"),
        "volume_24h": usd.get("volume_24h"),
        "circulating_supply": item.get("circulating_supply"),
        "total_supply": item.get("total_supply"),
        "max_supply": item.get("max_supply"),
        "last_updated": usd.get("last_updated") or item.get("last_updated"),
    })

if len(coins) < 250:
    sys.exit(f"ERROR: incomplete CoinMarketCap response ({len(coins)} assets)")

destination = Path("data/market/cmc-market.json")
destination.parent.mkdir(parents=True, exist_ok=True)
document = {
    "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "source": "CoinMarketCap API",
    "count": len(coins),
    "coins": coins,
}
serialized = json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n"
destination.write_text(serialized, encoding="utf-8")
api_destination = Path("api/v1/coins.json")
api_destination.parent.mkdir(parents=True, exist_ok=True)
api_destination.write_text(serialized, encoding="utf-8")
print(f"Updated {destination} and {api_destination} with {len(coins)} assets")
