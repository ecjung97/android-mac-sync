// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, State, Window};

// Our Kill-Switch state manager
struct TransferState {
    cancel_flag: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    current: usize,
    total: usize,
    file_name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileItem {
    name: String,
    is_dir: bool,
    date_str: String,
    timestamp: u64,
}

#[tauri::command]
fn cancel_transfer(state: State<'_, TransferState>) {
    // Flips the kill-switch to true
    state.cancel_flag.store(true, Ordering::Relaxed);
}

// 1. Fetch Mac Files
#[tauri::command]
fn list_local_files(path: &str) -> Result<Vec<FileItem>, String> {
    let actual_path = if path.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| String::from("/"));
        path.replacen("~", &home, 1)
    } else {
        path.to_string()
    };

    let mut files = Vec::new();
    let entries = std::fs::read_dir(&actual_path)
        .map_err(|e| format!("Failed to read Mac directory: {}", e))?;

    for entry in entries {
        if let Ok(entry) = entry {
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            let name = entry.file_name().into_string().unwrap_or_default();

            // Get modified time natively on Mac
            let sys_time = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let timestamp = sys_time
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            if !name.starts_with('.') {
                files.push(FileItem {
                    name,
                    is_dir: file_type.is_dir(),
                    date_str: String::new(), // Frontend will format Mac timestamp
                    timestamp,
                });
            }
        }
    }
    Ok(files)
}

// 2. Fetch S25 Ultra Files
#[tauri::command]
fn list_remote_files(path: &str) -> Result<Vec<FileItem>, String> {
    // Added "-L" flag to follow symlinks like /sdcard
    let output = Command::new("adb")
        .args(["shell", "ls", "-lL", path])
        .output()
        .map_err(|e| format!("Failed to execute adb: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() || line.starts_with("total") {
            continue;
        }

        // Skip raw symlinks if they somehow bypass the -L flag
        if line.contains(" -> ") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();

        if parts.len() >= 7 {
            let is_dir = parts[0].starts_with('d');

            // Reconstruct the date string safely
            let date_str = format!("{} {}", parts[5], parts[6]);

            // Reconstruct the filename (handles spaces)
            let name = parts[7..].join(" ");

            files.push(FileItem {
                name,
                is_dir,
                date_str,
                timestamp: 0,
            });
        }
    }
    Ok(files)
}

// 3. Transfer: Phone to Mac (Pull)
#[tauri::command]
fn pull_file(remote_path: &str, local_dest: &str) -> Result<String, String> {
    // Expand the ~ if pulling to a Mac home directory
    let actual_local = if local_dest.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| String::from("/"));
        local_dest.replacen("~", &home, 1)
    } else {
        local_dest.to_string()
    };

    let output = std::process::Command::new("adb")
        .args(["pull", remote_path, &actual_local])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("Transfer complete".into())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

// 4. Transfer: Mac to Phone (Push)
#[tauri::command]
fn push_file(local_path: &str, remote_dest: &str) -> Result<String, String> {
    // Expand the ~ if pulling from a Mac home directory
    let actual_local = if local_path.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| String::from("/"));
        local_path.replacen("~", &home, 1)
    } else {
        local_path.to_string()
    };

    let output = Command::new("adb")
        .args(["push", &actual_local, remote_dest])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("Transfer complete".into())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

// 5. Transfer: Batch Pull Multiple Files (Phone to Mac)
#[tauri::command]
async fn pull_multiple(
    window: Window,
    state: State<'_, TransferState>,
    remote_paths: Vec<String>,
    local_dest: String,
) -> Result<String, String> {
    state.cancel_flag.store(false, Ordering::Relaxed); // Reset flag on start

    let actual_local = if local_dest.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| String::from("/"));
        local_dest.replacen("~", &home, 1)
    } else {
        local_dest.clone()
    };

    let total = remote_paths.len();
    let mut completed = 0;

    for (i, path) in remote_paths.iter().enumerate() {
        // KILL-SWITCH CHECK: Stop if user clicked cancel
        if state.cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let file_name = path.split('/').last().unwrap_or("file").to_string();
        let _ = window.emit(
            "transfer-progress",
            ProgressPayload {
                current: i,
                total,
                file_name,
            },
        );

        let output = Command::new("adb")
            .args(["pull", path, &actual_local])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        completed += 1;
    }

    Ok(format!("Successfully pulled {} items", completed))
}

// 6. Transfer: Batch Push Multiple Files (Mac to Phone)
#[tauri::command]
async fn push_multiple(
    window: Window,
    state: State<'_, TransferState>,
    local_paths: Vec<String>,
    remote_dest: String,
) -> Result<String, String> {
    state.cancel_flag.store(false, Ordering::Relaxed); // Reset flag on start

    let home = std::env::var("HOME").unwrap_or_else(|_| String::from("/"));
    let total = local_paths.len();
    let mut completed = 0;

    for (i, path) in local_paths.iter().enumerate() {
        // KILL-SWITCH CHECK: Stop if user clicked cancel
        if state.cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let actual_local = if path.starts_with("~/") {
            path.replacen("~", &home, 1)
        } else {
            path.clone()
        };

        let file_name = actual_local.split('/').last().unwrap_or("file").to_string();

        // Tell React which file we are currently pushing
        let _ = window.emit(
            "transfer-progress",
            ProgressPayload {
                current: i,
                total,
                file_name: file_name.clone(),
            },
        );

        // 1. Push the actual file
        let output = Command::new("adb")
            .args(["push", &actual_local, &remote_dest])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }

        // 2. Force-Inject into the specific Android MediaStore Tables (Images/Video)
        let remote_file_path = format!("{}/{}", remote_dest, file_name).replace("//", "/");

        // Grab the file extension to tell Android exactly what kind of media this is
        let ext = file_name.split('.').last().unwrap_or("").to_lowercase();
        let content_uri = match ext.as_str() {
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" | "heif" | "dng" => {
                "content://media/external/images/media"
            }
            "mp4" | "mov" | "mkv" | "avi" | "webm" => "content://media/external/video/media",
            _ => "content://media/external/file", // Fallback for other files
        };

        let _ = Command::new("adb")
            .args([
                "shell",
                "content",
                "insert",
                "--uri",
                content_uri,
                "--bind",
                &format!("_data:s:{}", remote_file_path),
            ])
            .output();

        completed += 1;
    }

    Ok(format!("Successfully pushed {} items", completed))
}

fn fix_path_env() {
    if let Ok(path) = std::env::var("PATH") {
        let mut paths = vec![path];
        paths.push("/opt/homebrew/bin".to_string());
        paths.push("/usr/local/bin".to_string());
        if let Ok(home) = std::env::var("HOME") {
            paths.push(format!("{}/Library/Android/sdk/platform-tools", home));
        }
        std::env::set_var("PATH", paths.join(":"));
    }
}

fn main() {
    fix_path_env();

    tauri::Builder::default()
        .manage(TransferState {
            cancel_flag: Arc::new(AtomicBool::new(false)),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_local_files,
            list_remote_files,
            pull_file,
            push_file,
            pull_multiple,
            push_multiple,
            cancel_transfer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
