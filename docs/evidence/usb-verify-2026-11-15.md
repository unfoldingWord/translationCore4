# The export's read from the device (issue 867), probed

Which call makes a read of a file just written come from the device and not from the operating
system's cache. This is probe 8 of `docs/STORAGE.md` §16.5, for §10.1 E5 and §15 row L85. Run on
macOS and on Linux. **Not run on Windows.**

- **Date:** 2026-11-15.
- **Program:** `crates/tc-sync/examples/usbprobe.rs`, in the commit that adds this file. The
  scripts that ran it and their whole output are in `docs/evidence/usb-verify-2026-11-15/`.
- **macOS:** macOS 26.5.1 (25F80), Apple silicon, `probe-macos.sh`, output `macos.txt`.
- **Linux:** kernel 7.0.12 (the Linux VM of Docker Desktop on the same Mac, arm64), in a
  privileged `rust:1-bookworm` container, `probe-linux.sh`, output `linux.txt`.
- **The stick:** a disk image (macOS) or a file behind a loop device (Linux), 64 MB, formatted
  as a stick is: ExFAT and FAT32, and ext4 on Linux. **No physical USB stick was used.**

## Method

The probe writes a zip into the mounted volume as the export does: 300 stored entries through
`zip::ZipWriter`, which writes small pieces of odd sizes and seeks back over each header. Every
entry holds 128 copies of a 32-byte token made for that file, 38,400 copies in all. The file is
flushed (`sync_all`). Then the probe finds every copy of the token in the file that backs the
volume and flips its bits there, behind the mounted file system: the "device" now holds other
bytes than were written. Then it reads the file back one way and counts the copies that still
read as written. A copy that reads as written came from the cache.

Controls, in every run:

- The count of copies found and changed in the backing file is printed. All 38,400 were found
  each time, so the bytes had reached the device as written, and the change did land. (On ext4
  one more copy is found: the token is also in the file's name.) Where fewer are found the probe
  prints `NO RESULT` and concludes nothing. An early version did not wait for the disk image's
  driver to hand the bytes to the image, found none in one run, and printed "read from the
  cache" for every row; the probe now waits and refuses.
- The probe does not read the file before the change. An early version did, and that read
  filled the cache, which made the macOS writer's `F_NOCACHE` look useless.
- After the run the volume is unmounted and mounted again, and every file is read plainly. All
  read 0 of 38,400 copies as written: the change was in the files' own bytes.
- On macOS, in a first probe (a Python script, not kept), the raw device (`/dev/rdiskN`) was
  read at the file's offset and showed the changed bytes while a plain read of the file showed
  the bytes written.

## Results

"Stale" is the count of the 38,400 copies that read as written after the device was changed.

| Platform, file system | Written | Read back | Stale | From |
|---|---|---|---|---|
| macOS, ExFAT and FAT32 | plainly | plainly (what `verify` did until this change) | 38,400 | the cache |
| macOS, ExFAT and FAT32 | plainly | `F_NOCACHE` on the reading handle | 38,400 | the cache |
| macOS, ExFAT and FAT32 | `F_NOCACHE` on the writing handle | plainly | 0 | the device |
| macOS, ExFAT and FAT32 | `F_NOCACHE` on the writing handle | `F_NOCACHE` on the reading handle | 0 | the device |
| macOS, ExFAT and FAT32 | **the export's writer** | **the export's read-back** | 0 | the device |
| Linux, vfat, exfat and ext4 | plainly | plainly (what `verify` did until this change) | 38,400 | the cache |
| Linux, vfat, exfat and ext4 | plainly | `posix_fadvise(DONTNEED)`, then plainly | 0 | the device |
| Linux, vfat, exfat and ext4 | plainly | `O_DIRECT` | 0 | the device |
| Linux, vfat, exfat and ext4 | **the export's writer** | **the export's read-back** | 0 | the device |

The macOS script, as committed, was run seven times: 14 volumes. The export's rows read from
the device on all 14. The plain row read from the cache on 12 and from the device on 2; in a
run of an earlier version of the probe it read partly from the cache (1,746 copies stale). What
the cache still holds is the system's choice, so a plain read proves nothing either way. The
Linux script was run once as committed, and once in an earlier version with the same rows and
the same results.

## What follows

1. **Issue 867 is real.** A plain read of a file just written returns the bytes written while
   the device holds others, on macOS and on Linux.
2. **macOS.** `F_NOCACHE` on the reading handle does not help: pages already in the cache are
   served. STORAGE §10.1 E5 named that call; it is corrected. `F_NOCACHE` on the writing
   handle keeps the bytes out of the cache, with the zip writer's small writes and seeks too,
   and then a read comes from the device. The export sets it on both handles
   (`rustix::fs::fcntl_nocache`).
3. **Linux.** Both calls read from the device here. The export uses `O_DIRECT`: the read
   itself goes around the cache, and a file system that cannot do it refuses the open, which
   the export sees. `posix_fadvise(DONTNEED)` is advice the kernel may ignore, and it reports
   nothing.
4. **Windows: not probed.** The export opens the file with `FILE_FLAG_NO_BUFFERING` and reads
   into an aligned buffer, which Microsoft documents as a read with no system cache. That code
   is type-checked for `x86_64-pc-windows-msvc` and has never run. A probe there needs a stick
   whose bytes can be changed from outside Windows, for example a second raw disk of the
   Windows VM (`scripts/tools/winvm`) backed by a file on its Linux host. `usbprobe` changes
   the backing file itself, which a guest cannot reach, so it would first need a mode that
   writes, waits for the host to change the file, and then reads. That mode is not written.

## Limits

- A disk image and a loop device, not a USB stick, its controller or its own write cache. The
  probe shows the operating system's cache is passed. It does not show what a stick that lies
  about a flush does.
- Linux ran in Docker Desktop's VM on arm64, with the backing file on a folder shared from the
  Mac. It is one kernel (7.0.12). A file system served by a FUSE program (some exFAT and NTFS
  drivers on older systems) was not probed: `O_DIRECT` there passes the kernel's cache of the
  file, not the block device's cache the program reads through.
- macOS: another program that reads the file between the write and the read-back (an indexer,
  a virus scanner) would put its pages in the cache, and the read-back would then be served
  from them. Not seen on the 14 volumes; not excluded.
- The read-back holds the whole file in memory beside the entries read from it.
