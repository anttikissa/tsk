#!/bin/sh
# Pack this checkout and exercise the published-style bin without touching user state.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/tsk-packed-smoke.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

npm_config_userconfig="$tmp/npmrc" npm_config_cache="$tmp/npm-cache" \
  npm pack "$root" --pack-destination "$tmp" --ignore-scripts --silent
set -- "$tmp"/*.tgz
[ -f "$1" ] || { echo 'smoke: npm pack did not produce a tarball' >&2; exit 1; }
tarball=$1

smoke() {
  manager=$1
  bindir=$2
  project=$3
  mkdir -p "$project"
  git -C "$project" init -q
  (
    cd "$project"
    "$bindir/tsk" help > "$tmp/$manager-help.out"
    grep -q 'init' "$tmp/$manager-help.out"
    "$bindir/tsk" init
    "$bindir/tsk" add --title 'Packed smoke task' --description 'Exercise a packed CLI install'
    "$bindir/tsk" ls > "$tmp/$manager-ls.out"
    grep -q 'Packed smoke task' "$tmp/$manager-ls.out"
    "$bindir/tsk" ready > "$tmp/$manager-ready.out"
    grep -q 'Packed smoke task' "$tmp/$manager-ready.out"
    set -- tasks/*/task.ason
    [ -f "$1" ] || { echo "smoke ($manager): added task file not found" >&2; exit 1; }
    id=${1#tasks/}
    id=${id%/task.ason}
    "$bindir/tsk" show "$id" > "$tmp/$manager-show.out"
    grep -q 'Packed smoke task' "$tmp/$manager-show.out"
    "$bindir/tsk" done "$id"
    "$bindir/tsk" ls > "$tmp/$manager-done-ls.out"
    grep -q 'done' "$tmp/$manager-done-ls.out"
    "$bindir/tsk" ready > "$tmp/$manager-done-ready.out"
    ! grep -q 'Packed smoke task' "$tmp/$manager-done-ready.out"
  )
  echo "smoke: $manager install passed (project outside package checkout)"
}

# Both package managers get a private HOME, cache, and install location. A blank
# npm user config prevents reading/writing the caller's ~/.npmrc; all inputs are local.
mkdir -p "$tmp/npm-home" "$tmp/npm-prefix" "$tmp/bun-home" "$tmp/bun-install" "$tmp/bun-cache"
: > "$tmp/npmrc"
HOME="$tmp/npm-home" npm_config_userconfig="$tmp/npmrc" npm_config_cache="$tmp/npm-cache" \
  npm install --global --prefix "$tmp/npm-prefix" --offline --ignore-scripts "$tarball"
smoke npm "$tmp/npm-prefix/bin" "$tmp/npm-project"

HOME="$tmp/bun-home" BUN_INSTALL="$tmp/bun-install" \
  bun add --global --no-save --no-cache --cwd "$tmp" "$tarball"
smoke bun "$tmp/bun-install/bin" "$tmp/bun-project"
