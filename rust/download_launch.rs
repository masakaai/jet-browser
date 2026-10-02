use std::fs::{self, DirBuilder, OpenOptions};
use std::io::ErrorKind;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

pub fn reserve(token: &str, spool: &Path, reservations: &Path) -> Result<(), String> {
    let bytes = token.as_bytes();
    if bytes.len() != 36
        || !bytes.iter().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                *b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(b)
            }
        })
        || bytes[14] != b'4'
        || !b"89ab".contains(&bytes[19])
    {
        return Err("Invalid download token".into());
    }
    if fs::canonicalize(spool).map_err(|_| "Download spool unavailable")? != spool
        || !spool.is_dir()
    {
        return Err("Invalid download spool".into());
    }
    match fs::symlink_metadata(spool.join(token)) {
        Ok(_) => return Err("Download token already has a directory".into()),
        Err(error) if error.kind() == ErrorKind::NotFound => (),
        Err(_) => return Err("Download directory cannot be inspected".into()),
    }
    match DirBuilder::new().mode(0o700).create(reservations) {
        Ok(_) => (),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => (),
        Err(_) => return Err("Download reservations unavailable".into()),
    }
    let metadata =
        fs::symlink_metadata(reservations).map_err(|_| "Download reservations unavailable")?;
    if !metadata.is_dir()
        || metadata.permissions().mode() & 0o077 != 0
        || fs::canonicalize(reservations).map_err(|_| "Download reservations unavailable")?
            != reservations
    {
        return Err("Invalid download reservations directory".into());
    }
    // An atomic create fences duplicate launches even before the browser has
    // created its download directory. Keep the marker after unknown outcomes.
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(reservations.join(token))
        .map_err(|_| "Download token already reserved or reservation failed")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_tokens_fail_before_any_filesystem_access() {
        for token in [
            "",
            "../escape",
            "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa",
        ] {
            assert_eq!(
                reserve(token, Path::new("/absent"), Path::new("/absent")),
                Err("Invalid download token".into())
            );
        }
    }
    #[test]
    fn atomic_reservation_blocks_reuse_and_existing_payload_paths() {
        let temp = std::env::temp_dir().join(format!(
            "masaka-launch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&temp).unwrap();
        let root = fs::canonicalize(&temp).unwrap();
        let spool = root.join("spool");
        fs::create_dir(&spool).unwrap();
        let reservations = root.join("bindings");
        let token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        reserve(token, &spool, &reservations).unwrap();
        assert!(reserve(token, &spool, &reservations)
            .unwrap_err()
            .contains("reserved"));
        let second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        std::os::unix::fs::symlink(root.join("absent"), spool.join(second)).unwrap();
        assert!(reserve(second, &spool, &reservations)
            .unwrap_err()
            .contains("directory"));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = (0..2)
            .map(|_| {
                let barrier = barrier.clone();
                let spool = spool.clone();
                let reservations = reservations.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    reserve(
                        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                        &spool,
                        &reservations,
                    )
                })
            })
            .collect();
        let successes = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(|result| result.is_ok())
            .count();
        assert_eq!(successes, 1);
        fs::remove_dir_all(&root).unwrap();
    }
}
