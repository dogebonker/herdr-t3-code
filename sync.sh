#!/bin/sh
# The standalone mods are copies of the layout's. Edit them under herdr-t3/mods, then run this.
# mod.json stays per folder: in the layout the layout places the mod, alone it docks itself.
set -eu
cd "$(dirname "$0")"
for m in t3-focus t3-theme t3-limits; do
  rsync -a --delete --exclude mod.json "herdr-t3/mods/$m/" "$m/mods/$m/"
done
