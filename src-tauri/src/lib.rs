mod boss;
mod cdp;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(boss::BossState::new())
        .invoke_handler(tauri::generate_handler![
            boss::open_boss_window,
            boss::close_boss_window,
            boss::boss_window_open,
            boss::boss_eval,
            boss::get_login_qr,
            boss::show_browser,
            boss::hide_browser,
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
            use tauri::Manager;
            app.manage(cdp::CdpState::new(app.handle()));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            use tauri::Manager;
            let state = handle.state::<cdp::CdpState>();
            cdp::shutdown(&state);
        }
    });
}
