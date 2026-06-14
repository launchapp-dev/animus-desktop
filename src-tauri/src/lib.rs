mod agent_edit;
mod animus_cli;
mod chat;
mod cycle_logs;
mod daemon;
mod event_bridge;
mod event_log;
mod github;
mod local_folder;
mod plugin;
mod project;
mod queue;
mod state;
mod subject;
mod template;
mod tray;
mod workflow;
mod workflow_yaml;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
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

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address("127.0.0.1")
                .build(),
        );
    }

    builder
        .setup(|app| {
            let app_state = tauri::async_runtime::block_on(async {
                AppState::new()
                    .await
                    .map_err(|e| Box::<dyn std::error::Error>::from(e))
            })?;
            app.manage(app_state);
            app.manage(chat::ChatManager::new());
            tray::setup(app)?;
            event_bridge::start(app.handle().clone());

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        None,
                    );
                }
                if let Some(popup) = app.get_webview_window("popup") {
                    let _ = apply_vibrancy(
                        &popup,
                        NSVisualEffectMaterial::HudWindow,
                        Some(NSVisualEffectState::Active),
                        None,
                    );
                }
            }

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
            plugin::plugin_update,
            plugin::plugin_uninstall,
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
            subject::subject_create,
            subject::subject_update,
            subject::subject_set_status,
            subject::subject_delete,
            subject::animus_status,
            subject::animus_history,
            subject::logs_tail,
            subject::daemon_health,
            chat::chat_agent_run,
            chat::chat_cancel,
            chat::chat_providers,
            chat::chat_list,
            chat::chat_list_all,
            chat::chat_get,
            chat::chat_rename,
            chat::chat_delete,
            local_folder::local_folder_inspect,
            local_folder::local_folder_git_init,
            local_folder::project_adopt_local,
            local_folder::local_worktrees_list,
            local_folder::local_dir_list,
            local_folder::local_file_read,
            animus_cli::animus_workflow_config,
            animus_cli::animus_workflow_list,
            animus_cli::animus_status_get,
            animus_cli::animus_queue_list,
            animus_cli::animus_workflow_run,
            animus_cli::animus_daemon_config_get,
            animus_cli::animus_daemon_config_set,
            animus_cli::animus_secret_list,
            animus_cli::animus_secret_set,
            animus_cli::animus_secret_get,
            animus_cli::animus_secret_rm,
            animus_cli::animus_secret_import_env,
            animus_cli::animus_secret_export_env,
            animus_cli::animus_flavor_current,
            animus_cli::animus_workflow_definition_upsert,
            animus_cli::animus_workflow_phase_get,
            animus_cli::animus_workflow_phase_upsert,
            animus_cli::animus_workflow_phase_remove,
            animus_cli::animus_skill_list,
            animus_cli::animus_skill_info,
            animus_cli::animus_skill_save,
            animus_cli::animus_skill_delete,
            animus_cli::animus_skill_install,
            animus_cli::animus_skill_update,
            animus_cli::animus_skill_uninstall,
            animus_cli::animus_interactions_list,
            animus_cli::animus_interactions_answer,
            animus_cli::animus_phase_gate,
            animus_cli::animus_workflow_resume,
            animus_cli::animus_cost_workflow,
            workflow_yaml::local_workflows_read,
            workflow_yaml::local_workflow_file_read,
            workflow_yaml::local_mcp_server_upsert,
            workflow_yaml::local_mcp_link,
            agent_edit::local_agent_update,
            agent_edit::local_agent_create,
            event_log::local_events_read,
            event_log::local_workflow_runs,
            event_log::local_run_transcript,
        ])
        .run(tauri::generate_context!())
        .expect("error while running animus desktop");
}
