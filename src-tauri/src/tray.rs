use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Listener, LogicalPosition, Manager, PhysicalPosition, WebviewWindow, Wry,
};

const TRAY_ID: &str = "animus-desktop-tray";
const POPUP_LABEL: &str = "popup";
const TITLE_RUNNING: &str = "● Animus";
const TITLE_DOWN: &str = "✕ Animus";
const TITLE_MISSING: &str = "○ Animus";

const MENU_ID_HEADER: &str = "header";
const MENU_ID_STATUS: &str = "status";
const MENU_ID_NO_BUILDS: &str = "no-builds";
const MENU_ID_SHOW: &str = "show-window";
const MENU_ID_QUIT: &str = "quit";
const MENU_ID_BUILD_PREFIX: &str = "build-";

const POPUP_WIDTH: f64 = 360.0;
const POPUP_HEIGHT: f64 = 520.0;
const POPUP_EDGE_PADDING: f64 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonStatus {
    Running,
    Down,
    Missing,
}

impl DaemonStatus {
    fn title(self) -> &'static str {
        match self {
            DaemonStatus::Running => TITLE_RUNNING,
            DaemonStatus::Down => TITLE_DOWN,
            DaemonStatus::Missing => TITLE_MISSING,
        }
    }

    fn label(self) -> &'static str {
        match self {
            DaemonStatus::Running => "Status: running",
            DaemonStatus::Down => "Status: stopped",
            DaemonStatus::Missing => "Status: not installed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WispExpression {
    Awake,
    Working,
    Done,
    Resting,
    NeedsYou,
}

impl WispExpression {
    fn icon_bytes(self) -> &'static [u8] {
        match self {
            WispExpression::Awake => include_bytes!("../icons/wisp/awake@2x.png"),
            WispExpression::Working => include_bytes!("../icons/wisp/working@2x.png"),
            WispExpression::Done => include_bytes!("../icons/wisp/done@2x.png"),
            WispExpression::Resting => include_bytes!("../icons/wisp/resting@2x.png"),
            WispExpression::NeedsYou => include_bytes!("../icons/wisp/needs-you@2x.png"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrayBuildEntry {
    pub cycle_id: String,
    pub project_name: String,
    pub status: String,
    pub relative_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonStatusEvent {
    pub status: DaemonStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleCompletedEvent {
    pub builds: Vec<TrayBuildEntry>,
}

struct TrayState {
    status: DaemonStatus,
    builds: Vec<TrayBuildEntry>,
}

impl Default for TrayState {
    fn default() -> Self {
        Self {
            status: DaemonStatus::Down,
            builds: Vec::new(),
        }
    }
}

struct TrayCell(Mutex<TrayState>);

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    app.manage(TrayCell(Mutex::new(TrayState::default())));

    let menu = build_menu(app.handle(), DaemonStatus::Down, &[])?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .title(DaemonStatus::Down.title())
        .menu(&menu)
        // Left-click pops up our window; right-click shows the native menu.
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)?;

    if let Some(tray) = app.handle().tray_by_id(TRAY_ID) {
        if let Ok(image) = tauri::image::Image::from_bytes(WispExpression::Resting.icon_bytes()) {
            let _ = tray.set_icon(Some(image));
            let _ = tray.set_icon_as_template(true);
            let _ = tray.set_title(None::<&str>);
        }
    }

    // Hide popup on boot (workaround for visible:false config quirk in dev)
    // and on blur (standard menubar UX).
    if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
        let _ = popup.hide();
        let popup_clone = popup.clone();
        popup.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Focused(false)) {
                let _ = popup_clone.hide();
            }
        });
    }

    let handle = app.handle().clone();
    app.listen("daemon-status-changed", move |event| {
        let payload: Result<DaemonStatusEvent, _> = serde_json::from_str(event.payload());
        if let Ok(ev) = payload {
            if let Err(e) = apply_status(&handle, ev.status) {
                eprintln!("tray: apply_status failed: {e}");
            }
        }
    });

    let handle = app.handle().clone();
    app.listen("cycle-completed", move |event| {
        let payload: Result<CycleCompletedEvent, _> = serde_json::from_str(event.payload());
        if let Ok(ev) = payload {
            if let Err(e) = apply_builds(&handle, ev.builds) {
                eprintln!("tray: apply_builds failed: {e}");
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn set_wisp_expression(handle: AppHandle, expression: WispExpression) -> Result<(), String> {
    let tray = handle
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray not found".to_string())?;
    let image = tauri::image::Image::from_bytes(expression.icon_bytes())
        .map_err(|e| e.to_string())?;
    tray.set_icon(Some(image)).map_err(|e| e.to_string())?;
    tray.set_icon_as_template(true).map_err(|e| e.to_string())?;
    tray.set_title(None::<&str>).map_err(|e| e.to_string())?;
    Ok(())
}

fn apply_status(handle: &AppHandle, status: DaemonStatus) -> Result<(), String> {
    let builds = {
        let cell = handle.state::<TrayCell>();
        let mut guard = cell.0.lock().map_err(|e| e.to_string())?;
        guard.status = status;
        guard.builds.clone()
    };
    rebuild(handle, status, &builds).map_err(|e| e.to_string())
}

fn apply_builds(handle: &AppHandle, builds: Vec<TrayBuildEntry>) -> Result<(), String> {
    let (status, trimmed) = {
        let cell = handle.state::<TrayCell>();
        let mut guard = cell.0.lock().map_err(|e| e.to_string())?;
        let mut builds = builds;
        builds.truncate(5);
        guard.builds = builds.clone();
        (guard.status, builds)
    };
    rebuild(handle, status, &trimmed).map_err(|e| e.to_string())
}

fn rebuild(
    handle: &AppHandle,
    status: DaemonStatus,
    builds: &[TrayBuildEntry],
) -> tauri::Result<()> {
    let menu = build_menu(handle, status, builds)?;
    if let Some(tray) = handle.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
        tray.set_title(Some(status.title()))?;
    }
    Ok(())
}

fn build_menu(
    handle: &AppHandle,
    status: DaemonStatus,
    builds: &[TrayBuildEntry],
) -> tauri::Result<Menu<Wry>> {
    let header = MenuItemBuilder::with_id(MENU_ID_HEADER, "Animus Desktop")
        .enabled(false)
        .build(handle)?;
    let status_item = MenuItemBuilder::with_id(MENU_ID_STATUS, status.label())
        .enabled(false)
        .build(handle)?;
    let separator_a = PredefinedMenuItem::separator(handle)?;
    let separator_b = PredefinedMenuItem::separator(handle)?;

    let builds_submenu = build_builds_submenu(handle, builds)?;

    let show = MenuItemBuilder::with_id(MENU_ID_SHOW, "Show Window").build(handle)?;
    let quit = MenuItemBuilder::with_id(MENU_ID_QUIT, "Quit Animus").build(handle)?;

    MenuBuilder::new(handle)
        .item(&header)
        .item(&separator_a)
        .item(&status_item)
        .item(&builds_submenu)
        .item(&separator_b)
        .item(&show)
        .item(&quit)
        .build()
}

fn build_builds_submenu(
    handle: &AppHandle,
    builds: &[TrayBuildEntry],
) -> tauri::Result<Submenu<Wry>> {
    let mut builder = SubmenuBuilder::new(handle, "Last 5 builds");
    if builds.is_empty() {
        let empty = MenuItemBuilder::with_id(MENU_ID_NO_BUILDS, "No builds yet")
            .enabled(false)
            .build(handle)?;
        builder = builder.item(&empty);
    } else {
        for (idx, entry) in builds.iter().enumerate() {
            let id = format!("{MENU_ID_BUILD_PREFIX}{idx}");
            let label = format!(
                "{} — {} ({})",
                entry.project_name, entry.status, entry.relative_time
            );
            let item = MenuItemBuilder::with_id(id, label).build(handle)?;
            builder = builder.item(&item);
        }
    }
    builder.build()
}

fn handle_menu_event(handle: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    match id {
        MENU_ID_SHOW => focus_main_window(handle),
        MENU_ID_QUIT => handle.exit(0),
        other if other.starts_with(MENU_ID_BUILD_PREFIX) => {
            if let Some(suffix) = other.strip_prefix(MENU_ID_BUILD_PREFIX) {
                if let Ok(idx) = suffix.parse::<usize>() {
                    emit_build_selected(handle, idx);
                }
            }
        }
        _ => {}
    }
}

fn handle_tray_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button,
        button_state,
        rect,
        ..
    } = event
    {
        if button == MouseButton::Left && button_state == MouseButtonState::Up {
            let app = tray.app_handle().clone();
            if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
                let scale = popup.scale_factor().unwrap_or(1.0);
                let pos = rect.position.to_physical::<f64>(scale);
                let size = rect.size.to_physical::<f64>(scale);
                toggle_popup(&popup, pos, size);
            }
        }
    }
}

fn toggle_popup(
    window: &WebviewWindow,
    tray_pos: PhysicalPosition<f64>,
    tray_size: tauri::PhysicalSize<f64>,
) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    if let Err(e) = position_popup_under_tray(window, tray_pos, tray_size) {
        eprintln!("tray: failed to position popup: {e}");
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn position_popup_under_tray(
    window: &WebviewWindow,
    tray_pos: PhysicalPosition<f64>,
    tray_size: tauri::PhysicalSize<f64>,
) -> tauri::Result<()> {
    let scale = window.scale_factor().unwrap_or(1.0);
    let tray_center_x_logical = (tray_pos.x + tray_size.width / 2.0) / scale;
    let tray_bottom_y_logical = (tray_pos.y + tray_size.height) / scale;

    let mut x = tray_center_x_logical - (POPUP_WIDTH / 2.0);
    let mut y = tray_bottom_y_logical + POPUP_EDGE_PADDING;

    if let Some(monitor) = window.current_monitor()? {
        let m_pos = monitor.position();
        let m_size = monitor.size();
        let m_scale = monitor.scale_factor();
        let m_x = m_pos.x as f64 / m_scale;
        let m_y = m_pos.y as f64 / m_scale;
        let m_w = m_size.width as f64 / m_scale;
        let m_h = m_size.height as f64 / m_scale;

        if x + POPUP_WIDTH > m_x + m_w - POPUP_EDGE_PADDING {
            x = m_x + m_w - POPUP_WIDTH - POPUP_EDGE_PADDING;
        }
        if x < m_x + POPUP_EDGE_PADDING {
            x = m_x + POPUP_EDGE_PADDING;
        }
        if y + POPUP_HEIGHT > m_y + m_h - POPUP_EDGE_PADDING {
            y = m_y + m_h - POPUP_HEIGHT - POPUP_EDGE_PADDING;
        }
        if y < m_y + POPUP_EDGE_PADDING {
            y = m_y + POPUP_EDGE_PADDING;
        }
    }

    window.set_position(LogicalPosition::new(x, y))?;
    Ok(())
}

fn focus_main_window(handle: &AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn emit_build_selected(handle: &AppHandle, idx: usize) {
    let cell = handle.state::<TrayCell>();
    let entry = match cell.0.lock() {
        Ok(guard) => guard.builds.get(idx).cloned(),
        Err(_) => None,
    };
    if let Some(entry) = entry {
        let _ = handle.emit("tray-build-selected", entry);
    }
}
