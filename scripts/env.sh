# Prepends the project's portable toolchain (Node 24, Blender 4.5 LTS, KTX-Software) to PATH.
# Usage (Git Bash): source scripts/env.sh && npm test
SIEGE_TOOLS="$(cygpath -u "$LOCALAPPDATA")/Programs/siege-tools"
export PATH="$SIEGE_TOOLS/node:$SIEGE_TOOLS/blender:$SIEGE_TOOLS/ktx/bin:$PATH"
export BLENDER_BIN="$SIEGE_TOOLS/blender/blender.exe"
export DISABLE_TELEMETRY=1
export DO_NOT_TRACK=1
