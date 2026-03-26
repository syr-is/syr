#!/usr/bin/env bash
# Update dotted-decimal LAN IPs in the repo .env to match this machine's
# current IPv4 on the default route interface (usually Wi‑Fi when it's primary).
#
# Usage:
#   ./scripts/update-env-lan-ip.sh              # uses ../.env from script location
#   ./scripts/update-env-lan-ip.sh /path/.env   # explicit env file
#   ./scripts/update-env-lan-ip.sh .env 192.168.1.5   # force old IP if detection fails

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="${1:-${REPO_ROOT}/.env}"
FORCED_OLD_IP="${2:-}"

if [[ ! -f "${ENV_FILE}" ]]; then
	echo "error: file not found: ${ENV_FILE}" >&2
	exit 1
fi

get_lan_ip() {
	local iface ip
	iface="$(route -n get default 2>/dev/null | awk '/interface: / { print $2; exit }')"
	if [[ -n "${iface}" ]] && command -v ipconfig >/dev/null 2>&1; then
		ip="$(ipconfig getifaddr "${iface}" 2>/dev/null || true)"
		if [[ -n "${ip}" ]]; then
			echo "${ip}"
			return 0
		fi
	fi
	# Fallback: common macOS interface names for Wi‑Fi / Ethernet
	for iface in en0 en1 en2; do
		ip="$(ipconfig getifaddr "${iface}" 2>/dev/null || true)"
		if [[ -n "${ip}" ]]; then
			echo "${ip}"
			return 0
		fi
	done
	return 1
}

NEW_IP="$(get_lan_ip)" || {
	echo "error: could not detect a LAN IPv4 (route get default / ipconfig)." >&2
	exit 1
}

detect_old_ip() {
	local from_public
	from_public="$(grep -E '^PUBLIC_URL=' "${ENV_FILE}" 2>/dev/null | sed -n 's|^PUBLIC_URL=https\{0,1\}://\([0-9][0-9.]*\):.*|\1|p' | head -1)"
	if [[ -n "${from_public}" && "${from_public}" != "127.0.0.1" ]]; then
		echo "${from_public}"
		return 0
	fi
	grep -Eo '192\.168\.[0-9]{1,3}\.[0-9]{1,3}|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]{1,3}\.[0-9]{1,3}' "${ENV_FILE}" 2>/dev/null | head -1 || true
}

if [[ -n "${FORCED_OLD_IP}" ]]; then
	OLD_IP="${FORCED_OLD_IP}"
else
	OLD_IP="$(detect_old_ip)"
fi

if [[ -z "${OLD_IP}" ]]; then
	echo "error: could not find an existing private LAN IP in ${ENV_FILE}." >&2
	echo "Set PUBLIC_URL=http://<your-old-ip>:5173 or pass old IP as second argument." >&2
	exit 1
fi

if [[ "${OLD_IP}" == "${NEW_IP}" ]]; then
	echo "No change: .env already uses LAN IP ${NEW_IP}"
	exit 0
fi

# Literal string replace (avoid sed regex issues with dots in IPv4)
if command -v python3 >/dev/null 2>&1; then
	python3 -c "
import pathlib, sys
path, old, new = sys.argv[1:4]
p = pathlib.Path(path)
text = p.read_text()
p.write_text(text.replace(old, new))
" "${ENV_FILE}" "${OLD_IP}" "${NEW_IP}"
else
	export OLD_IP NEW_IP
	perl -i -pe 'BEGIN { $o = quotemeta $ENV{OLD_IP}; $n = $ENV{NEW_IP} } s/$o/$n/g' "${ENV_FILE}"
fi

echo "Updated ${OLD_IP} -> ${NEW_IP} in ${ENV_FILE}"
