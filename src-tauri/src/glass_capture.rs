//! One in-memory snapshot of this application's main WebView, taken before a
//! floating surface opens. This never captures the desktop or another window.
//! Native capture is asynchronous; encoding and waiting run off the UI thread.

use base64::Engine as _;
use serde::Serialize;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
    },
    time::Duration,
};

const MAX_PIXELS: u64 = 8 * 1024 * 1024;
const MAX_PNG_BYTES: usize = 12 * 1024 * 1024;
static CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
pub struct GlassBackdrop {
    data_url: String,
    width: u32,
    height: u32,
    #[cfg(debug_assertions)]
    capture_ms: u128,
    #[cfg(debug_assertions)]
    encode_ms: u128,
}

enum CapturedImage {
    #[cfg(windows)]
    Png(Vec<u8>),
    #[cfg(target_os = "macos")]
    Bitmap(Bitmap),
}

/// Keep the single-flight guard until the native callback is released, even if
/// the caller times out. A hung OS capture must not accumulate more captures.
struct CaptureGuard;
impl Drop for CaptureGuard {
    fn drop(&mut self) {
        CAPTURE_ACTIVE.store(false, Ordering::Release);
    }
}

fn checked_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err("Glass snapshot dimensions unavailable".into());
    }
    Ok(())
}

fn png_backdrop(bytes: Vec<u8>) -> Result<GlassBackdrop, String> {
    if bytes.len() < 24
        || bytes.len() > MAX_PNG_BYTES
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &bytes[12..16] != b"IHDR"
    {
        return Err("Glass snapshot format unavailable".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    checked_dimensions(width, height)?;
    Ok(GlassBackdrop {
        data_url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
        width,
        height,
        #[cfg(debug_assertions)]
        capture_ms: 0,
        #[cfg(debug_assertions)]
        encode_ms: 0,
    })
}

#[tauri::command]
pub async fn capture_glass_backdrop(window: tauri::WebviewWindow) -> Result<GlassBackdrop, String> {
    #[cfg(debug_assertions)]
    let started = std::time::Instant::now();
    if window.label() != "main" {
        return Err("Glass snapshots are limited to the main window".into());
    }
    let size = window
        .inner_size()
        .map_err(|_| "Glass snapshot window unavailable")?;
    checked_dimensions(size.width, size.height)?;
    if CAPTURE_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Glass snapshot already in progress".into());
    }
    let guard = Arc::new(CaptureGuard);
    let worker_guard = guard.clone();
    let (tx, rx) = mpsc::channel::<Result<CapturedImage, String>>();
    let error_tx = tx.clone();
    let scale = window.scale_factor().unwrap_or(1.0).max(1.0);
    window
        .with_webview(move |webview| {
            if let Err(error) = start_capture(webview, tx, guard, size.width, scale) {
                let _ = error_tx.send(Err(error));
            }
        })
        .map_err(|_| "Glass snapshot webview unavailable")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _worker_guard = worker_guard;
        let frame = rx
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "Glass snapshot timed out".to_string())??;
        #[cfg(debug_assertions)]
        let captured = std::time::Instant::now();
        let png = match frame {
            #[cfg(windows)]
            CapturedImage::Png(bytes) => bytes,
            #[cfg(target_os = "macos")]
            CapturedImage::Bitmap(bitmap) => bitmap.encode()?,
        };
        let result = png_backdrop(png);
        #[cfg(debug_assertions)]
        let result = result.map(|mut backdrop| {
            backdrop.capture_ms = captured.duration_since(started).as_millis();
            backdrop.encode_ms = captured.elapsed().as_millis();
            backdrop
        });
        result
    })
    .await
    .map_err(|_| "Glass snapshot worker unavailable".to_string())?
}

#[cfg(target_os = "macos")]
struct Bitmap {
    width: u32,
    height: u32,
    stride: usize,
    channels: usize,
    alpha_first: bool,
    premultiplied: bool,
    reverse_bytes: bool,
    bytes: Vec<u8>,
}

#[cfg(target_os = "macos")]
impl Bitmap {
    fn encode(self) -> Result<Vec<u8>, String> {
        let row_bytes = self.width as usize * self.channels;
        let mut rgba = if self.channels == 4 && self.stride == row_bytes {
            self.bytes
        } else {
            let mut packed = Vec::with_capacity(self.width as usize * self.height as usize * 4);
            for row in self
                .bytes
                .chunks_exact(self.stride)
                .take(self.height as usize)
            {
                if self.channels == 4 {
                    packed.extend_from_slice(&row[..row_bytes]);
                } else {
                    for rgb in row[..row_bytes].as_chunks::<3>().0 {
                        packed.extend_from_slice(rgb);
                        packed.push(255);
                    }
                }
            }
            packed
        };
        // WKWebView's common BGRA layout only needs an in-place R/B swap.
        // Avoid a second image allocation and per-channel pushes on the hot path.
        if self.channels == 4 {
            for pixel in rgba.as_chunks_mut::<4>().0 {
                match (self.reverse_bytes, self.alpha_first) {
                    (true, true) => pixel.swap(0, 2),
                    (true, false) => pixel.reverse(),
                    (false, true) => pixel.rotate_left(1),
                    (false, false) => {}
                }
                if self.premultiplied && pixel[3] != 255 {
                    let alpha = u32::from(pixel[3]);
                    for component in &mut pixel[..3] {
                        *component = (u32::from(*component) * 255)
                            .checked_div(alpha)
                            .unwrap_or(0)
                            .min(255) as u8;
                    }
                }
            }
        }
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, self.width, self.height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_compression(png::Compression::Fastest);
            let mut writer = encoder
                .write_header()
                .map_err(|_| "Glass snapshot encoding failed")?;
            writer
                .write_image_data(&rgba)
                .map_err(|_| "Glass snapshot encoding failed")?;
        }
        Ok(bytes)
    }
}

#[cfg(target_os = "macos")]
fn start_capture(
    webview: tauri::webview::PlatformWebview,
    tx: Sender<Result<CapturedImage, String>>,
    guard: Arc<CaptureGuard>,
    physical_width: u32,
    scale: f64,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSBitmapFormat, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSError, NSNumber};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    let marker = MainThreadMarker::new().ok_or("Glass snapshot requires the main thread")?;
    // SAFETY: Tauri's with_webview supplies this WKWebView on its main thread.
    let view: &WKWebView = unsafe { &*webview.inner().cast() };
    let configuration = unsafe { WKSnapshotConfiguration::new(marker) };
    unsafe {
        configuration.setSnapshotWidth(Some(&NSNumber::numberWithDouble(
            f64::from(physical_width.min(1024)) / scale,
        )));
        configuration.setAfterScreenUpdates(true);
    }
    let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        let _retain_guard = &guard;
        let result = (|| {
            if !error.is_null() {
                return Err("Glass snapshot capture failed".into());
            }
            // Callback pointers are borrowed and valid for this invocation only.
            let image = unsafe { image.as_ref() }.ok_or("Glass snapshot image unavailable")?;
            let cg_image = unsafe {
                image.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None)
            }
            .ok_or("Glass snapshot pixels unavailable")?;
            let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg_image);
            let width = u32::try_from(bitmap.pixelsWide())
                .map_err(|_| "Glass snapshot width unavailable")?;
            let height = u32::try_from(bitmap.pixelsHigh())
                .map_err(|_| "Glass snapshot height unavailable")?;
            checked_dimensions(width, height)?;
            let channels = usize::try_from(bitmap.samplesPerPixel()).unwrap_or(0);
            let stride = usize::try_from(bitmap.bytesPerRow()).unwrap_or(0);
            let format = bitmap.bitmapFormat();
            if bitmap.isPlanar()
                || bitmap.bitsPerSample() != 8
                || ![3, 4].contains(&channels)
                || bitmap.bitsPerPixel() != channels as isize * 8
                || stride < width as usize * channels
                || stride > width as usize * 4 + 4096
                || format.contains(NSBitmapFormat::FloatingPointSamples)
                || bitmap.bitmapData().is_null()
            {
                return Err("Glass snapshot pixel layout unavailable".into());
            }
            let byte_length = stride
                .checked_mul(height as usize)
                .filter(|length| *length as u64 <= MAX_PIXELS * 8)
                .ok_or("Glass snapshot pixel buffer too large")?;
            // Copy bounded native pixels before leaving the main-thread callback;
            // PNG compression and base64 encoding happen in the waiting worker.
            let bytes =
                unsafe { std::slice::from_raw_parts(bitmap.bitmapData(), byte_length) }.to_vec();
            Ok(CapturedImage::Bitmap(Bitmap {
                width,
                height,
                stride,
                channels,
                alpha_first: bitmap.hasAlpha() && format.contains(NSBitmapFormat::AlphaFirst),
                premultiplied: bitmap.hasAlpha()
                    && !format.contains(NSBitmapFormat::AlphaNonpremultiplied),
                reverse_bytes: channels == 4
                    && format.contains(NSBitmapFormat::ThirtyTwoBitLittleEndian),
                bytes,
            }))
        })();
        let _ = tx.send(result);
    });
    unsafe {
        view.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &handler);
    }
    Ok(())
}

#[cfg(windows)]
fn start_capture(
    webview: tauri::webview::PlatformWebview,
    tx: Sender<Result<CapturedImage, String>>,
    guard: Arc<CaptureGuard>,
    _physical_width: u32,
    _scale: f64,
) -> Result<(), String> {
    use webview2_com::{
        CapturePreviewCompletedHandler,
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    };
    use windows::Win32::{
        Foundation::HGLOBAL,
        System::Com::{
            STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET, StructuredStorage::CreateStreamOnHGlobal,
        },
    };
    // All COM interfaces remain on the UI thread. Only owned PNG bytes are sent
    // to the worker; the memory stream frees its HGLOBAL on final release.
    unsafe {
        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)
            .map_err(|_| "Glass snapshot stream unavailable")?;
        let captured_stream = stream.clone();
        let callback = CapturePreviewCompletedHandler::create(Box::new(move |status| {
            let _retain_guard = &guard;
            let result = (|| {
                status.map_err(|_| "Glass snapshot capture failed")?;
                let mut stat = STATSTG::default();
                captured_stream
                    .Stat(&mut stat, STATFLAG_NONAME)
                    .map_err(|_| "Glass snapshot size unavailable")?;
                let length =
                    usize::try_from(stat.cbSize).map_err(|_| "Glass snapshot too large")?;
                if length > MAX_PNG_BYTES {
                    return Err("Glass snapshot too large".into());
                }
                captured_stream
                    .Seek(0, STREAM_SEEK_SET, None)
                    .map_err(|_| "Glass snapshot stream unavailable")?;
                let mut bytes = vec![0; length];
                let mut read = 0;
                captured_stream
                    .Read(bytes.as_mut_ptr().cast(), length as u32, Some(&mut read))
                    .ok()
                    .map_err(|_| "Glass snapshot read failed")?;
                if read as usize != length {
                    return Err("Glass snapshot incomplete".into());
                }
                Ok(CapturedImage::Png(bytes))
            })();
            let _ = tx.send(result);
            Ok(())
        }));
        let core = webview
            .controller()
            .CoreWebView2()
            .map_err(|_| "Glass snapshot webview unavailable")?;
        core.CapturePreview(
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
            &stream,
            &callback,
        )
        .map_err(|_| "Glass snapshot capture unavailable")?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn start_capture(
    _: tauri::webview::PlatformWebview,
    _: Sender<Result<CapturedImage, String>>,
    _: Arc<CaptureGuard>,
    _: u32,
    _: f64,
) -> Result<(), String> {
    Err("Glass snapshots unavailable on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_bounded_png_snapshots_are_returned() {
        assert!(png_backdrop(vec![]).is_err());
        assert!(checked_dimensions(0, 10).is_err());
        assert!(checked_dimensions(u32::MAX, u32::MAX).is_err());
        assert!(checked_dimensions(3840, 2160).is_ok());
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&1_u32.to_be_bytes());
        bytes.extend_from_slice(&1_u32.to_be_bytes());
        let image = png_backdrop(bytes.clone()).unwrap();
        assert_eq!((image.width, image.height), (1, 1));
        assert!(image.data_url.starts_with("data:image/png;base64,"));
        bytes[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(png_backdrop(bytes).is_err());
        assert!(png_backdrop(vec![0; MAX_PNG_BYTES + 1]).is_err());
    }

    #[cfg(target_os = "macos")]
    fn decoded(bitmap: Bitmap) -> Vec<u8> {
        let bytes = bitmap.encode().unwrap();
        let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut output = vec![0; decoder.output_buffer_size().unwrap()];
        let info = decoder.next_frame(&mut output).unwrap();
        output.truncate(info.buffer_size());
        output
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn native_bgra_premultiplication_does_not_create_black_glass_edges() {
        // Little-endian ARGB is BGRA in memory. Transparent pixels must have
        // zero RGB; premultiplied opaque/partial samples must be restored.
        let bitmap = Bitmap {
            width: 3,
            height: 1,
            stride: 12,
            channels: 4,
            alpha_first: true,
            premultiplied: true,
            reverse_bytes: true,
            bytes: vec![30, 20, 10, 255, 32, 16, 8, 64, 0, 0, 0, 0],
        };
        assert_eq!(
            decoded(bitmap),
            [10, 20, 30, 255, 31, 63, 127, 64, 0, 0, 0, 0]
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rgb_rows_ignore_padding_and_receive_opaque_alpha() {
        let bitmap = Bitmap {
            width: 1,
            height: 2,
            stride: 4,
            channels: 3,
            alpha_first: false,
            premultiplied: false,
            reverse_bytes: false,
            bytes: vec![10, 20, 30, 99, 40, 50, 60, 99],
        };
        assert_eq!(decoded(bitmap), [10, 20, 30, 255, 40, 50, 60, 255]);
    }
}
