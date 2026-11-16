//! The export-verify probe (`docs/STORAGE.md` §16.5 item 8): which call makes a read of a
//! file just written come from the device, not from the operating system's cache.
//!
//! `usbprobe DIR IMAGE` writes a zip into DIR as the export does (many entries, the writer
//! seeking back over each header), flushes it, changes the file's bytes in IMAGE (the file
//! that backs the volume DIR is on: a disk image, a loop device's file) behind the mounted
//! file system, and reads the file back each way. A read that still shows the bytes written
//! came from the cache. `usbprobe DIR` (no IMAGE) lists what an earlier run left, for the
//! control after the volume is mounted again: every file must then show the changed bytes.
//! How it was run, and what it showed: `docs/evidence/usb-verify-2026-11-15.md`.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use tc_sync::stick::{OsStick, ReadFrom, Stick, Written};

const TOKEN_LEN: usize = 32;
const ENTRIES: usize = 300;
const COPIES_PER_ENTRY: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq)]
enum WriteWay {
    /// The export's own writer ([`OsStick`]).
    Export,
    Plain,
    /// macOS: `F_NOCACHE` on the writing handle.
    #[cfg(target_vendor = "apple")]
    NoCache,
}

#[derive(Clone, Copy, Debug)]
enum ReadWay {
    /// The export's own read-back ([`OsStick`]), and where it says the bytes came from.
    Export,
    Plain,
    /// macOS: `F_NOCACHE` on the reading handle.
    #[cfg(target_vendor = "apple")]
    NoCache,
    /// Linux: `posix_fadvise(DONTNEED)` over the whole file, then a plain read.
    #[cfg(target_os = "linux")]
    DontNeed,
    /// Linux `O_DIRECT`, Windows `FILE_FLAG_NO_BUFFERING`: aligned reads.
    #[cfg(any(target_os = "linux", windows))]
    Direct,
}

fn ways() -> Vec<(WriteWay, ReadWay)> {
    let mut ways = vec![
        (WriteWay::Plain, ReadWay::Plain),
        (WriteWay::Export, ReadWay::Export),
    ];
    #[cfg(target_vendor = "apple")]
    ways.extend([
        (WriteWay::Plain, ReadWay::NoCache),
        (WriteWay::NoCache, ReadWay::Plain),
        (WriteWay::NoCache, ReadWay::NoCache),
    ]);
    #[cfg(target_os = "linux")]
    ways.extend([
        (WriteWay::Plain, ReadWay::DontNeed),
        (WriteWay::Plain, ReadWay::Direct),
    ]);
    #[cfg(windows)]
    ways.push((WriteWay::Plain, ReadWay::Direct));
    ways
}

fn token(n: usize) -> Vec<u8> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let mut t = format!("TCPROBE{n:02}-{nanos:032x}").into_bytes();
    t.truncate(TOKEN_LEN);
    t
}

fn count(haystack: &[u8], needle: &[u8]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i + needle.len() <= haystack.len() {
        if &haystack[i..i + needle.len()] == needle {
            n += 1;
            i += needle.len();
        } else {
            i += 1;
        }
    }
    n
}

fn fill<W: Write + Seek>(file: W, token: &[u8]) -> std::io::Result<W> {
    let mut zip = zip::ZipWriter::new(file);
    // Stored, so the token is on the volume as written and can be found in the image.
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for i in 0..ENTRIES {
        zip.start_file(format!("ingredients/e{i:04}.txt"), options)
            .map_err(std::io::Error::other)?;
        // Odd sizes, as an export's entries have: no write lands on a block boundary.
        zip.write_all(&token.repeat(COPIES_PER_ENTRY))?;
        zip.write_all(&vec![b'.'; 1 + i % 61])?;
    }
    zip.finish().map_err(std::io::Error::other)
}

fn write_zip(path: &Path, token: &[u8], way: WriteWay) -> std::io::Result<Written> {
    match way {
        WriteWay::Export => fill(OsStick.create(path)?, token)?.sync_all(),
        WriteWay::Plain => {
            fill(std::fs::File::create(path)?, token)?.sync_all()?;
            Ok(Written::ThroughCache)
        }
        #[cfg(target_vendor = "apple")]
        WriteWay::NoCache => {
            let file = std::fs::File::create(path)?;
            rustix::fs::fcntl_nocache(&file, true)?;
            fill(file, token)?.sync_all()?;
            Ok(Written::OutOfCache)
        }
    }
}

/// Flips every copy of `token` in the image; the count of copies changed.
fn change_on_device(image: &Path, token: &[u8]) -> std::io::Result<usize> {
    let bytes = std::fs::read(image)?;
    let mut file = std::fs::OpenOptions::new().write(true).open(image)?;
    let flipped: Vec<u8> = token.iter().map(|b| b ^ 0x5A).collect();
    let (mut n, mut i) = (0, 0);
    while i + token.len() <= bytes.len() {
        if &bytes[i..i + token.len()] == token {
            file.seek(SeekFrom::Start(i as u64))?;
            file.write_all(&flipped)?;
            n += 1;
            i += token.len();
        } else {
            i += 1;
        }
    }
    file.sync_all()?;
    Ok(n)
}

#[cfg(any(target_os = "linux", windows))]
fn read_direct(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "linux")]
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
    let mut file = options.open(path)?;
    const ALIGN: usize = 4096;
    let mut owned = vec![0u8; (1 << 20) + ALIGN];
    let start = owned.as_ptr().align_offset(ALIGN);
    let buf = &mut owned[start..start + (1 << 20)];
    let mut out = Vec::new();
    loop {
        let n = file.read(buf)?;
        if n == 0 {
            return Ok(out);
        }
        out.extend_from_slice(&buf[..n]);
    }
}

fn read_back(path: &Path, way: ReadWay, written: Written) -> std::io::Result<Vec<u8>> {
    match way {
        ReadWay::Export => {
            let (bytes, from) = OsStick.read_from_device(path, written)?;
            print!(
                "(the export says: read from the {}) ",
                match from {
                    ReadFrom::Device => "device",
                    ReadFrom::Cache => "cache",
                }
            );
            Ok(bytes)
        }
        ReadWay::Plain => std::fs::read(path),
        #[cfg(target_vendor = "apple")]
        ReadWay::NoCache => {
            let mut file = std::fs::File::open(path)?;
            rustix::fs::fcntl_nocache(&file, true)?;
            let mut out = Vec::new();
            file.read_to_end(&mut out)?;
            Ok(out)
        }
        #[cfg(target_os = "linux")]
        ReadWay::DontNeed => {
            let file = std::fs::File::open(path)?;
            rustix::fs::fadvise(&file, 0, None, rustix::fs::Advice::DontNeed)?;
            drop(file);
            std::fs::read(path)
        }
        #[cfg(any(target_os = "linux", windows))]
        ReadWay::Direct => read_direct(path),
    }
}

fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = Path::new(args.first().map_or(".", String::as_str));
    let total = ENTRIES * COPIES_PER_ENTRY;
    let Some(image) = args.get(1).map(Path::new) else {
        // The control after a re-mount: the device's bytes, with no cache left to hide them.
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Some(token) = name
                .strip_prefix("probe-")
                .and_then(|n| n.strip_suffix(".zip"))
            else {
                continue;
            };
            let written = count(&std::fs::read(&path)?, token.as_bytes());
            println!("after re-mount  {name}: {written} of {total} copies as written");
        }
        return Ok(());
    };
    println!("{} {}", std::env::consts::OS, std::env::consts::ARCH);
    for (n, (write, read)) in ways().into_iter().enumerate() {
        let token = token(n);
        let path = dir.join(format!("probe-{}.zip", String::from_utf8_lossy(&token)));
        let started = std::time::Instant::now();
        let written = write_zip(&path, &token, write)?;
        let write_ms = started.elapsed().as_millis();
        // No read before the change: a read would itself fill the cache. That the bytes
        // reached the device as written is shown by the count changed there.
        // The layer under the volume (a disk image's driver, a loop device) may hand the
        // bytes to the image a moment after the flush returns.
        let mut waited = 0;
        while count(&std::fs::read(image)?, &token) < total && waited < 100 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            waited += 1;
        }
        let changed = change_on_device(image, &token)?;
        if changed < total {
            println!(
                "write {write:?}, read {read:?}: NO RESULT: only {changed} of {total} copies \
                 were found in the image, so the device was not changed"
            );
            continue;
        }
        print!("write {write:?} ({write_ms} ms), read {read:?}: ");
        let after = match read_back(&path, read, written) {
            Ok(bytes) => {
                let stale = count(&bytes, &token);
                format!(
                    "{stale} of {total} copies stale: {}",
                    match stale {
                        0 => "READ FROM THE DEVICE",
                        s if s == total => "read from the cache",
                        _ => "partly from the cache",
                    }
                )
            }
            Err(e) => format!("the read failed: {e}"),
        };
        println!("{changed} of {total} copies found and changed on the device; {after}");
    }
    Ok(())
}
