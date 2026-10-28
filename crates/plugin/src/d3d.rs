//! D3D11/DXGI hooks.
//!
//! Hooks `ID3D11Device::CreateTexture2D` (texture inventory for diagnostics), `CreateShaderResourceView` (the
//! tablet's screen texture as the game makes its view: see `screens`),
//! `ID3D11DeviceContext::OMSetRenderTargets*` and `PSSetShaderResources` (screen takeover, see `screens`).
//! The frame clock and heartbeat run on the SDK's frame end ([`on_frame_end`]), not on `Present`: a hook of
//! `IDXGISwapChain::Present` crashed ATS where other tools hook it too (owner 2026-10-27: RTSS, the Steam overlay,
//! snowymoon; even a detour doing nothing), and with snowymoon its vtable slot is never called.
//!
//! Function addresses come from the vtables of a throwaway device. MinHook patches the function bodies inside
//! d3d11.dll, so the hooks apply to the game's own device too (with snowymoon in, its calls skip the vtables:
//! taking a slot over instead was never called, 2026-10-27).

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{LazyLock, Mutex};

use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_CREATE_DEVICE_FLAG, D3D11_SDK_VERSION, D3D11_SUBRESOURCE_DATA, D3D11_TEXTURE2D_DESC, D3D11CreateDevice,
    ID3D11Device, ID3D11DeviceContext,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::core::{HRESULT, Interface, w};

use crate::hooks::{guarded, hook};
use crate::{bridge, log, screens};

// vtable slots (IUnknown = 0..2)
const VTBL_DEVICE_CREATE_TEXTURE2D: usize = 5;
const VTBL_DEVICE_CREATE_SHADER_RESOURCE_VIEW: usize = 7;
const VTBL_CONTEXT_PS_SET_SHADER_RESOURCES: usize = 8;
const VTBL_CONTEXT_OM_SET_RENDER_TARGETS: usize = 33;
const VTBL_CONTEXT_OM_SET_RENDER_TARGETS_AND_UAVS: usize = 34;

type CreateTexture2DFn = unsafe extern "system" fn(
    *mut c_void,
    *const D3D11_TEXTURE2D_DESC,
    *const D3D11_SUBRESOURCE_DATA,
    *mut *mut c_void,
) -> HRESULT;
type CreateShaderResourceViewFn =
    unsafe extern "system" fn(*mut c_void, *mut c_void, *const c_void, *mut *mut c_void) -> HRESULT;
type PSSetShaderResourcesFn = unsafe extern "system" fn(*mut c_void, u32, u32, *const *mut c_void);
type OMSetRenderTargetsFn = unsafe extern "system" fn(*mut c_void, u32, *const *mut c_void, *mut c_void);
type OMSetRenderTargetsAndUavsFn = unsafe extern "system" fn(
    *mut c_void,
    u32,
    *const *mut c_void,
    *mut c_void,
    u32,
    u32,
    *const *mut c_void,
    *const u32,
);

static ORIG_CREATE_TEXTURE2D: AtomicUsize = AtomicUsize::new(0);
static ORIG_CREATE_SHADER_RESOURCE_VIEW: AtomicUsize = AtomicUsize::new(0);
static ORIG_PS_SET_SHADER_RESOURCES: AtomicUsize = AtomicUsize::new(0);
static ORIG_OM_SET_RENDER_TARGETS: AtomicUsize = AtomicUsize::new(0);
static ORIG_OM_SET_RENDER_TARGETS_AND_UAVS: AtomicUsize = AtomicUsize::new(0);

static FRAME: AtomicU64 = AtomicU64::new(0);
static RENDERER_LOGGED: AtomicBool = AtomicBool::new(false);
static TEXTURES_DIRTY: AtomicBool = AtomicBool::new(false);

/// How often (in presented frames) the texture table is rewritten to disk.
const DUMP_EVERY_FRAMES: u64 = 300;

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct TexKey {
    width: u32,
    height: u32,
    mips: u32,
    array: u32,
    format: i32,
    samples: u32,
    usage: i32,
    bind: u32,
    cpu: u32,
    misc: u32,
    initial_data: bool,
}

#[derive(Clone, Copy)]
struct TexStat {
    count: u64,
    first_frame: u64,
    last_frame: u64,
}

static TEXTURES: LazyLock<Mutex<HashMap<TexKey, TexStat>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// # Safety
/// In the game's process, before the hooks are switched on ([`crate::hooks::enable_all`]).
pub unsafe fn install() -> Result<(), String> {
    // SAFETY: the vtables are d3d11.dll's own (`dummy_vtables`), each slot within them (the slot numbers are the
    // interfaces' fixed layout); hooked with detours of their exact signatures (below).
    unsafe {
        let DummyVtables { device: device_vtbl, context: context_vtbl } = dummy_vtables()?;

        hook(
            *device_vtbl.add(VTBL_DEVICE_CREATE_TEXTURE2D),
            create_texture2d_hook as *mut c_void,
            &ORIG_CREATE_TEXTURE2D,
            "CreateTexture2D",
        )?;
        hook(
            *device_vtbl.add(VTBL_DEVICE_CREATE_SHADER_RESOURCE_VIEW),
            create_shader_resource_view_hook as *mut c_void,
            &ORIG_CREATE_SHADER_RESOURCE_VIEW,
            "CreateShaderResourceView",
        )?;
        hook(
            *context_vtbl.add(VTBL_CONTEXT_PS_SET_SHADER_RESOURCES),
            ps_set_shader_resources_hook as *mut c_void,
            &ORIG_PS_SET_SHADER_RESOURCES,
            "PSSetShaderResources",
        )?;
        hook(
            *context_vtbl.add(VTBL_CONTEXT_OM_SET_RENDER_TARGETS),
            om_set_render_targets_hook as *mut c_void,
            &ORIG_OM_SET_RENDER_TARGETS,
            "OMSetRenderTargets",
        )?;
        hook(
            *context_vtbl.add(VTBL_CONTEXT_OM_SET_RENDER_TARGETS_AND_UAVS),
            om_set_render_targets_and_uavs_hook as *mut c_void,
            &ORIG_OM_SET_RENDER_TARGETS_AND_UAVS,
            "OMSetRenderTargetsAndUnorderedAccessViews",
        )?;
        Ok(())
    }
}

/// Diagnostics on unload (the hooks themselves are removed by `hooks::remove_all`).
pub fn on_unload() {
    dump_textures();
    screens::log_stats();
}

struct DummyVtables {
    device: *const usize,
    context: *const usize,
}

/// Creates a throwaway D3D11 device (no window, no swap chain) and returns its and its context's vtables.
///
/// # Safety
/// In the game's process, at init.
unsafe fn dummy_vtables() -> Result<DummyVtables, String> {
    // SAFETY: a throwaway device made here; its vtables stay valid after it goes (they're d3d11.dll's, not the
    // objects').
    unsafe {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_FLAG(0),
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .map_err(|e| format!("D3D11CreateDevice: {e}"))?;
        let device = device.ok_or("no dummy device")?;
        let context = context.ok_or("no dummy context")?;
        Ok(DummyVtables { device: vtable(device.as_raw()), context: vtable(context.as_raw()) })
    }
}

/// # Safety
/// `object` is a live COM object.
unsafe fn vtable(object: *mut c_void) -> *const usize {
    // SAFETY: a COM object starts with its vtable's address.
    unsafe { *(object as *const *const usize) }
}

/// # Safety
/// Called in place of `ID3D11Device::CreateTexture2D`, with its arguments.
unsafe extern "system" fn create_texture2d_hook(
    this: *mut c_void,
    desc: *const D3D11_TEXTURE2D_DESC,
    initial_data: *const D3D11_SUBRESOURCE_DATA,
    texture: *mut *mut c_void,
) -> HRESULT {
    // SAFETY: the trampoline was stored before the hooks were switched on (`install`, then `enable_all`), so it's
    // the original function, called with the game's arguments as they came; the description is
    // looked at only when set.
    unsafe {
        let original: CreateTexture2DFn = std::mem::transmute(ORIG_CREATE_TEXTURE2D.load(Ordering::Acquire));
        let result = original(this, desc, initial_data, texture);
        guarded(|| log_renderer(this));
        if let Some(desc) = desc.as_ref() {
            guarded(|| record_texture(desc, !initial_data.is_null()));
        }
        result
    }
}

/// # Safety
/// Called in place of `ID3D11Device::CreateShaderResourceView`, with its arguments.
unsafe extern "system" fn create_shader_resource_view_hook(
    this: *mut c_void,
    resource: *mut c_void,
    desc: *const c_void,
    view: *mut *mut c_void,
) -> HRESULT {
    // SAFETY: the trampoline was stored before the hooks were switched on (`install`, then `enable_all`), so it's
    // the original function, called with the game's arguments as they came; the view it made (and the resource
    // the game gave) are looked at only when it made one.
    unsafe {
        let original: CreateShaderResourceViewFn =
            std::mem::transmute(ORIG_CREATE_SHADER_RESOURCE_VIEW.load(Ordering::Acquire));
        let result = original(this, resource, desc, view);
        if result.is_ok() && !resource.is_null() && !view.is_null() && !(*view).is_null() {
            let made = *view;
            guarded(|| screens::on_view_created(resource, made));
        }
        result
    }
}

/// # Safety
/// Called in place of `ID3D11DeviceContext::PSSetShaderResources`, with its arguments.
unsafe extern "system" fn ps_set_shader_resources_hook(
    this: *mut c_void,
    start_slot: u32,
    count: u32,
    views: *const *mut c_void,
) {
    // SAFETY: the game's own arguments, looked at before they're bound (`on_set_shader_resources`); then
    // the trampoline was stored before the hooks were switched on (`install`, then `enable_all`), so it's
    // the original function, called with the game's arguments as they came.
    unsafe {
        guarded(|| screens::on_set_shader_resources(this, count, views));
        let original: PSSetShaderResourcesFn =
            std::mem::transmute(ORIG_PS_SET_SHADER_RESOURCES.load(Ordering::Acquire));
        original(this, start_slot, count, views)
    }
}

/// # Safety
/// Called in place of `ID3D11DeviceContext::OMSetRenderTargets`, with its arguments.
unsafe extern "system" fn om_set_render_targets_hook(
    this: *mut c_void,
    count: u32,
    views: *const *mut c_void,
    depth_stencil: *mut c_void,
) {
    // SAFETY: the game's own arguments, looked at first (`on_set_render_targets`); then
    // the trampoline was stored before the hooks were switched on (`install`, then `enable_all`), so it's
    // the original function, called with the game's arguments as they came.
    unsafe {
        guarded(|| screens::on_set_render_targets(count, views));
        let original: OMSetRenderTargetsFn = std::mem::transmute(ORIG_OM_SET_RENDER_TARGETS.load(Ordering::Acquire));
        original(this, count, views, depth_stencil)
    }
}

/// # Safety
/// Called in place of `OMSetRenderTargetsAndUnorderedAccessViews`, with its arguments.
#[allow(clippy::too_many_arguments)]
unsafe extern "system" fn om_set_render_targets_and_uavs_hook(
    this: *mut c_void,
    rtv_count: u32,
    views: *const *mut c_void,
    depth_stencil: *mut c_void,
    uav_start: u32,
    uav_count: u32,
    uavs: *const *mut c_void,
    uav_initial_counts: *const u32,
) {
    // SAFETY: the game's own arguments, looked at first unless it keeps its targets; then
    // the trampoline was stored before the hooks were switched on (`install`, then `enable_all`), so it's
    // the original function, called with the game's arguments as they came.
    unsafe {
        // D3D11_KEEP_RENDER_TARGETS_AND_DEPTH_STENCIL leaves the current targets bound.
        if rtv_count != u32::MAX {
            guarded(|| screens::on_set_render_targets(rtv_count, views));
        }
        let original: OMSetRenderTargetsAndUavsFn =
            std::mem::transmute(ORIG_OM_SET_RENDER_TARGETS_AND_UAVS.load(Ordering::Acquire));
        original(this, rtv_count, views, depth_stencil, uav_start, uav_count, uavs, uav_initial_counts)
    }
}

fn record_texture(desc: &D3D11_TEXTURE2D_DESC, initial_data: bool) {
    let key = TexKey {
        width: desc.Width,
        height: desc.Height,
        mips: desc.MipLevels,
        array: desc.ArraySize,
        format: desc.Format.0,
        samples: desc.SampleDesc.Count,
        usage: desc.Usage.0,
        bind: desc.BindFlags,
        cpu: desc.CPUAccessFlags,
        misc: desc.MiscFlags,
        initial_data,
    };
    let frame = FRAME.load(Ordering::Relaxed);
    let mut textures = TEXTURES.lock().unwrap_or_else(|e| e.into_inner());
    match textures.get_mut(&key) {
        Some(stat) => {
            stat.count += 1;
            stat.last_frame = frame;
        }
        None => {
            textures.insert(key, TexStat { count: 1, first_frame: frame, last_frame: frame });
            drop(textures);
            log!("new texture kind @frame {frame}: {}", describe(&key));
        }
    }
    TEXTURES_DIRTY.store(true, Ordering::Relaxed);
}

/// The game's frame ended (the SDK's frame end, on its main thread): the frame clock, input and heartbeat.
pub fn on_frame_end() {
    let frame = FRAME.fetch_add(1, Ordering::Relaxed) + 1;
    screens::on_frame(frame);
    // The interaction key's toggle, then the keybinds (which may need it).
    crate::input::on_frame();
    crate::keybinds::on_frame();
    if let Some(bridge) = bridge::get() {
        bridge.plugin.heartbeat.store(frame, Ordering::Release);
    }
    if frame.is_multiple_of(DUMP_EVERY_FRAMES) {
        if TEXTURES_DIRTY.swap(false, Ordering::Relaxed) {
            dump_textures();
        }
        if frame.is_multiple_of(DUMP_EVERY_FRAMES * 10) {
            screens::log_stats();
        }
    }
}

/// Logs the game's renderer and tells the app its GPU, once, from the first texture the game's device makes.
///
/// # Safety
/// `device` is the game's live device (the `this` of its `CreateTexture2D`).
unsafe fn log_renderer(device: *mut c_void) {
    if RENDERER_LOGGED.swap(true, Ordering::Relaxed) {
        return;
    }
    // SAFETY: the game's live device (the caller's contract), only asked about itself.
    unsafe {
        let d3d12_loaded = GetModuleHandleW(w!("d3d12.dll")).is_ok();
        let Some(device) = ID3D11Device::from_raw_borrowed(&device) else { return };
        log!(
            "renderer: Direct3D 11 (feature level {:#x}); d3d12.dll loaded: {d3d12_loaded}",
            device.GetFeatureLevel().0
        );
        publish_adapter(device);
    }
}

/// Tells the app which GPU the game renders on, so it creates the shared frame texture there.
///
/// # Safety
/// `device` is the game's live device.
unsafe fn publish_adapter(device: &ID3D11Device) {
    // SAFETY: the game's live device, only asked which adapter it's on.
    unsafe {
        let Some(bridge) = bridge::get() else { return };
        let Ok(adapter) = device.cast::<IDXGIDevice>().and_then(|d| d.GetAdapter()) else { return };
        let Ok(desc) = adapter.GetDesc() else { return };
        let plugin = &bridge.plugin;
        plugin.adapter_luid_low.store(desc.AdapterLuid.LowPart, Ordering::Relaxed);
        plugin.adapter_luid_high.store(desc.AdapterLuid.HighPart, Ordering::Relaxed);
        plugin.pid.store(std::process::id(), Ordering::Release);
        let name = String::from_utf16_lossy(&desc.Description);
        log!(
            "adapter: {} (LUID {:#x}:{:#x})",
            name.trim_end_matches('\0'),
            desc.AdapterLuid.HighPart,
            desc.AdapterLuid.LowPart
        );
    }
}

/// Writes the texture kinds seen to `textures.txt`, on the log's thread (the table copied under its lock,
/// which texture creation takes too, the text made and written after).
fn dump_textures() {
    log::write_file_later("textures.txt", || {
        let mut rows: Vec<(TexKey, TexStat)> = {
            let textures = TEXTURES.lock().unwrap_or_else(|e| e.into_inner());
            textures.iter().map(|(key, stat)| (*key, *stat)).collect()
        };
        rows.sort_by_key(|(key, _)| *key);
        let mut out = String::from("# texture kinds seen by CreateTexture2D (sorted by size)\n");
        out += &format!("# frame {}\n", FRAME.load(Ordering::Relaxed));
        out += "#   count  first_frame  last_frame  description\n";
        for (key, stat) in rows {
            out +=
                &format!("{:>9}  {:>11}  {:>10}  {}\n", stat.count, stat.first_frame, stat.last_frame, describe(&key));
        }
        out
    });
}

fn describe(key: &TexKey) -> String {
    format!(
        "{}x{} mips={} array={} fmt={} samples={} usage={} bind={:#x} cpu={:#x} misc={:#x} init={}",
        key.width,
        key.height,
        key.mips,
        key.array,
        key.format,
        key.samples,
        key.usage,
        key.bind,
        key.cpu,
        key.misc,
        key.initial_data
    )
}
