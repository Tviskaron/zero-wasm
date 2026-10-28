#!/usr/bin/env bash
set -euo pipefail

# Use a separate index so publishing never switches or changes the source branch.
source_sha=$(git rev-parse HEAD)
repo_git_dir=$(git rev-parse --absolute-git-dir)
build_dir=$(cd "${1:-dist}" && pwd)
test -f "$build_dir/index.html"
test -f "$build_dir/.nojekyll"
pages_tmp=$(mktemp -d)
trap 'rm -rf "$pages_tmp"' EXIT
export GIT_DIR="$repo_git_dir"
export GIT_WORK_TREE="$build_dir"
export GIT_INDEX_FILE="$pages_tmp/index"
cd "$build_dir"

# The first publication is an orphan commit: no source files enter its history.
parent=''
git ls-remote --heads origin refs/heads/gh-pages > "$pages_tmp/remote-ref"
if [[ -s "$pages_tmp/remote-ref" ]]; then
  git fetch --no-tags origin refs/heads/gh-pages
  parent=$(git rev-parse FETCH_HEAD)
fi
git read-tree --empty
git add --all --force -- .
tree=$(git write-tree)
if [[ -n "$parent" && "$tree" == "$(git rev-parse "$parent^{tree}")" ]]; then
  site_commit=$parent
else
  commit_args=("$tree" -m "Build site from $source_sha")
  if [[ -n "$parent" ]]; then
    commit_args+=(-p "$parent")
  fi
  site_commit=$(git commit-tree "${commit_args[@]}")
fi

# A normal push preserves published history and rejects concurrent updates.
git push origin "$site_commit:refs/heads/gh-pages"
git update-ref refs/remotes/origin/gh-pages "$site_commit"
printf 'Published compiled site %s from source %s\n' "$site_commit" "$source_sha"
