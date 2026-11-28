# Builds JumperCraft.
#   .\build.ps1            -> WebAssembly solver + desktop app (target\release\jumpercraft.exe)
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
$readmeVer = ([regex]'^# JumperCraft (\S+)').Match((Get-Content README.md -TotalCount 1)).Groups[1].Value
$short = ($ver -split '\.')[0..1] -join '.'
if ($cargoVer -ne $ver -or $helpVer -ne $ver -or $readmeVer -ne $short) {
  throw "Version mismatch: tauri.conf.json $ver, Cargo.toml $cargoVer, help.js $helpVer, README heading $readmeVer (should be $short)"
}

# Stamp the version on index.html's own files (js/..., css/..., the wasm) as ?v=<version>, so a
# browser that cached the previous release's scripts (GitHub Pages: 10 minutes) loads the new ones
# instead of mixing an old script with the new page.
$html = Get-Content web\index.html -Raw
# The stamp also carries a short hash of the scripts and styles, so it changes when a release is
# updated in place under the same version number.
$hashes = (Get-ChildItem web\js\*.js, web\css\*.css | Sort-Object FullName | Get-FileHash -Algorithm SHA256).Hash -join ''
$stamp = "$ver-" + (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::ASCII.GetBytes($hashes)))).Hash.Substring(0, 8).ToLower()
$stamped = [regex]::Replace($html, '(href|src)="((?:js|css)/[^"?]+|wasm/wb_core\.wasm)(\?v=[^"]*)?"', ('$1="$2?v=' + $stamp + '"'))
if ($stamped -ne $html) { [IO.File]::WriteAllText((Resolve-Path web\index.html), $stamped); $html = $stamped; Write-Host "==> index.html: file links stamped with ?v=$stamp" }

# index.html preloads every script it loads (see the comment there); stop if the two lists differ.
$scripts = [regex]::Matches($html, '<script src="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$preloads = [regex]::Matches($html, '<link rel="preload" href="([^"]+)" as="script"') | ForEach-Object { $_.Groups[1].Value }
if (($scripts -join ',') -ne ($preloads -join ',')) {
  throw "index.html: the <link rel=""preload""> list must match the <script> tags, in the same order.`n  scripts:  $($scripts -join ', ')`n  preloads: $($preloads -join ', ')"
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
  cargo build -p jumpercraft --release
  Write-Host 'Done: target\release\jumpercraft.exe'
}
