#!/bin/sh
# Renders the Chrome Web Store images and extension icons from store-assets/src.
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC="file://$PWD/src"
mkdir -p out

shot() { # page width height output [transparent]
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --virtual-time-budget=6000 --window-size="$2,$3" \
    ${5:+--default-background-color=00000000} --screenshot="$4" "$SRC/$1" 2>/dev/null
}

shot screenshot-1.html 1280 800 out/screenshot-1.png
shot screenshot-2.html 1280 800 out/screenshot-2.png
shot screenshot-3.html 1280 800 out/screenshot-3.png
shot promo-small.html 440 280 out/promo-small-440x280.png
shot promo-marquee.html 1400 560 out/promo-marquee-1400x560.png
shot "icon.html?size=128&pad=16" 128 128 out/store-icon-128.png 1

# Toolbar icons: small sizes fill the square so the mark stays legible.
for size in 16 32 48 96 128; do
  pad=0; [ "$size" -ge 96 ] && pad=$((size / 8))
  shot "icon.html?size=$size&pad=$pad" "$size" "$size" "../public/icon/$size.png" 1
done
