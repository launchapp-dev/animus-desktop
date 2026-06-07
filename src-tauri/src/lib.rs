mod cycle_logs;
mod daemon;
mod event_bridge;
mod github;
mod plugin;
mod project;
mod queue;
mod state;
mod subject;
mod template;
mod tray;
mod workflow;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .setup(|app| {
            let app_state = tauri::async_runtime::block_on(async {
                AppState::new()
                    .await
                    .map_err(|e| Box::<dyn std::error::Error>::from(e))
            })?;
            app.manage(app_state);
            tray::setup(app)?;
            event_bridge::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon::daemon_install,
            daemon::daemon_status,
            daemon::daemon_start,
            daemon::daemon_stop,
            daemon::daemon_restart,
            plugin::plugin_list,
            plugin::plugin_install,
            plugin::plugin_install_defaults,
            github::github_auth_start,
            github::github_auth_poll,
            github::github_auth_status,
            github::github_logout,
            github::github_list_repos,
            github::github_register_webhook,
            github::github_list_webhooks,
            github::github_delete_webhook,
            project::project_list,
            project::project_get,
            project::project_create,
            project::project_delete,
            project::project_setup_template,
            template::template_render,
            cycle_logs::cycle_logs_subscribe,
            event_bridge::bridge_attach_project,
            event_bridge::bridge_detach_project,
            event_bridge::bridge_active_projects,
            workflow::workflow_run_task,
            workflow::workflow_run_id,
            workflow::workflow_list,
            queue::queue_list,
            queue::queue_stats,
            queue::queue_hold,
            queue::queue_release,
            queue::queue_drop,
            subject::subject_list,
            subject::subject_get,
            subject::subject_next,
            subject::animus_status,
            subject::animus_history,
            subject::logs_tail,
            subject::daemon_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running animus desktop");
}
