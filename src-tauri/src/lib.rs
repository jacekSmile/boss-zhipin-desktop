mod boss;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(boss::BossState::new())
        .invoke_handler(tauri::generate_handler![
            boss::open_boss_window,
            boss::close_boss_window,
            boss::boss_window_open,
            boss::boss_eval,
            boss::start_batch,
            boss::cancel_batch,
            boss::batch_running,
            storage::list_resumes,
            storage::save_resume,
            storage::delete_resume,
            storage::read_resume_base64,
            storage::load_history,
            storage::append_history,
            storage::clear_history,
        ])
        .setup(|app| {
            boss::setup_result_listener(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
