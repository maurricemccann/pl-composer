//! PL Composer — the program.
//!
//! Thin on purpose: everything real lives in the library so the same rules are reachable
//! from the parity harness and the tests. `windows_subsystem = "windows"` so double-
//! clicking the exe opens the app and not a console behind it — the renderer's output is
//! streamed into the window instead, which is the point of building this natively at all.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// The house mark (pl-os's own app icon) — reused rather than invented, per the
/// Two-Tongue Design Standard: an internal tool conforms to the inner-tongue system,
/// it doesn't design its own.
const ICON_PNG: &[u8] = include_bytes!("../assets/icon.png");

fn main() -> eframe::Result<()> {
    let icon = eframe::icon_data::from_png_bytes(ICON_PNG).expect("icon.png is valid PNG");
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1500.0, 940.0])
            .with_min_inner_size([900.0, 600.0])
            .with_title("PL Composer")
            .with_icon(icon),
        ..Default::default()
    };
    eframe::run_native(
        "PL Composer",
        options,
        Box::new(|cc| Ok(Box::new(plcomposer::app::App::new(cc)))),
    )
}
