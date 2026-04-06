#!/usr/bin/env fish

# Dice Tower - Foundry symlink setup
# Creates a symlink from this repo's dist output into your Foundry modules directory.
# Run pnpm run build (or pnpm run build:local, if your setup provides it) first.

set -l script_dir (dirname (realpath (status --current-filename)))
set -l project_dir (dirname "$script_dir")
set -l module_id "dice-tower"
set -l build_dir "$project_dir/dist"
set -l module_json "$build_dir/module.json"

echo ""
echo "Dice Tower - Foundry Symlink Setup"
echo "==================================="
echo ""

set -l arg_path ""
if test (count $argv) -gt 0
    set arg_path $argv[1]
end

set -l env_path ""
if set -q FOUNDRY_DATA_PATH
    set env_path $FOUNDRY_DATA_PATH
end

set -l default_path ""
if test -n "$arg_path"
    set default_path $arg_path
else if test -n "$env_path"
    set default_path $env_path
end

set -l data_path ""
if test -n "$default_path"
    echo "Using Foundry data path hint: $default_path"
    read -P "Press Enter to accept, or enter a different Foundry data folder: " data_path
    if test -z "$data_path"
        set data_path $default_path
    end
else
    read -P "Enter the full path to your Foundry data folder: " data_path
end

# Strip trailing whitespace and slashes
set data_path (string trim -- "$data_path")
set data_path (string replace -r '/+$' '' -- "$data_path")

if test -z "$data_path"
    echo "No path entered. Aborting."
    exit 1
end

# Accept either a Foundry root folder or the Data folder itself.
if not string match -qr '/Data$' -- "$data_path"
    set data_path "$data_path/Data"
end

if not test -d "$data_path"
    echo "No folder found at: $data_path"
    echo "Tip: pass a path argument, for example:"
    echo "  pnpm run link:foundry -- ~/FoundryVTT"
    exit 1
end

set -l modules_dir "$data_path/modules"
set -l symlink_path "$modules_dir/$module_id"

if not test -d "$modules_dir"
    mkdir -p "$modules_dir"
end

# Validate dist build exists before linking.
if not test -d "$build_dir"
    echo ""
    echo "Build directory not found at:"
    echo "  $build_dir"
    echo ""
    echo "Run pnpm run build first, then re-run this script."
    exit 1
end

if not test -f "$module_json"
    echo ""
    echo "module.json not found at:"
    echo "  $module_json"
    echo ""
    echo "Run pnpm run build first, then re-run this script."
    exit 1
end

# Detect what already exists at the target path.
set -l existing_type ""
if test -L "$symlink_path"
    set existing_type "symlink"
else if test -d "$symlink_path"
    set existing_type "folder"
else if test -e "$symlink_path"
    set existing_type "file"
end

if test -n "$existing_type"
    echo ""
    echo "A $existing_type already exists at:"
    echo "  $symlink_path"
    read -P "Replace it with a symlink to this repo dist? [y/N] " confirm
    if not string match -qi "y" -- "$confirm"
        echo "Aborting."
        exit 0
    end

    if test "$existing_type" = "folder"
        rm -rf "$symlink_path"
    else
        rm "$symlink_path"
    end
end

ln -s "$build_dir" "$symlink_path"
if test $status -ne 0
    echo "Failed to create symlink."
    exit 1
end

echo ""
echo "Symlink created:"
echo "  $symlink_path"
echo "  -> $build_dir"
echo ""
echo "Next steps:"
echo "  1) Restart Foundry (or refresh Setup/World modules list)"
echo "  2) Re-run pnpm run build after code changes"
