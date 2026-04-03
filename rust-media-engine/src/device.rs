use candle_core::Device;

/// Select the best available compute device at runtime.
///
/// Priority: CUDA GPU > Metal GPU > CPU.
/// CUDA/Metal support is gated behind Cargo feature flags.
pub fn best_device() -> candle_core::Result<Device> {
    #[cfg(feature = "cuda")]
    {
        match Device::new_cuda(0) {
            Ok(device) => {
                eprintln!("[rust-media-engine] Using CUDA GPU (device 0)");
                return Ok(device);
            }
            Err(e) => {
                eprintln!("[rust-media-engine] CUDA requested but unavailable: {e}");
            }
        }
    }

    #[cfg(feature = "metal")]
    {
        match Device::new_metal(0) {
            Ok(device) => {
                eprintln!("[rust-media-engine] Using Metal GPU (device 0)");
                return Ok(device);
            }
            Err(e) => {
                eprintln!("[rust-media-engine] Metal requested but unavailable: {e}");
            }
        }
    }

    eprintln!("[rust-media-engine] Using CPU");
    Ok(Device::Cpu)
}
