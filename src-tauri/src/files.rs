use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::ipc::{InvokeBody, Request, Response};

/// Reads a PDF and returns the raw bytes over binary IPC (an ArrayBuffer on the JS side).
#[tauri::command]
pub async fn read_pdf(path: String) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// The PDF passed on the command line (e.g. opened through the .pdf file association).
#[tauri::command]
pub fn launch_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) && p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Size and modification time, to notice when another program changed the file under us.
#[derive(Serialize, Deserialize, PartialEq, Eq, Clone, Copy, Debug)]
pub struct FileStamp {
    size: u64,
    modified: u64,
}

fn stamp_of(path: &Path) -> std::io::Result<FileStamp> {
    let meta = fs::metadata(path)?;
    let modified = meta
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStamp {
        size: meta.len(),
        modified,
    })
}

#[tauri::command]
pub fn file_stamp(path: String) -> Result<FileStamp, String> {
    stamp_of(Path::new(&path)).map_err(|e| e.to_string())
}

#[derive(Serialize, Debug)]
pub struct WriteError {
    /// "locked" | "conflict" | "readonly" | "io"
    kind: &'static str,
    message: String,
}

impl WriteError {
    fn new(kind: &'static str, message: impl ToString) -> Self {
        Self {
            kind,
            message: message.to_string(),
        }
    }
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Writes the whole PDF to a temp file next to the target, then renames it over the target.
/// Body: the PDF bytes. Headers: `x-path` (percent-encoded), optional `x-stamp` (JSON FileStamp
/// recorded when the file was opened or last saved; a mismatch means someone else changed it).
#[tauri::command]
pub async fn write_pdf(request: Request<'_>) -> Result<FileStamp, WriteError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(WriteError::new("io", "expected raw bytes"));
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let path = header("x-path")
        .and_then(percent_decode)
        .ok_or_else(|| WriteError::new("io", "missing x-path"))?;
    let expected: Option<FileStamp> = header("x-stamp").and_then(|s| serde_json::from_str(s).ok());
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || write_atomic(Path::new(&path), &bytes, expected))
        .await
        .map_err(|e| WriteError::new("io", e))?
}

fn write_atomic(
    path: &Path,
    bytes: &[u8],
    expected: Option<FileStamp>,
) -> Result<FileStamp, WriteError> {
    if let Some(expected) = expected {
        match stamp_of(path) {
            Ok(now) if now == expected => {}
            Ok(_) => {
                return Err(WriteError::new(
                    "conflict",
                    "file changed on disk since it was opened",
                ))
            }
            Err(e) => return Err(WriteError::new("conflict", e)),
        }
    }
    if fs::metadata(path).is_ok_and(|m| m.permissions().readonly()) {
        return Err(WriteError::new("readonly", "file is read-only"));
    }
    let dir = path.parent().unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = dir.join(format!(".{name}.typenote-{}.tmp", std::process::id()));
    let written = File::create(&tmp).and_then(|mut f| {
        f.write_all(bytes)?;
        f.sync_all()
    });
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(WriteError::new("io", e));
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        // ERROR_ACCESS_DENIED / ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION: another
        // program (e.g. Acrobat) has the file open without allowing it to be replaced
        let kind = match e.raw_os_error() {
            Some(5 | 32 | 33) => "locked",
            _ => "io",
        };
        return Err(WriteError::new(kind, e));
    }
    stamp_of(path).map_err(|e| WriteError::new("io", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("typenote-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decodes_percent_encoded_paths() {
        assert_eq!(
            percent_decode("C%3A%5C%ED%95%9C%EA%B8%80.pdf").as_deref(),
            Some("C:\\한글.pdf")
        );
        assert_eq!(percent_decode("bad%2"), None);
    }

    #[test]
    fn writes_and_detects_conflicts() {
        let dir = temp_dir("write");
        let file = dir.join("a.pdf");
        fs::write(&file, b"old").unwrap();
        let stamp = stamp_of(&file).unwrap();
        let s2 = write_atomic(&file, b"new contents", Some(stamp)).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"new contents");
        assert_eq!(s2.size, 12);
        // stale stamp: someone else wrote in between
        let err = write_atomic(&file, b"x", Some(stamp)).unwrap_err();
        assert_eq!(err.kind, "conflict");
        assert_eq!(fs::read(&file).unwrap(), b"new contents");
        // no temp files left behind
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn reports_files_locked_by_another_program() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = temp_dir("locked");
        let file = dir.join("b.pdf");
        fs::write(&file, b"old").unwrap();
        // share mode 0: like a viewer that keeps the file open exclusively
        let _held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&file)
            .unwrap();
        let err = write_atomic(&file, b"new", None).unwrap_err();
        assert_eq!(err.kind, "locked");
        drop(_held);
        assert_eq!(fs::read(&file).unwrap(), b"old");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn refuses_read_only_files() {
        let dir = temp_dir("readonly");
        let file = dir.join("c.pdf");
        fs::write(&file, b"old").unwrap();
        let mut perms = fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&file, perms.clone()).unwrap();
        assert_eq!(
            write_atomic(&file, b"new", None).unwrap_err().kind,
            "readonly"
        );
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        fs::set_permissions(&file, perms).unwrap();
    }
}
