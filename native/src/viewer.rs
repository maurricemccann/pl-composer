//! The node canvas — spec §4, §11.
//!
//! `egui_snarl` owns interaction (drag, wire, pan, zoom); everything about what a wire
//! is *allowed* to be comes from `graph.rs`, which is the ported, tested rule set. The
//! viewer never re-decides a rule — `connect()` asks `can_connect()` and obeys the
//! answer. That is the whole reason the graph layer was built and proven before any UI
//! existed: there is exactly one place the type system lives.
//!
//! §11 said the canvas is where boldness gets spent. Typed pins carry their socket's
//! colour, so a dense graph reads at a glance instead of being decoded.

use crate::bridge::{canvas_of, port_name};
use crate::graph::{can_connect, default_args, kind_spec, next_out, output_type, GNodeData, NodeKind, ParamType, ADDABLE_KINDS};
use crate::types::{Asset, SocketType};
use egui::{Color32, Pos2, Ui};
use egui_snarl::{
    ui::{AnyPins, PinInfo, SnarlViewer},
    InPin, InPinId, NodeId, OutPin, OutPinId, Snarl,
};
use serde_json::Value;
use std::collections::HashMap;

pub struct PlViewer<'a> {
    pub by_id: &'a HashMap<String, Asset>,
    /// Last refusal, surfaced in the status bar. A refused wire that says nothing is
    /// indistinguishable from a bug in the mouse.
    pub last_refusal: Option<String>,
}

fn col(rgb: [u8; 3]) -> Color32 {
    Color32::from_rgb(rgb[0], rgb[1], rgb[2])
}

impl PlViewer<'_> {
    fn asset_of(&self, data: &crate::graph::GNodeData) -> Option<&Asset> {
        data.asset_id.as_ref().and_then(|id| self.by_id.get(id))
    }
}

impl SnarlViewer<crate::graph::GNodeData> for PlViewer<'_> {
    fn title(&mut self, node: &crate::graph::GNodeData) -> String {
        if node.kind == NodeKind::Source {
            return match self.asset_of(node) {
                Some(a) => a.name.clone(),
                // Naming the failure beats a node that silently says "Source" while
                // pointing at a row the manifest no longer carries.
                None => format!("missing: {}", node.asset_id.clone().unwrap_or_default()),
            };
        }
        let label = kind_spec(node.kind).label.to_string();
        match &node.out {
            Some(o) => format!("{label}  ·  {o}"),
            None => label,
        }
    }

    fn inputs(&mut self, node: &crate::graph::GNodeData) -> usize {
        kind_spec(node.kind).inputs.len()
    }

    fn outputs(&mut self, node: &crate::graph::GNodeData) -> usize {
        if node.kind == NodeKind::Shot {
            0
        } else {
            1
        }
    }

    /// A dense graph reads at a glance in the founder's own reference screenshots
    /// (Blender's geometry nodes, Whimsy) because the HEADER, not just the pin, carries
    /// colour. Reusing the socket palette rather than inventing a second one: the header
    /// previews what the node produces — a Shot terminal produces nothing (`output_type`
    /// is `None`), but it IS what `SocketType::Shot` names, so it gets that red.
    fn header_frame(
        &mut self,
        default: egui::Frame,
        node: NodeId,
        _inputs: &[InPin],
        _outputs: &[OutPin],
        snarl: &Snarl<GNodeData>,
    ) -> egui::Frame {
        let data = &snarl[node];
        let t = if data.kind == NodeKind::Shot {
            SocketType::Shot
        } else {
            match output_type(data, self.by_id) {
                Some(t) => t,
                None => return default,
            }
        };
        let [r, g, b] = t.rgb();
        default.fill(Color32::from_rgba_unmultiplied(r, g, b, 46))
    }

    fn show_input(
        &mut self,
        pin: &InPin,
        ui: &mut Ui,
        snarl: &mut Snarl<crate::graph::GNodeData>,
    ) -> impl egui_snarl::ui::SnarlPin + 'static {
        let data = &snarl[pin.id.node];
        let spec = kind_spec(data.kind);
        let p = &spec.inputs[pin.id.input];
        ui.label(p.label);
        // A port wears the colour of what it accepts. Where a port takes two types
        // (Media or Curve) the first is the one it is really for.
        PinInfo::circle().with_fill(col(p.accepts[0].rgb()))
    }

    fn show_output(
        &mut self,
        pin: &OutPin,
        ui: &mut Ui,
        snarl: &mut Snarl<crate::graph::GNodeData>,
    ) -> impl egui_snarl::ui::SnarlPin + 'static {
        let data = &snarl[pin.id.node];
        match output_type(data, self.by_id) {
            Some(t) => {
                ui.label(t.label());
                PinInfo::circle().with_fill(col(t.rgb()))
            }
            None => {
                ui.label("—");
                PinInfo::circle().with_fill(Color32::from_gray(90))
            }
        }
    }

    /// The one rule the UI enforces, and it does not own it. `can_connect` is the ported,
    /// tested predicate; this asks and obeys.
    fn connect(&mut self, from: &OutPin, to: &InPin, snarl: &mut Snarl<crate::graph::GNodeData>) {
        let (nodes, edges, ids) = canvas_of(snarl);
        let (Some(src), Some(tgt)) = (ids.get(&from.id.node), ids.get(&to.id.node)) else {
            return;
        };
        let Some(port) = port_name(snarl, to.id.node, to.id.input) else { return };

        match can_connect(src, tgt, &port, &nodes, &edges, self.by_id) {
            Ok(()) => {
                self.last_refusal = None;
                snarl.connect(from.id, to.id);
            }
            Err(why) => {
                // "already has a connection" is the one refusal that is really a replace:
                // the founder is re-aiming an occupied port, not making a mistake.
                if why.contains("already has a connection") {
                    snarl.drop_inputs(to.id);
                    self.last_refusal = None;
                    snarl.connect(from.id, to.id);
                } else {
                    self.last_refusal = Some(why);
                }
            }
        }
    }

    fn has_body(&mut self, node: &crate::graph::GNodeData) -> bool {
        !kind_spec(node.kind).params.is_empty()
    }

    /// Parameters live on the node, not in a side panel. On a graph this small, walking
    /// to an N-panel to change one number is the friction; the number belongs on the card.
    fn show_body(
        &mut self,
        node: NodeId,
        _inputs: &[InPin],
        _outputs: &[OutPin],
        ui: &mut Ui,
        snarl: &mut Snarl<crate::graph::GNodeData>,
    ) {
        let kind = snarl[node].kind;
        let params = kind_spec(kind).params;
        let args = &mut snarl[node].args;

        for p in &params {
            ui.horizontal(|ui| {
                ui.label(p.label);
                match &p.ty {
                    ParamType::Number { min, max, step } => {
                        let mut v = args.get(p.key).and_then(Value::as_f64).unwrap_or(0.0);
                        if ui
                            .add(egui::DragValue::new(&mut v).range(*min..=*max).speed(*step))
                            .changed()
                        {
                            if let Some(n) = serde_json::Number::from_f64(v) {
                                args.insert(p.key.to_string(), Value::Number(n));
                            }
                        }
                    }
                    ParamType::Select(options) => {
                        let cur = args
                            .get(p.key)
                            .and_then(Value::as_str)
                            .unwrap_or(options[0])
                            .to_string();
                        egui::ComboBox::from_id_salt((node, p.key))
                            .selected_text(&cur)
                            .show_ui(ui, |ui| {
                                for o in options.iter() {
                                    if ui.selectable_label(cur == *o, *o).clicked() {
                                        args.insert(p.key.to_string(), Value::String((*o).into()));
                                    }
                                }
                            });
                    }
                    ParamType::Range => {
                        // A Value range is two numbers. Editing them as one widget pair
                        // keeps the emitted `[0.35, 1.00]` shape impossible to break.
                        let arr = args.get(p.key).and_then(Value::as_array).cloned();
                        let mut lo = arr
                            .as_ref()
                            .and_then(|a| a.first())
                            .and_then(Value::as_f64)
                            .unwrap_or(0.0);
                        let mut hi = arr
                            .as_ref()
                            .and_then(|a| a.get(1))
                            .and_then(Value::as_f64)
                            .unwrap_or(1.0);
                        let a = ui.add(egui::DragValue::new(&mut lo).speed(0.01));
                        let b = ui.add(egui::DragValue::new(&mut hi).speed(0.01));
                        if a.changed() || b.changed() {
                            if let (Some(l), Some(h)) = (
                                serde_json::Number::from_f64(lo),
                                serde_json::Number::from_f64(hi),
                            ) {
                                args.insert(
                                    p.key.to_string(),
                                    Value::Array(vec![Value::Number(l), Value::Number(h)]),
                                );
                            }
                        }
                    }
                }
            });
        }
    }

    fn has_node_menu(&mut self, _node: &crate::graph::GNodeData) -> bool {
        true
    }

    fn show_node_menu(
        &mut self,
        node: NodeId,
        _inputs: &[InPin],
        _outputs: &[OutPin],
        ui: &mut Ui,
        snarl: &mut Snarl<crate::graph::GNodeData>,
    ) {
        ui.label(kind_spec(snarl[node].kind).why);
        ui.separator();
        // The terminal is structure, not a node the founder owns. Removing it would leave
        // a graph that emits nothing, with no way back except reopening the shot.
        if snarl[node].kind == NodeKind::Shot {
            ui.label("the terminal stays");
            return;
        }
        if ui.button("delete node").clicked() {
            snarl.remove_node(node);
            ui.close();
        }
    }

    fn has_graph_menu(&mut self, _pos: egui::Pos2, _snarl: &mut Snarl<crate::graph::GNodeData>) -> bool {
        true
    }

    fn show_graph_menu(
        &mut self,
        pos: egui::Pos2,
        ui: &mut Ui,
        snarl: &mut Snarl<crate::graph::GNodeData>,
    ) {
        ui.label("add");
        for k in ADDABLE_KINDS {
            let spec = kind_spec(k);
            if ui.button(spec.label).on_hover_text(spec.why).clicked() {
                let existing: Vec<crate::graph::GNode> = canvas_of(snarl).0;
                let out = next_out(k, &existing, None);
                snarl.insert_node(
                    pos,
                    crate::graph::GNodeData {
                        kind: k,
                        asset_id: None,
                        out,
                        args: default_args(k),
                    },
                );
                ui.close();
            }
        }
    }

    /// Blender's habit: drag a wire into empty space and get a menu of nodes that fit
    /// the wire you were already holding, wired in on selection (§ RESEARCH — Blender
    /// Node Editor for PL Composer, P0).
    fn has_dropped_wire_menu(&mut self, _src_pins: AnyPins, _snarl: &mut Snarl<crate::graph::GNodeData>) -> bool {
        true
    }

    fn show_dropped_wire_menu(
        &mut self,
        pos: Pos2,
        ui: &mut Ui,
        src_pins: AnyPins,
        snarl: &mut Snarl<crate::graph::GNodeData>,
    ) {
        ui.label("add");
        match src_pins {
            AnyPins::Out(pins) => {
                let Some(src) = pins.first().copied() else { return };
                let Some(src_type) = output_type(&snarl[src.node], self.by_id) else { return };
                for k in ADDABLE_KINDS {
                    let spec = kind_spec(k);
                    let Some(input_idx) = spec.inputs.iter().position(|p| p.accepts.contains(&src_type)) else {
                        continue;
                    };
                    if ui.button(spec.label).on_hover_text(spec.why).clicked() {
                        let existing: Vec<crate::graph::GNode> = canvas_of(snarl).0;
                        let out = next_out(k, &existing, None);
                        let new_node = snarl.insert_node(
                            pos,
                            crate::graph::GNodeData { kind: k, asset_id: None, out, args: default_args(k) },
                        );
                        snarl.connect(src, InPinId { node: new_node, input: input_idx });
                        ui.close();
                        return;
                    }
                }
            }
            AnyPins::In(pins) => {
                let Some(dst) = pins.first().copied() else { return };
                let accepts = &kind_spec(snarl[dst.node].kind).inputs[dst.input].accepts;
                for k in ADDABLE_KINDS {
                    let Some(out_type) = kind_spec(k).output else { continue };
                    if !accepts.contains(&out_type) {
                        continue;
                    }
                    let spec = kind_spec(k);
                    if ui.button(spec.label).on_hover_text(spec.why).clicked() {
                        let existing: Vec<crate::graph::GNode> = canvas_of(snarl).0;
                        let out = next_out(k, &existing, None);
                        let new_node = snarl.insert_node(
                            pos,
                            crate::graph::GNodeData { kind: k, asset_id: None, out, args: default_args(k) },
                        );
                        snarl.connect(OutPinId { node: new_node, output: 0 }, dst);
                        ui.close();
                        return;
                    }
                }
            }
        }
    }
}
