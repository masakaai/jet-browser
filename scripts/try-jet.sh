#!/bin/sh
set -eu

JET_BROWSER_VERSION='0.8.0'
JET_BROWSER_IMAGE_DIGEST='sha256:0aeb9144beba4ca9a2445e653fe42d6ea525b9fee41bc78c05d468ffd6daaa4b'
JET_BROWSER_IMAGE="ghcr.io/masakaai/jet-browser@${JET_BROWSER_IMAGE_DIGEST}"
JET_BROWSER_PLATFORM='linux/amd64'
JET_BROWSER_SECCOMP_SHA256='5f4c3f92d6cf19fd6dfbbd4197e5a63546866ff8c1a3998e5c99bc589b2fcf11'
JET_BROWSER_SECCOMP_URL="https://raw.githubusercontent.com/masakaai/jet-browser/v${JET_BROWSER_VERSION}/seccomp_profile.json"

fail() {
  printf 'Jet Browser try failed: %s\n' "$1" >&2
  exit 1
}

for required_command in curl docker mktemp; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is required"
done

if command -v sha256sum >/dev/null 2>&1; then
  sha256_file() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  fail 'sha256sum or shasum is required'
fi

docker info >/dev/null 2>&1 || fail 'Docker is installed but its daemon is not available'

jet_try_tmp_root=${TMPDIR:-/tmp}
jet_try_directory=$(mktemp -d "${jet_try_tmp_root%/}/jet-browser-try.XXXXXX")
jet_try_seccomp="$jet_try_directory/seccomp_profile.json"
jet_try_responses="$jet_try_directory/responses.jsonl"
jet_try_container="jet-browser-try-$$"

cleanup() {
  docker rm -f "$jet_try_container" >/dev/null 2>&1 || true
  rm -f "$jet_try_seccomp" "$jet_try_responses"
  rmdir "$jet_try_directory" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

printf 'Downloading the pinned Jet Browser security policy...\n'
curl -fsSL "$JET_BROWSER_SECCOMP_URL" -o "$jet_try_seccomp" || fail 'could not download the security policy'
jet_try_actual_sha=$(sha256_file "$jet_try_seccomp")
if [ "$jet_try_actual_sha" != "$JET_BROWSER_SECCOMP_SHA256" ]; then
  fail 'security policy checksum did not match the v0.8.0 release'
fi

printf 'Pulling %s for %s...\n' "$JET_BROWSER_IMAGE" "$JET_BROWSER_PLATFORM"
docker pull --platform="$JET_BROWSER_PLATFORM" "$JET_BROWSER_IMAGE"

printf 'Verifying browser startup, native input, DOM state, and PNG capture...\n'
cat <<'JSONL' | docker run --rm -i --name "$jet_try_container" \
  --platform="$JET_BROWSER_PLATFORM" --network=none --cap-drop=ALL \
  --cap-add=SETUID --cap-add=SETGID \
  --security-opt=no-new-privileges \
  --security-opt=systempaths=unconfined \
  --security-opt=apparmor=unconfined \
  --security-opt="seccomp=$jet_try_seccomp" \
  --memory=1g --cpus=2 --pids-limit=256 --shm-size=256m \
  --env=JET_BROWSER_SMOKE=1 "$JET_BROWSER_IMAGE" >"$jet_try_responses"
{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"normal"}
{"op":"navigate","url":"http://127.0.0.1:8080/"}
{"op":"input","events":[{"type":"pointer","phase":"down","x":180,"y":42,"button":0},{"type":"pointer","phase":"up","x":180,"y":42,"button":0},{"type":"text","text":"open-source runtime"}]}
{"op":"evaluate","expression":"(()=>({value:document.querySelector('#message').value,result:document.querySelector('#result').value}))()"}
{"op":"snapshot"}
{"op":"screenshot"}
{"op":"close"}
JSONL

jet_try_line_count=$(wc -l <"$jet_try_responses" | tr -d ' ')
jet_try_ok_count=$(grep -c '"ok":true' "$jet_try_responses" || true)
if [ "$jet_try_line_count" -ne 7 ] || [ "$jet_try_ok_count" -ne 7 ] || grep -q '"ok":false' "$jet_try_responses"; then
  head -c 2000 "$jet_try_responses" >&2 || true
  printf '\n' >&2
  fail 'the runtime did not complete all seven ordered operations'
fi

grep -Fq '"title":"Jet Browser Ready"' "$jet_try_responses" || fail 'the fixture title was not verified'
grep -Fq '"value":"open-source runtime"' "$jet_try_responses" || fail 'native input did not reach the DOM'
grep -Fq 'iVBORw0KGgo' "$jet_try_responses" || fail 'the screenshot response was not a PNG'

printf '%s\n' "{\"status\":\"passed\",\"version\":\"${JET_BROWSER_VERSION}\",\"network\":\"disabled\",\"nativeInput\":\"verified\",\"dom\":\"verified\",\"screenshot\":\"verified PNG\"}"
