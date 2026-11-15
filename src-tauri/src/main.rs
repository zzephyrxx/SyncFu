#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod glass_capture;
mod permissions;

use serde::Serialize;
use std::{
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
};
use syncfu_core::{
    conflicts::{ConflictPreview, DecisionRequest, ReviewNote},
    engine::{Engine, Folder, Settings},
    model::{Batch, Plan, Task},
    node::{Code, DEFAULT_PORT, FolderList, Node, ProgressPage, Snapshot},
    pairing::Identity,
    policy::{PolicyState, PolicyView, TaskPolicy},
    risk::ExecutionPreview,
    usage::UsageReport,
};
use tauri::{
    AppHandle, Manager, State, WindowEvent,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

fn update_url() -> Option<&'static str> {
    option_env!("SYNCFU_RELEASE_PAGE").filter(|url| url.starts_with("https://"))
}

#[tauri::command]
fn open_updates(app: AppHandle) -> Response<()> {
    let url = update_url().ok_or("此构建尚未配置发布页")?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

type Handle<'a> = State<'a, Arc<Node>>;
type Response<T> = Result<T, String>;
fn response<T>(res: anyhow::Result<T>) -> Response<T> {
    res.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn snapshot(node: Handle<'_>) -> Response<Snapshot> {
    response(node.snapshot())
}

#[tauri::command]
fn execution_progress(node: Handle<'_>, batch: Option<String>, after: usize) -> ProgressPage {
    node.execution_progress(batch.as_deref(), after)
}

#[derive(Serialize)]
struct PermissionReport {
    platform: &'static str,
    port: u16,
    addresses: Vec<String>,
    listener_error: Option<String>,
    firewall: Option<permissions::WindowsFirewall>,
}

#[tauri::command]
async fn check_permissions(node: Handle<'_>) -> Response<PermissionReport> {
    let device = node.device();
    let listener_error = node
        .check_listener()
        .await
        .err()
        .map(|error| format!("{error:#}"));
    #[cfg(windows)]
    let firewall =
        tauri::async_runtime::spawn_blocking(move || permissions::firewall_status(device.port))
            .await
            .ok()
            .and_then(Result::ok);
    #[cfg(not(windows))]
    let firewall = None;
    Ok(PermissionReport {
        platform: std::env::consts::OS,
        port: device.port,
        addresses: device.addresses,
        listener_error,
        firewall,
    })
}

#[tauri::command]
async fn test_peer_address(node: Handle<'_>, address: String) -> Response<String> {
    response(node.probe_peer(&address).await)
}

#[tauri::command]
async fn open_permission_settings() -> Response<()> {
    tauri::async_runtime::spawn_blocking(|| response(permissions::open_settings()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn allow_private_lan() -> Response<()> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(|| {
        response(permissions::allow_private_lan(DEFAULT_PORT))
    })
    .await
    .map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    Err("请在系统设置中允许 SyncFu 访问本地网络".into())
}
#[tauri::command]
async fn invite(node: Handle<'_>) -> Response<Code> {
    let node = node.inner().clone();
    tauri::async_runtime::spawn_blocking(move || response(node.invite()))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn pair(
    node: Handle<'_>,
    address: String,
    code: String,
    device_id: Option<String>,
) -> Response<()> {
    response(node.pair_at(&address, &code, device_id.as_deref()).await)
}
#[tauri::command]
fn answer_pair(node: Handle<'_>, id: String, accept: bool) -> Response<()> {
    response(node.answer_pair(&id, accept))
}
#[tauri::command]
fn forget_peer(node: Handle<'_>, peer: String) -> Response<()> {
    response(node.forget(&peer))
}
#[tauri::command]
async fn folders(node: Handle<'_>, peer: String) -> Response<FolderList> {
    response(node.folders(&peer).await)
}
#[tauri::command]
fn local_folders(node: Handle<'_>, peer: String) -> Response<Vec<Folder>> {
    response(node.local_folders(&peer))
}
#[tauri::command]
async fn grant_folder(app: AppHandle, node: Handle<'_>, peer: String) -> Response<Option<Folder>> {
    let node = node.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        response((|| {
            let Some(path) = app
                .dialog()
                .file()
                .set_title("选择授权给对端的文件夹")
                .blocking_pick_folder()
            else {
                return Ok(None);
            };
            Ok(Some(node.grant(&peer, &path.into_path()?)?))
        })())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn revoke_folder(node: Handle<'_>, id: String) -> Response<()> {
    response(node.revoke(&id))
}
#[tauri::command]
async fn create_task(
    node: Handle<'_>,
    peer: String,
    local: String,
    remote: String,
) -> Response<Task> {
    response(node.create_task(&peer, &local, &remote).await)
}
#[tauri::command]
fn task_policy(node: Handle<'_>, task: String) -> Response<PolicyView> {
    response(node.task_policy(&task))
}
#[tauri::command]
async fn propose_task_policy(
    node: Handle<'_>,
    task: String,
    expected_revision: u32,
    next: TaskPolicy,
) -> Response<PolicyState> {
    response(
        node.inner()
            .propose_policy(&task, expected_revision, next)
            .await,
    )
}
#[tauri::command]
async fn answer_task_policy(
    node: Handle<'_>,
    task: String,
    proposal: String,
    accept: bool,
) -> Response<PolicyState> {
    response(node.inner().answer_policy(&task, &proposal, accept).await)
}
#[tauri::command]
async fn reconcile_task_policy(node: Handle<'_>, task: String) -> Response<PolicyState> {
    response(node.inner().reconcile_policy(&task).await)
}
#[tauri::command]
async fn pause_task(node: Handle<'_>, task: String, paused: bool) -> Response<()> {
    let node = node.inner().clone();
    tauri::async_runtime::spawn_blocking(move || response(node.pause_task(&task, paused)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn pause_all(node: Handle<'_>, paused: bool) -> Response<()> {
    let node = node.inner().clone();
    tauri::async_runtime::spawn_blocking(move || response(node.pause_all(paused)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn preview_execution(
    node: Handle<'_>,
    plan: String,
    digest: String,
    selected: Vec<String>,
) -> Response<ExecutionPreview> {
    response(
        node.inner()
            .preview_execution(&plan, &digest, selected)
            .await,
    )
}
#[tauri::command]
async fn resolve_plan(
    node: Handle<'_>,
    plan: String,
    digest: String,
    decisions: Vec<DecisionRequest>,
) -> Response<Plan> {
    response(node.inner().resolve_plan(&plan, &digest, decisions).await)
}
#[tauri::command]
async fn preview_conflict(
    node: Handle<'_>,
    plan: String,
    digest: String,
    path: String,
) -> Response<ConflictPreview> {
    response(node.inner().preview_conflict(&plan, &digest, &path).await)
}
#[tauri::command]
fn review_notes(node: Handle<'_>, task: String) -> Response<Vec<ReviewNote>> {
    response(node.engine.review_notes(&task))
}
#[tauri::command]
fn clear_review_note(node: Handle<'_>, task: String, path: String) -> Response<()> {
    response(node.clear_review_note(&task, &path))
}
#[tauri::command]
fn usage_report(node: Handle<'_>) -> Response<UsageReport> {
    response(node.engine.usage_report())
}
#[tauri::command]
fn set_usage_enabled(node: Handle<'_>, enabled: bool) -> Response<()> {
    response(node.engine.set_usage_enabled(enabled))
}
#[tauri::command]
fn clear_usage(node: Handle<'_>) -> Response<()> {
    response(node.engine.clear_usage())
}
#[tauri::command]
async fn inspect_task(node: Handle<'_>, task: String) -> Response<Plan> {
    response(node.inner().inspect(&task).await)
}
#[tauri::command]
async fn inspect_undo(node: Handle<'_>, batch: String) -> Response<Plan> {
    response(node.inner().inspect_undo(&batch).await)
}
#[tauri::command]
async fn execute_plan(
    node: Handle<'_>,
    plan: String,
    digest: String,
    selected: Vec<String>,
    approve_risk: Option<bool>,
) -> Response<Batch> {
    response(
        node.inner()
            .execute_reviewed(&plan, &digest, selected, approve_risk.unwrap_or(false))
            .await,
    )
}
#[tauri::command]
async fn cancel_batch(node: Handle<'_>) -> Response<()> {
    response(node.cancel().await)
}
#[tauri::command]
async fn reconcile(node: Handle<'_>, batch: String) -> Response<Batch> {
    response(node.inner().reconcile(&batch).await)
}

#[derive(Serialize)]
struct AppSettings {
    #[serde(flatten)]
    backup: Settings,
    autostart: bool,
    updates_available: bool,
}
#[tauri::command]
fn settings(app: AppHandle, node: Handle<'_>) -> Response<AppSettings> {
    Ok(AppSettings {
        backup: response(node.engine.settings())?,
        updates_available: update_url().is_some(),
        autostart: app.autolaunch().is_enabled().map_err(|e| e.to_string())?,
    })
}
#[tauri::command]
async fn save_settings(
    app: AppHandle,
    node: Handle<'_>,
    days: u32,
    quota: u64,
    autostart: bool,
    choose_location: bool,
) -> Response<AppSettings> {
    let node = node.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        response((|| {
            let path = if choose_location {
                app.dialog()
                    .file()
                    .set_title("选择备份所在文件夹")
                    .blocking_pick_folder()
                    .map(|p| p.into_path())
                    .transpose()?
            } else {
                None
            };
            let backup = node.engine.set_settings(days, quota, path)?;
            let manager = app.autolaunch();
            if autostart != manager.is_enabled()? {
                if autostart {
                    manager.enable()?;
                } else {
                    manager.disable()?;
                }
            }
            Ok(AppSettings {
                backup,
                autostart: manager.is_enabled()?,
                updates_available: update_url().is_some(),
            })
        })())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn identity(dir: &std::path::Path) -> anyhow::Result<Identity> {
    let entry = keyring::Entry::new("org.syncfu.desktop", &dir.to_string_lossy())?;
    match entry.get_secret() {
        Ok(bytes) => Identity::from_secret_bytes(&bytes),
        Err(keyring::Error::NoEntry) => {
            let identity = Identity::generate()?;
            entry.set_secret(&identity.secret_bytes()?)?;
            Ok(identity)
        }
        Err(e) => Err(e.into()),
    }
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .filter(|v| v.status.success())
                .map(|v| String::from_utf8_lossy(&v.stdout).trim().to_owned())
        })
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "SyncFu 设备".into())
        .trim()
        .chars()
        .take(60)
        .collect()
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn tray_icon(bytes: &[u8]) -> anyhow::Result<tauri::image::Image<'static>> {
    let mut reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info()?;
    let size = reader
        .output_buffer_size()
        .ok_or_else(|| anyhow::anyhow!("托盘图标尺寸无效"))?;
    let mut pixels = vec![0; size];
    let frame = reader.next_frame(&mut pixels)?;
    anyhow::ensure!(
        frame.color_type == png::ColorType::Rgba && frame.bit_depth == png::BitDepth::Eight,
        "托盘图标须为 8 位 RGBA PNG"
    );
    pixels.truncate(frame.buffer_size());
    Ok(tauri::image::Image::new_owned(
        pixels,
        frame.width,
        frame.height,
    ))
}

fn setup(app: &mut tauri::App) -> anyhow::Result<()> {
    let dir: PathBuf = app.path().app_local_data_dir()?;
    // Native UI checks can use disposable state without touching an installed
    // application's database or its path-scoped keychain identity. Release
    // builds do not read this environment variable.
    #[cfg(debug_assertions)]
    let dir = std::env::var_os("SYNCFU_DEV_DATA_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or(dir);
    let engine = Engine::open(&dir)?;
    #[cfg(debug_assertions)]
    let identity = if std::env::var_os("SYNCFU_DEV_DATA_DIR").is_some_and(|value| !value.is_empty())
    {
        // Disposable visual checks never open or update the user's keychain.
        // The fixture identity is intentionally different on every startup.
        Identity::generate()?
    } else {
        identity(&dir)?
    };
    #[cfg(not(debug_assertions))]
    let identity = identity(&dir)?;
    let node = tauri::async_runtime::block_on(async {
        let fixed = SocketAddr::from((Ipv4Addr::UNSPECIFIED, DEFAULT_PORT));
        match Node::start(engine, identity, device_name(), fixed, true).await {
            Ok(node) => Ok(node),
            Err(error) => Err(error),
        }
    })?;
    app.manage(node);
    let open = MenuItem::with_id(app, "open", "打开 SyncFu", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 SyncFu", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let tray = TrayIconBuilder::with_id("syncfu")
        .menu(&menu)
        .tooltip("SyncFu")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "quit" => app.exit(0),
            _ => (),
        });
    #[cfg(target_os = "macos")]
    let tray = tray
        .icon(tray_icon(include_bytes!(
            "../../assets/syncfu-menubar@2x.png"
        ))?)
        .icon_as_template(true);
    #[cfg(windows)]
    let tray = tray.icon(tray_icon(include_bytes!("../icons/32x32.png"))?);
    #[cfg(not(any(windows, target_os = "macos")))]
    let tray = match app.default_window_icon() {
        Some(icon) => tray.icon(icon.clone()),
        None => tray,
    };
    tray.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            if let Err(error) = setup(app) {
                app.dialog()
                    .message(format!("无法启动 SyncFu\n{error:#}"))
                    .title("SyncFu")
                    .kind(MessageDialogKind::Error)
                    .show(|_| {});
                return Err(error.into());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            glass_capture::capture_glass_backdrop,
            snapshot,
            execution_progress,
            check_permissions,
            test_peer_address,
            open_permission_settings,
            allow_private_lan,
            invite,
            pair,
            answer_pair,
            forget_peer,
            folders,
            local_folders,
            grant_folder,
            revoke_folder,
            create_task,
            task_policy,
            propose_task_policy,
            answer_task_policy,
            reconcile_task_policy,
            pause_task,
            pause_all,
            preview_execution,
            resolve_plan,
            preview_conflict,
            review_notes,
            clear_review_note,
            usage_report,
            set_usage_enabled,
            clear_usage,
            inspect_task,
            inspect_undo,
            execute_plan,
            cancel_batch,
            reconcile,
            settings,
            save_settings,
            open_updates
        ])
        .build(tauri::generate_context!())
        .expect("无法初始化 SyncFu")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show(app);
            }
            let _ = (app, event);
        });
}
