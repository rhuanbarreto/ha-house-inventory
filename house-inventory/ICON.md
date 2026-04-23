# Add-on icon

`icon.svg` is a minimal placeholder. Home Assistant expects a rasterized
`icon.png` (square, 128 × 128) and optionally `logo.png` (banner, roughly
500 × 250).

To generate them from the SVG:

```sh
# With ImageMagick / rsvg-convert
rsvg-convert -w 128 -h 128 icon.svg > icon.png

# Or with a browser — open icon.svg, right-click the canvas, Save Image As
```

Replace this file with a proper designed icon whenever you're ready. HA
will fall back to a generic package icon if `icon.png` is missing.
