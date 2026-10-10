#!/usr/bin/env sh
# One-off dev step (not needed to serve the site): rebuild vendor/echarts-5.5.1.custom.min.js,
# a tree-shaken ECharts 5.5.1 with only the charts/components the pages use (~0.6 MB vs 1.0 MB).
# Requires Node 18+ and network for npm. Output is committed, so this only runs when upgrading ECharts.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
cd "$tmp"
npm init -y >/dev/null
npm i echarts@5.5.1 esbuild@0.21 --no-audit --no-fund >/dev/null
cp "$here/echarts-entry.js" entry.js
node_modules/.bin/esbuild entry.js --bundle --minify --format=iife --target=es2018 --legal-comments=none \
  --outfile="$here/../vendor/echarts-5.5.1.custom.min.js"
echo "wrote vendor/echarts-5.5.1.custom.min.js"
