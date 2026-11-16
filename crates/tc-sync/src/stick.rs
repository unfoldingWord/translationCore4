//! The export's file on the stick (`docs/STORAGE.md` §10.1 E5): written so its bytes can be
//! read back from the device, and read back so. A read through the operating system's cache
//! shows what was written, never what the stick holds, so a failing stick would pass.
//!
//! What each platform needs was measured (`docs/evidence/usb-verify-2026-11-15.md`):
//! macOS keeps cached pages whatever the reading handle asks, so the writing handle keeps the
//! bytes out of the cache (`F_NOCACHE`); Linux reads with `O_DIRECT`; Windows reads with
//! `FILE_FLAG_NO_BUFFERING`. Where the call is refused the read comes through the cache and
//! says so ([`ReadFrom::Cache`]).

use std::io::{Read, Seek, Write};
use std::path::Path;

pub use tc_api::exchange::ReadFrom;

/// Whether the bytes of a written file stayed out of the operating system's cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Written {
    OutOfCache,
    ThroughCache,
}

/// The file being written.
pub trait StickFile: Write + Seek + Send {
    /// Flushes the file to the device.
    fn sync_all(self: Box<Self>) -> std::io::Result<Written>;
}

/// The file system an export writes to and verifies from. [`OsStick`] is the real one; a test
/// puts a stick that holds other bytes than the cache in its place.
pub trait Stick: Send + Sync {
    fn create(&self, path: &Path) -> std::io::Result<Box<dyn StickFile>>;
    /// The whole file, from the device where the platform allows it. `written` is what
    /// [`StickFile::sync_all`] said of this file.
    fn read_from_device(
        &self,
        path: &Path,
        written: Written,
    ) -> std::io::Result<(Vec<u8>, ReadFrom)>;
}

/// The operating system's files.
#[derive(Debug, Clone, Copy, Default)]
pub struct OsStick;

/// Buffered: a write kept out of the cache goes to the device as it is made, and the zip
/// writer makes many small ones.
struct OsFile(std::io::BufWriter<std::fs::File>, Written);

impl Write for OsFile {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

impl Seek for OsFile {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.0.seek(pos)
    }
}

impl StickFile for OsFile {
    fn sync_all(self: Box<Self>) -> std::io::Result<Written> {
        let file = self
            .0
            .into_inner()
            .map_err(std::io::IntoInnerError::into_error)?;
        file.sync_all()?;
        Ok(self.1)
    }
}

impl Stick for OsStick {
    fn create(&self, path: &Path) -> std::io::Result<Box<dyn StickFile>> {
        let file = std::fs::File::create(path)?;
        let written = keep_out_of_cache(&file);
        let file = std::io::BufWriter::with_capacity(1 << 20, file);
        Ok(Box::new(OsFile(file, written)))
    }

    fn read_from_device(
        &self,
        path: &Path,
        written: Written,
    ) -> std::io::Result<(Vec<u8>, ReadFrom)> {
        match read_uncached(path, written)? {
            Some(bytes) => Ok((bytes, ReadFrom::Device)),
            None => Ok((std::fs::read(path)?, ReadFrom::Cache)),
        }
    }
}

#[cfg(target_vendor = "apple")]
fn keep_out_of_cache(file: &std::fs::File) -> Written {
    match rustix::fs::fcntl_nocache(file, true) {
        Ok(()) => Written::OutOfCache,
        Err(_) => Written::ThroughCache,
    }
}

#[cfg(not(target_vendor = "apple"))]
fn keep_out_of_cache(_file: &std::fs::File) -> Written {
    Written::ThroughCache
}

/// The file's bytes read around the cache; `None` where this platform or this file system
/// refuses the call, or the writer left the bytes in a cache this platform cannot read past.
/// A read the device fails is an error, never a reason to read the cache instead.
#[cfg(target_vendor = "apple")]
fn read_uncached(path: &Path, written: Written) -> std::io::Result<Option<Vec<u8>>> {
    if written != Written::OutOfCache {
        return Ok(None);
    }
    let mut file = std::fs::File::open(path)?;
    if rustix::fs::fcntl_nocache(&file, true).is_err() {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(Some(bytes))
}

#[cfg(any(target_os = "linux", target_os = "android", windows))]
fn read_uncached(path: &Path, _written: Written) -> std::io::Result<Option<Vec<u8>>> {
    /// A multiple of every sector size in use (512 and 4096 bytes).
    const ALIGN: usize = 4096;
    const CHUNK: usize = 1 << 20;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(rustix::fs::OFlags::DIRECT.bits() as i32);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_NO_BUFFERING: u32 = 0x2000_0000;
        options.custom_flags(FILE_FLAG_NO_BUFFERING);
    }
    // A file system without unbuffered reads refuses the open (tmpfs, some network folders).
    let Ok(mut file) = options.open(path) else {
        return Ok(None);
    };
    // An unbuffered read takes a buffer at a sector boundary: the aligned part of an owned one.
    let mut owned = vec![0u8; CHUNK + ALIGN];
    let start = owned.as_ptr().align_offset(ALIGN);
    let Some(buf) = owned.get_mut(start..start + CHUNK) else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    loop {
        match file.read(buf) {
            Ok(0) => return Ok(Some(bytes)),
            Ok(n) => bytes.extend_from_slice(&buf[..n]),
            // Some file systems take the open and refuse the first unbuffered read.
            Err(e) if bytes.is_empty() && e.kind() == std::io::ErrorKind::InvalidInput => {
                return Ok(None);
            }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(not(any(
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    windows
)))]
fn read_uncached(_path: &Path, _written: Written) -> std::io::Result<Option<Vec<u8>>> {
    Ok(None)
}
