#!/usr/bin/env bash
# Symlink this repo into Cinnamon's applets directory so the panel can load it.
set -euo pipefail

UUID="claude-usage@jakob"
REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APPLETS_DIR="${HOME}/.local/share/cinnamon/applets"
TARGET="${APPLETS_DIR}/${UUID}"

mkdir -p "${APPLETS_DIR}"

if [[ -L "${TARGET}" ]]; then
    current="$(readlink -f "${TARGET}")"
    if [[ "${current}" == "${REPO_DIR}" ]]; then
        echo "Already linked: ${TARGET} -> ${REPO_DIR}"
    else
        echo "Replacing existing symlink: ${TARGET} (was -> ${current})"
        rm "${TARGET}"
        ln -s "${REPO_DIR}" "${TARGET}"
    fi
elif [[ -e "${TARGET}" ]]; then
    echo "Refusing to overwrite non-symlink at ${TARGET}" >&2
    echo "Move or remove it first, then re-run." >&2
    exit 1
else
    ln -s "${REPO_DIR}" "${TARGET}"
    echo "Linked: ${TARGET} -> ${REPO_DIR}"
fi

cat <<EOF

Done. To enable the applet:
  1. Right-click the Cinnamon panel -> "Applets"
  2. Find "Claude Usage" in the list, select it, and click the + button.

To reload after code changes without restarting Cinnamon:
  dbus-send --session --dest=org.Cinnamon.LookingGlass --type=method_call \\
    /org/Cinnamon/LookingGlass org.Cinnamon.LookingGlass.ReloadExtension \\
    string:'${UUID}' string:'APPLET'
EOF
