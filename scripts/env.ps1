# Prepends the project's portable toolchain (Node 24, Blender 4.5 LTS, KTX-Software) to PATH.
# Usage (PowerShell): . ./scripts/env.ps1; npm test
$SiegeTools = Join-Path $env:LOCALAPPDATA 'Programs\siege-tools'
$env:PATH = @(
  (Join-Path $SiegeTools 'node'),
  (Join-Path $SiegeTools 'blender'),
  (Join-Path $SiegeTools 'ktx\bin'),
  $env:PATH
) -join ';'
$env:BLENDER_BIN = Join-Path $SiegeTools 'blender\blender.exe'
$env:DISABLE_TELEMETRY = '1'
$env:DO_NOT_TRACK = '1'
