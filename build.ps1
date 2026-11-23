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
