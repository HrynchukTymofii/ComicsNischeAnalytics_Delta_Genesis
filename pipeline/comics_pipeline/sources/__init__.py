"""Adapters for sources other than Sensor Tower (Prompt 8).

Each adapter reads raw files from data/raw/genesis and returns plain records tagged with
`source`, `as_of` and, for money, `revenue_basis` and `bound` ("point" | "lower"). They are
snapshots and qualitative data (store pages, prices, reviews, ads, web traffic), never monthly
series, so they are written by `make intel` next to — never into — the Sensor Tower tables.
"""
