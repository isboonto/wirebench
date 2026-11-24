# Builds Wirebench.
#   .\build.ps1            -> WebAssembly solver + desktop app (target\release\wirebench.exe)
#   .\build.ps1 -Installer -> also builds Windows installers (needs: cargo install tauri-cli --version "^2")
#   .\build.ps1 -Test      -> runs the Rust solver tests first
param([switch]$Installer, [switch]$Test)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (rustup target list --installed | Select-String 'wasm32-unknown-unknown')) {
  rustup target add wasm32-unknown-unknown
}
if ($Test) { cargo test -p wb-core }

# The version lives in four places; stop if they disagree (the README heading shows major.minor).
$ver = ([regex]'"version":\s*"([^"]+)"').Match((Get-Content src-tauri\tauri.conf.json -Raw)).Groups[1].Value
$cargoVer = ([regex]'(?m)^version\s*=\s*"([^"]+)"').Match((Get-Content src-tauri\Cargo.toml -Raw)).Groups[1].Value
$helpVer = ([regex]"WB\.VERSION\s*=\s*'([^']+)'").Match((Get-Content web\js\help.js -Raw)).Groups[1].Value
$readmeVer = ([regex]'^# Wirebench (\S+)').Match((Get-Content README.md -TotalCount 1)).Groups[1].Value
$short = ($ver -split '\.')[0..1] -join '.'
if ($cargoVer -ne $ver -or $helpVer -ne $ver -or $readmeVer -ne $short) {
  throw "Version mismatch: tauri.conf.json $ver, Cargo.toml $cargoVer, help.js $helpVer, README heading $readmeVer (should be $short)"
}

Write-Host '==> Building the Rust circuit solver for the UI (WebAssembly)'
cargo build -p wb-core --target wasm32-unknown-unknown --release
New-Item -ItemType Directory -Force web\wasm | Out-Null
Copy-Item target\wasm32-unknown-unknown\release\wb_core.wasm web\wasm\wb_core.wasm -Force

if (-not (Test-Path src-tauri\icons\icon.ico)) { node tools\make-icons.js }

if ($Installer) {
  Write-Host '==> Building installers'
  Push-Location src-tauri; cargo tauri build; Pop-Location
  Write-Host 'Installers are in target\release\bundle\'
} else {
  Write-Host '==> Building the desktop app'
  cargo build -p wirebench --release
  Write-Host 'Done: target\release\wirebench.exe'
}
