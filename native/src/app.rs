//! The program.
//!
//! What makes this worth building as software rather than a page: the render button.
//! The web board emits a spec and stops there, because a Cloudflare Worker cannot invoke
//! ffmpeg or Blender on this machine. Here the same emitter's output goes straight to
//! `compose_render.py` and the log streams back into the window. Score, render, watch —
//! one surface.
//!
//! Layout follows the board it replaces: the library on the left, the graph in the
//! middle as the dark ink well §11 asks for, the spec and the render log on the right.

use crate::bridge::{canvas_of, snarl_of, terminal_count};
use crate::emit::{emit_spec, stamp_now};
use crate::graph::{canvas_for, to_graph_nodes, GNodeData, NodeKind};
use crate::types::{
    transition_why, Asset, Manifest, Piece, Shot, TRANSITIONS, TRANSITION_SECONDS,
};
use crate::viewer::PlViewer;
use egui_snarl::{ui::SnarlWidget, Snarl};
use serde_json::Map;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};

const DEFAULT_MANIFEST: &str = r"C:\dev\OpenMontage\projects\pl-curves\manifest.json";
const DEFAULT_RENDERER: &str = r"C:\dev\OpenMontage\projects\pl-curves\compose_render.py";
// Bare `python` on this machine resolves to miniforge, but naming the interpreter
// explicitly means a PATH change cannot silently send the render to a different one.
const DEFAULT_PYTHON: &str = r"C:\Users\maurr\miniforge3\python.exe";

/// `"dissolve 0.5"` → `("dissolve", 0.5)`. A bare name takes the house default, and
/// anything unparseable reads as a cut rather than throwing in the middle of a frame.
fn split_transition(t: Option<&str>) -> (String, f64) {
    let Some(t) = t else { return ("cut".into(), TRANSITION_SECONDS) };
    let mut parts = t.split_whitespace();
    let name = parts.next().unwrap_or("cut").to_string();
    let secs = parts.next().and_then(|s| s.parse().ok()).unwrap_or(TRANSITION_SECONDS);
    (name, secs)
}

pub struct App {
    piece: Piece,
    piece_path: String,
    manifest_path: String,
    renderer_path: String,
    python_path: String,

    assets: Vec<Asset>,
    by_id: HashMap<String, Asset>,
    filter: String,
    kind_filter: Option<String>,

    shot_idx: Option<usize>,
    snarl: Snarl<GNodeData>,
    refusal: Option<String>,

    spec: String,
    log: Vec<String>,
    rx: Option<Receiver<String>>,
    rendering: bool,
    status: String,
}

impl Default for App {
    fn default() -> Self {
        App {
            piece: Piece::default(),
            piece_path: String::new(),
            manifest_path: DEFAULT_MANIFEST.into(),
            renderer_path: DEFAULT_RENDERER.into(),
            python_path: DEFAULT_PYTHON.into(),
            assets: Vec::new(),
            by_id: HashMap::new(),
            filter: String::new(),
            kind_filter: None,
            shot_idx: None,
            snarl: Snarl::new(),
            refusal: None,
            spec: String::new(),
            log: Vec::new(),
            rx: None,
            rendering: false,
            status: String::new(),
        }
    }
}

impl App {
    pub fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        let mut app = App::default();
        app.load_manifest();
        app
    }

    /* ───────────────────────── io ───────────────────────── */

    fn load_manifest(&mut self) {
        match std::fs::read_to_string(&self.manifest_path)
            .map_err(|e| e.to_string())
            .and_then(|raw| serde_json::from_str::<Manifest>(&raw).map_err(|e| e.to_string()))
        {
            Ok(m) => {
                self.assets = m.assets;
                self.by_id = self.assets.iter().map(|a| (a.id.clone(), a.clone())).collect();
                self.status = format!("library: {} assets", self.assets.len());
            }
            Err(e) => {
                // Fail loud. An empty library that says nothing looks like an empty
                // library, and the founder would go looking in the wrong place.
                self.assets.clear();
                self.by_id.clear();
                self.status = format!("could not read manifest: {e}");
            }
        }
    }

    fn load_piece(&mut self) {
        match std::fs::read_to_string(&self.piece_path)
            .map_err(|e| e.to_string())
            .and_then(|raw| serde_json::from_str::<Piece>(&raw).map_err(|e| e.to_string()))
        {
            Ok(p) => {
                self.piece = p;
                self.shot_idx = None;
                self.snarl = Snarl::new();
                self.open_shot(0);
                self.status = format!("{}: {} shots", self.piece.piece, self.piece.shots.len());
            }
            Err(e) => self.status = format!("could not read piece: {e}"),
        }
    }

    fn save_piece(&mut self) {
        self.commit_shot();
        if self.piece_path.trim().is_empty() {
            self.piece_path = format!("{}.piece.json", self.piece.piece);
        }
        match serde_json::to_string_pretty(&self.piece)
            .map_err(|e| e.to_string())
            .and_then(|s| std::fs::write(&self.piece_path, s).map_err(|e| e.to_string()))
        {
            Ok(()) => self.status = format!("saved {}", self.piece_path),
            Err(e) => self.status = format!("save failed: {e}"),
        }
    }

    /* ───────────────────────── shots ───────────────────────── */

    /// Write the live canvas back onto the shot it belongs to. Called before anything
    /// that changes which shot is open, so an edit can never be lost by clicking away.
    fn commit_shot(&mut self) {
        let Some(i) = self.shot_idx else { return };
        let (nodes, edges, _) = canvas_of(&self.snarl);
        let graph = to_graph_nodes(&nodes, &edges);
        if let Some(s) = self.piece.shots.get_mut(i) {
            s.nodes = Some(graph);
        }
    }

    fn open_shot(&mut self, i: usize) {
        if self.shot_idx == Some(i) {
            return;
        }
        self.commit_shot();
        if let Some(shot) = self.piece.shots.get(i) {
            let (nodes, edges) = canvas_for(shot, &self.by_id);
            self.snarl = snarl_of(&nodes, &edges);
            self.shot_idx = Some(i);
            self.refusal = None;
        }
    }

    fn add_source_node(&mut self, asset: &Asset) {
        if self.shot_idx.is_none() {
            self.status = "open a shot first".into();
            return;
        }
        // The shot's source list and the canvas are two views of one fact — keep them
        // together, or the spine card and the graph disagree about what a shot draws on.
        if let Some(i) = self.shot_idx {
            if let Some(s) = self.piece.shots.get_mut(i) {
                if !s.source_ids.contains(&asset.id) {
                    s.source_ids.push(asset.id.clone());
                }
            }
        }
        self.snarl.insert_node(
            egui::pos2(24.0, 24.0),
            GNodeData {
                kind: NodeKind::Source,
                asset_id: Some(asset.id.clone()),
                out: None,
                args: Map::new(),
            },
        );
        self.status = format!("added {}", asset.name);
    }

    /* ───────────────────────── spec + render ───────────────────────── */

    fn build_spec(&mut self) {
        self.commit_shot();
        self.spec = emit_spec(&self.piece, &self.assets, &stamp_now());
        self.status = format!("spec: {} chars", self.spec.chars().count());
    }

    fn spec_path(&self) -> PathBuf {
        std::env::temp_dir().join(format!("{}.spec.md", self.piece.piece))
    }

    fn render(&mut self) {
        if self.rendering {
            return;
        }
        self.build_spec();
        let path = self.spec_path();
        if let Err(e) = std::fs::write(&path, &self.spec) {
            self.status = format!("could not write spec: {e}");
            return;
        }

        let (tx, rx) = channel::<String>();
        let py = self.python_path.clone();
        let script = self.renderer_path.clone();
        let spec = path.to_string_lossy().to_string();

        self.log.clear();
        self.log.push(format!("$ {py} {script} {spec}"));
        self.rx = Some(rx);
        self.rendering = true;

        std::thread::spawn(move || {
            use std::process::{Command, Stdio};
            let child = Command::new(&py)
                .arg(&script)
                .arg(&spec)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn();

            let mut child = match child {
                Ok(c) => c,
                Err(e) => {
                    // The renderer not starting is the failure most likely to be
                    // misread as "it rendered nothing", so it says so in the log.
                    let _ = tx.send(format!("!! could not start the renderer: {e}"));
                    let _ = tx.send("__done__".into());
                    return;
                }
            };

            if let Some(out) = child.stdout.take() {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    if tx.send(line).is_err() {
                        return;
                    }
                }
            }
            if let Some(err) = child.stderr.take() {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    if tx.send(format!("stderr: {line}")).is_err() {
                        return;
                    }
                }
            }
            match child.wait() {
                // Never claim success the exit code did not confirm — the status line
                // carries the observation, not an assumption about it.
                Ok(st) if st.success() => { let _ = tx.send("-- renderer exited 0".into()); }
                Ok(st) => { let _ = tx.send(format!("!! renderer exited {}", st.code().unwrap_or(-1))); }
                Err(e) => { let _ = tx.send(format!("!! renderer did not finish: {e}")); }
            }
            let _ = tx.send("__done__".into());
        });
    }

    fn pump_log(&mut self) {
        let mut done = false;
        if let Some(rx) = &self.rx {
            while let Ok(line) = rx.try_recv() {
                if line == "__done__" {
                    done = true;
                } else {
                    self.log.push(line);
                }
            }
        }
        if done {
            self.rendering = false;
            self.rx = None;
            self.status = self
                .log
                .last()
                .cloned()
                .unwrap_or_else(|| "render finished".into());
        }
    }
}

impl eframe::App for App {
    // eframe 0.36 hands the app a `Ui` rather than a `Context`, so every panel here uses
    // the `show(ui, …)` form. Checked against the installed trait, not remembered.
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.pump_log();
        if self.rendering {
            // The render runs on its own thread; without this the log would only advance
            // when the founder happened to move the mouse.
            ui.ctx().request_repaint_after(std::time::Duration::from_millis(120));
        }

        egui::containers::Panel::top("top").show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.heading("PL Composer");
                ui.separator();
                ui.label("piece");
                ui.add(egui::TextEdit::singleline(&mut self.piece.piece).desired_width(160.0));
                ui.label("fps");
                ui.add(egui::DragValue::new(&mut self.piece.fps).range(1.0..=120.0));
                ui.label("res");
                ui.add(egui::TextEdit::singleline(&mut self.piece.resolution).desired_width(100.0));
                ui.separator();
                // The piece-wide default. Absent means every boundary is a cut and the
                // renderer stream-copies the join instead of re-encoding.
                ui.label("cuts");
                let (mut pname, mut psecs) = split_transition(self.piece.transition.as_deref());
                let none = self.piece.transition.is_none();
                let mut pchanged = false;
                egui::ComboBox::from_id_salt("piece-trans")
                    .selected_text(if none { "cut".to_string() } else { pname.clone() })
                    .show_ui(ui, |ui| {
                        for t in TRANSITIONS {
                            let sel = if none { t == "cut" } else { pname == t };
                            if ui.selectable_label(sel, t).on_hover_text(transition_why(t)).clicked() {
                                pname = t.to_string();
                                pchanged = true;
                            }
                        }
                    });
                if !none && pname != "cut" {
                    if ui
                        .add(egui::DragValue::new(&mut psecs).range(0.05..=3.0).speed(0.05).suffix("s"))
                        .changed()
                    {
                        pchanged = true;
                    }
                }
                if pchanged {
                    self.piece.transition = if pname == "cut" {
                        None
                    } else {
                        Some(format!("{pname} {psecs:.2}"))
                    };
                }
                ui.separator();
                ui.label(format!("{:.1}s total", self.piece.duration()));
            });
            ui.horizontal(|ui| {
                ui.label("file");
                ui.add(egui::TextEdit::singleline(&mut self.piece_path).desired_width(360.0));
                if ui.button("open").clicked() {
                    self.load_piece();
                }
                if ui.button("save").clicked() {
                    self.save_piece();
                }
                ui.separator();
                if ui.button("build spec").clicked() {
                    self.build_spec();
                }
                let can_render = !self.rendering && !self.piece.shots.is_empty();
                if ui
                    .add_enabled(can_render, egui::Button::new(if self.rendering { "rendering…" } else { "render" }))
                    .clicked()
                {
                    self.render();
                }
            });
        });

        egui::containers::Panel::bottom("status").show(ui, |ui| {
            ui.horizontal(|ui| {
                if let Some(r) = &self.refusal {
                    ui.colored_label(egui::Color32::from_rgb(0xc0, 0x39, 0x2b), format!("refused: {r}"));
                } else {
                    ui.label(&self.status);
                }
            });
        });

        /* ───────── library ───────── */
        egui::containers::Panel::left("library").default_size(280.0).show(ui, |ui| {
            ui.heading("library");
            ui.horizontal(|ui| {
                ui.add(egui::TextEdit::singleline(&mut self.filter).hint_text("filter").desired_width(120.0));
                for k in ["media", "curve", "audio", "model"] {
                    let on = self.kind_filter.as_deref() == Some(k);
                    if ui.selectable_label(on, k).clicked() {
                        self.kind_filter = if on { None } else { Some(k.into()) };
                    }
                }
            });

            let needle = self.filter.to_lowercase();
            let matching: Vec<Asset> = self
                .assets
                .iter()
                .filter(|a| self.kind_filter.as_deref().map_or(true, |k| a.kind == k))
                .filter(|a| needle.is_empty() || a.name.to_lowercase().contains(&needle))
                .take(400)
                .cloned()
                .collect();
            ui.label(format!("{} shown", matching.len()));
            ui.separator();

            egui::containers::ScrollArea::vertical().show(ui, |ui| {
                for a in &matching {
                    let dur = a.duration.map(|d| format!("  {d:.1}s")).unwrap_or_default();
                    if ui
                        .button(format!("{}{}", a.name, dur))
                        .on_hover_text(&a.path)
                        .clicked()
                    {
                        self.add_source_node(a);
                    }
                }
            });
        });

        /* ───────── shots + spec ───────── */
        egui::containers::Panel::right("right").default_size(400.0).show(ui, |ui| {
            ui.heading("shots");
            let mut open: Option<usize> = None;
            let mut remove: Option<usize> = None;
            for (i, s) in self.piece.shots.iter().enumerate() {
                ui.horizontal(|ui| {
                    let sel = self.shot_idx == Some(i);
                    if ui
                        .selectable_label(sel, format!("{:02}  {}  ({:.1}s)", i + 1, s.title, s.duration))
                        .clicked()
                    {
                        open = Some(i);
                    }
                    if ui.small_button("×").clicked() {
                        remove = Some(i);
                    }
                });
            }
            if let Some(i) = open {
                self.open_shot(i);
            }
            if let Some(i) = remove {
                self.commit_shot();
                self.piece.shots.remove(i);
                self.shot_idx = None;
            }
            if ui.button("+ shot").clicked() {
                self.commit_shot();
                let n = self.piece.shots.len() + 1;
                self.piece.shots.push(Shot {
                    id: format!("shot_{n:02}"),
                    title: "untitled".into(),
                    duration: 4.0,
                    // None means "inherit the piece's", which is a cut unless the
                    // piece says otherwise. A new shot never invents a transition.
                    transition: None,
                    source_ids: vec![],
                    nodes: None,
                });
                self.shot_idx = None;
                self.open_shot(n - 1);
            }

            if let Some(i) = self.shot_idx {
                if let Some(s) = self.piece.shots.get_mut(i) {
                    ui.separator();
                    ui.horizontal(|ui| {
                        ui.label("title");
                        ui.add(egui::TextEdit::singleline(&mut s.title).desired_width(180.0));
                    });
                    ui.horizontal(|ui| {
                        ui.label("seconds");
                        ui.add(egui::DragValue::new(&mut s.duration).range(0.1..=600.0).speed(0.1));
                    });
                    // Shot 01 has nothing to come from, so it gets no picker at all
                    // rather than a disabled one that invites the question.
                    if i > 0 {
                        ui.horizontal(|ui| {
                            ui.label("enters by");
                            let (mut name, mut secs) = split_transition(s.transition.as_deref());
                            let inherited = s.transition.is_none();
                            let shown = if inherited { "(piece)".to_string() } else { name.clone() };
                            let mut changed = false;
                            egui::ComboBox::from_id_salt(("trans", i))
                                .selected_text(shown)
                                .show_ui(ui, |ui| {
                                    if ui.selectable_label(inherited, "(piece)")
                                        .on_hover_text("inherit the piece's default")
                                        .clicked()
                                    {
                                        s.transition = None;
                                    }
                                    for t in TRANSITIONS {
                                        if ui.selectable_label(!inherited && name == t, t)
                                            .on_hover_text(transition_why(t))
                                            .clicked()
                                        {
                                            name = t.to_string();
                                            changed = true;
                                        }
                                    }
                                });
                            if !inherited && name != "cut" {
                                if ui
                                    .add(egui::DragValue::new(&mut secs).range(0.05..=3.0).speed(0.05).suffix("s"))
                                    .changed()
                                {
                                    changed = true;
                                }
                            }
                            if changed {
                                s.transition = Some(if name == "cut" {
                                    "cut".to_string()
                                } else {
                                    format!("{name} {secs:.2}")
                                });
                            }
                        });
                    }
                    // An untitled shot reaches the spec as "untitled" and stays that way
                    // in the finished file. Say it here, where it is still cheap to fix.
                    if s.title.trim().is_empty() || s.title == "untitled" {
                        ui.colored_label(egui::Color32::from_rgb(0xb0, 0x7d, 0x2a), "this shot has no title");
                    }
                }
            }

            ui.separator();
            let terms = terminal_count(&self.snarl);
            if self.shot_idx.is_some() && terms != 1 {
                ui.colored_label(
                    egui::Color32::from_rgb(0xc0, 0x39, 0x2b),
                    format!("{terms} terminals — a shot resolves to exactly one (§4)"),
                );
            }

            ui.separator();
            ui.heading(if self.rendering || !self.log.is_empty() { "render" } else { "spec" });
            egui::containers::ScrollArea::vertical().id_salt("out").show(ui, |ui| {
                if self.log.is_empty() {
                    ui.add(
                        egui::TextEdit::multiline(&mut self.spec.as_str())
                            .code_editor()
                            .desired_width(f32::INFINITY),
                    );
                } else {
                    for line in &self.log {
                        ui.monospace(line);
                    }
                }
            });
        });

        /* ───────── the ink well (§11) ───────── */
        egui::containers::CentralPanel::default().show(ui, |ui| {
            if self.shot_idx.is_none() {
                ui.centered_and_justified(|ui| {
                    ui.label("open a shot, or add one");
                });
                return;
            }
            let mut viewer = PlViewer { by_id: &self.by_id, last_refusal: self.refusal.take() };
            SnarlWidget::new()
                .id(egui::Id::new("pl-canvas"))
                .show(&mut self.snarl, &mut viewer, ui);
            self.refusal = viewer.last_refusal;
        });
    }
}
