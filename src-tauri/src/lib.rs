mod daemon;
mod github;
mod plugin;
mod project;
mod state;
mod template;
mod tray;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_state = tauri::async_runtime::block_on(async {
                AppState::new()
                    .await
                    .map_err(|e| Box::<dyn std::error::Error>::from(e))
            })?;
            app.manage(app_state);
            tray::setup(app)?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running animus desktop");
}
