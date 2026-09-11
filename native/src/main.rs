//! PL Composer — the program.
//!
//! Thin on purpose: everything real lives in the library so the same rules are reachable
//! from the parity harness and the tests. `windows_subsystem = "windows"` so double-
//! clicking the exe opens the app and not a console behind it — the renderer's output is
//! streamed into the window instead, which is the point of building this natively at all.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1500.0, 940.0])
            .with_min_inner_size([900.0, 600.0])
            .with_title("PL Composer"),
        ..Default::default()
    };
    eframe::run_native(
        "PL Composer",
        options,
        Box::new(|cc| Ok(Box::new(plcomposer::app::App::new(cc)))),
    )
}
