#!/usr/bin/env bash
# Downloads Matterport's self-hosted Showcase bundle (Bundle SDK) into public/matterport-bundle/.
# The bundle ships inside the npm package @matterport/webcomponent (built-bundle/). Its licence
# does not allow redistribution, so the folder is git-ignored and each developer fetches it.
# Without it the 3D tour still works through the Embed SDK, but floor overlays are disabled.
set -euo pipefail
VERSION="${MATTERPORT_WEBCOMPONENT_VERSION:-0.1.47}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HERE/public/matterport-bundle"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
(cd "$TMP" && npm pack "@matterport/webcomponent@$VERSION" --silent >/dev/null && tar xzf ./*.tgz)
rm -rf "$DEST"
cp -R "$TMP/package/built-bundle" "$DEST"
echo "Matterport bundle $(cat "$DEST/version.txt" 2>/dev/null | cut -d_ -f1) installed in public/matterport-bundle/"
