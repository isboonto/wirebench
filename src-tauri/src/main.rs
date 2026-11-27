// JumperCraft desktop app: a native Rust (Tauri) shell around the editor UI.
// The circuit solver lives in the `wb-core` crate; the UI loads it compiled to
// WebAssembly, and the desktop shell also links it natively (see `self_test`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use serde::Serialize;

#[derive(Serialize)]
struct OpenedFile {
    name: String,
    path: String,
    contents: String,
}

/// Show a native "Open" dialog and return the chosen project file.
#[tauri::command]
async fn open_project(window: tauri::Window) -> Result<Option<OpenedFile>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Open JumperCraft project")
        .add_filter("JumperCraft project", &["wbproj", "json"])
        .add_filter("All files", &["*"])
        .set_parent(&window)
        .pick_file();
    let Some(path) = picked else { return Ok(None) };
    read_project(&path).map(Some)
}

fn read_project(path: &std::path::Path) -> Result<OpenedFile, String> {
    let contents = std::fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    Ok(OpenedFile {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: path.display().to_string(),
        contents,
    })
}

/// The project file JumperCraft was started with, if any: double-clicking a .wbproj file in
/// Windows Explorer (registered by the installer) runs `jumpercraft.exe "C:\…\name.wbproj"`.
#[tauri::command]
fn startup_file() -> Option<OpenedFile> {
    let arg = std::env::args_os().nth(1)?;
    let path = std::path::PathBuf::from(arg);
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    if ext != "wbproj" && ext != "json" {
        return None;
    }
    read_project(&path).ok()
}

/// Show a native "Save" dialog and write text or base64-encoded bytes.
/// Returns the saved path, or None if the user cancelled.
#[tauri::command]
async fn save_file(
    window: tauri::Window,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    text: Option<String>,
    base64: Option<String>,
) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let picked = rfd::FileDialog::new()
        .set_title("Save")
        .set_file_name(&default_name)
        .add_filter(&filter_name, &exts)
        .set_parent(&window)
        .save_file();
    let Some(path) = picked else { return Ok(None) };
    let bytes = match (text, base64) {
        (Some(t), _) => t.into_bytes(),
        (None, Some(b)) => base64::engine::general_purpose::STANDARD.decode(b).map_err(|e| e.to_string())?,
        (None, None) => return Err("nothing to save".into()),
    };
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

#[derive(Serialize)]
struct UserExample {
    name: String,
    file: String,
    contents: String,
}

#[derive(Serialize)]
struct UserExamples {
    /// The per-user folder (created if missing) — the one "Open examples folder" shows.
    dir: String,
    items: Vec<UserExample>,
}

/// Folders scanned for example projects, in menu order:
///   1. %APPDATA%\JumperCraft\examples  (per user, always writable)
///   2. %APPDATA%\Wirebench\examples  (the folder from when JumperCraft was called Wirebench)
///   3. <folder of jumpercraft.exe>\examples  (handy for a portable copy or a classroom install)
fn example_dirs() -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let appdata = std::path::PathBuf::from(appdata);
        dirs.push(appdata.join("JumperCraft").join("examples"));
        let old = appdata.join("Wirebench").join("examples");
        if old.is_dir() {
            dirs.push(old);
        }
    }
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        let d = exe_dir.join("examples");
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

/// Read every *.json / *.wbproj project in the example folders. Files are re-read on
/// each call, so new examples appear without restarting (let alone rebuilding) the app.
#[tauri::command]
fn list_examples() -> UserExamples {
    let dirs = example_dirs();
    if let Some(first) = dirs.first() {
        let _ = std::fs::create_dir_all(first);
    }
    let mut items = Vec::new();
    for dir in &dirs {
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        let mut paths: Vec<_> = rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .map(|x| x.eq_ignore_ascii_case("json") || x.eq_ignore_ascii_case("wbproj"))
                        .unwrap_or(false)
            })
            .collect();
        paths.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
        for path in paths {
            let Ok(contents) = std::fs::read_to_string(&path) else { continue };
            items.push(UserExample {
                name: path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                file: path.display().to_string(),
                contents,
            });
        }
    }
    UserExamples {
        dir: dirs.first().map(|d| d.display().to_string()).unwrap_or_default(),
        items,
    }
}

/// Show the per-user examples folder in File Explorer.
#[tauri::command]
fn open_examples_folder() -> Result<(), String> {
    let dir = example_dirs().into_iter().next().ok_or("APPDATA is not set")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Open a web address in the user's default browser (About page links).
/// Only https:// addresses are accepted, and only plain URL characters, so nothing else
/// can be launched through this.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let ok = url.starts_with("https://")
        && url.len() < 2000
        && url.chars().all(|c| c.is_ascii_alphanumeric() || "-._~:/?#[]@!$&'()*+,;=%".contains(c));
    if !ok {
        return Err("only https:// links can be opened".into());
    }
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Solve a small reference circuit with the native solver, so the UI can
/// confirm that the native core and the WebAssembly core agree.
#[tauri::command]
fn self_test() -> f64 {
    use wb_core::Element;
    let mut els = vec![Element::source(1, 0, 5.0, 25.0), Element::resistor(1, 2, 220.0), Element::diode(2, 0, 1.8, 15.0)];
    wb_core::solve(3, &mut els);
    els[2].i
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_project, startup_file, save_file, list_examples, open_examples_folder, open_url, self_test])
        .run(tauri::generate_context!())
        .expect("error while running JumperCraft");
}
