# HA House Inventory

A Home Assistant add-on repository that tracks the physical assets in your
house — appliances, electronics, furniture, tools — and auto-enriches each one
with product pages, support sites, and downloaded manual PDFs.

Smart devices are imported automatically from Home Assistant's device
registry. Dumb assets (sofas, drills, a non-smart fridge) are added by hand.
All data and downloaded manuals live on `/data`, so they are included in every
Home Assistant backup.

## Install

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Click the three-dot menu (top right) → **Repositories**.
3. Add this URL: `https://github.com/rhuanbarreto/ha-house-inventory`
4. Find **House Inventory** in the store and click **Install**.
5. Start the add-on, then open it from the sidebar.

## Add-ons in this repository

- [**House Inventory**](./house-inventory/) — the inventory tracker itself.

## Development

This repo uses Bun + TypeScript. See [`house-inventory/DOCS.md`](./house-inventory/DOCS.md)
for architecture and dev-loop instructions.
