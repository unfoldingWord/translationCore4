# Mac app icon

Source: `public/assets/translationcore-logo.png`, the existing translationCore mark.
`icon-1024.png` centers that mark at 80% of a transparent 1024 px square.
`icon.icns` contains the ten standard 16–1024 px representations. Both are
committed so packaging does not depend on an image toolchain.

To reproduce on macOS, from the repository root:

```sh
swift branding/make-icon.swift public/assets/translationcore-logo.png branding/icon-1024.png
mkdir -p /tmp/tc4.iconset
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" branding/icon-1024.png --out "/tmp/tc4.iconset/icon_${size}x${size}.png"
  sips -z "$((size * 2))" "$((size * 2))" branding/icon-1024.png --out "/tmp/tc4.iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns /tmp/tc4.iconset -o branding/icon.icns
```

The application uses this icon in Finder, Launchpad, and its running Dock entry.
