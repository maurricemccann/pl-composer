//! Spec emission — the deliverable (spec §9). Ported from `lib/emit.ts`.
//!
//! The markdown IS the product. The app composes; this writes the instruction; the CLI
//! (`OpenMontage/projects/pl-curves/compose_render.py`) reads it and renders. Nothing
//! here computes pixels, and nothing here reaches for ffmpeg.
//!
//! **Byte-parity with the TypeScript emitter is the whole contract of this module.**
//! `lib/emit.ts` has already been proven end to end against a real CLI render, so this
//! port is only trustworthy if it produces the identical artifact. That is what
//! `src/bin/emit_spec.rs` and the tests at the bottom of this file check — not that the
//! output looks plausible, that it matches the file the proven emitter writes.
//!
//! The subtle part is number formatting, because the reference is JavaScript:
//!   - `String(1.0)` is `"1"`, not `"1.0"`. Rust's `f64` Display agrees.
//!   - arrays run through `toFixed(2)`, so `[0.0, 1.0]` emits `[0.00, 1.00]`.
//! Those two rules are the difference between a spec the renderer accepts and a diff.

use crate::types::{Asset, GraphNode, Piece, Shot};
use serde_json::{Map, Value};
use std::collections::HashMap;

/* ─────────────────────────── JS-compatible scalars ─────────────────────────── */

/// `String(v)` as JavaScript would render it. Numbers are the only interesting case:
/// JS prints the shortest round-tripping form, which is exactly Rust's `f64` Display,
/// so `1.0` becomes `1` on both sides and `0.3` stays `0.3`.
fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(u) = n.as_u64() {
                u.to_string()
            } else {
                n.as_f64().map(|f| format!("{}", f)).unwrap_or_default()
            }
        }
        other => other.to_string(),
    }
}

fn js_fixed(v: &Value, places: usize) -> String {
    match v.as_f64() {
        Some(f) => format!("{:.*}", places, f),
        None => js_string(v),
    }
}

/// `val()` from emit.ts. Arrays fix numbers to 2 places; objects render inline with the
/// `{ k: v }` spacing the renderer's parser expects; everything else is `String(v)`.
pub fn val(v: &Value) -> String {
    match v {
        Value::Array(items) => {
            let inner: Vec<String> = items
                .iter()
                .map(|x| if x.is_number() { js_fixed(x, 2) } else { js_string(x) })
                .collect();
            format!("[{}]", inner.join(", "))
        }
        Value::Object(map) => {
            let inner: Vec<String> = map.iter().map(|(k, x)| format!("{}: {}", k, val(x))).collect();
            format!("{{ {} }}", inner.join(", "))
        }
        other => js_string(other),
    }
}

/* ─────────────────────────── default wiring ─────────────────────────── */

fn s(v: &str) -> Value {
    Value::String(v.to_string())
}

fn num(f: f64) -> Value {
    Value::Number(serde_json::Number::from_f64(f).expect("finite"))
}

fn map(pairs: Vec<(&str, Value)>) -> Map<String, Value> {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    m
}

/// Derive a real graph from what is attached to a shot.
///
/// The rules are the ones S262 actually proved on this machine, not invented here:
///
///  - The FIRST media asset is the base. Everything after it is an overlay.
///  - Overlays blend `screen`. That session's load-bearing finding was that the curve
///    library is glowing linework on black, and screen drops black to nothing — so a
///    large class of composites needs no matting at all.
///  - A model is rendered to media FIRST, then treated as any other layer. The render
///    stage is never implicit.
///  - Audio drives. If a track is attached, its low-band envelope is extracted and
///    remapped to overlay opacity.
pub fn derive_graph(shot: &Shot, by_id: &HashMap<String, Asset>) -> Vec<GraphNode> {
    let assets: Vec<&Asset> = shot.source_ids.iter().filter_map(|id| by_id.get(id)).collect();
    let mut nodes: Vec<GraphNode> = Vec::new();

    let models: Vec<&Asset> = assets.iter().copied().filter(|a| a.kind == "model").collect();
    let audio: Vec<&Asset> = assets.iter().copied().filter(|a| a.kind == "audio").collect();
    // A rendered model becomes a media layer, ordered after the real media so a
    // reconstruction sits over its own source footage rather than under it.
    let mut media: Vec<&Asset> = assets
        .iter()
        .copied()
        .filter(|a| a.kind == "media" || a.kind == "curve")
        .collect();
    media.extend(models.iter().copied());

    for m in &models {
        nodes.push(GraphNode {
            op: "blender_render".into(),
            out: Some(format!("m_{}", m.id)),
            args: map(vec![
                ("source", s(&m.id)),
                ("fps", s("@piece.fps")),
                ("resolution", s("@piece.resolution")),
            ]),
        });
    }

    let mut bind: Option<Value> = None;
    if let Some(a) = audio.first() {
        nodes.push(GraphNode {
            op: "envelope_extract".into(),
            out: Some("v_energy".into()),
            args: map(vec![
                ("source", s(&a.id)),
                ("band", s("low")),
                ("smooth", num(0.3)),
                ("gain", num(1.0)),
            ]),
        });
        nodes.push(GraphNode {
            op: "remap".into(),
            out: Some("v_opacity".into()),
            args: map(vec![
                ("source", s("v_energy")),
                ("in", Value::Array(vec![num(0.0), num(1.0)])),
                ("out", Value::Array(vec![num(0.35), num(1.0)])),
                ("ease", s("linear")),
            ]),
        });
        bind = Some(Value::Object(map(vec![("opacity", s("v_opacity"))])));
    }

    let asset_ref = |a: &Asset| -> String {
        if a.kind == "model" {
            format!("m_{}", a.id)
        } else {
            a.id.clone()
        }
    };

    if let Some(base) = media.first() {
        let base_ref = asset_ref(base);
        for ov in media.iter().skip(1) {
            let mut args = map(vec![
                ("base", s(&base_ref)),
                ("overlay", s(&asset_ref(ov))),
                ("blend", s("screen")),
                ("opacity", num(1.0)),
            ]);
            if let Some(b) = &bind {
                args.insert("bind".into(), b.clone());
            }
            nodes.push(GraphNode { op: "layer".into(), out: None, args });
        }
        if media.len() == 1 {
            // A single source is still a layer — one base, no overlay. Emitting it keeps
            // every shot the same shape for the CLI instead of a special case.
            let mut args = map(vec![
                ("base", s(&base_ref)),
                ("blend", s("normal")),
                ("opacity", num(1.0)),
            ]);
            if let Some(b) = &bind {
                args.insert("bind".into(), b.clone());
            }
            nodes.push(GraphNode { op: "layer".into(), out: None, args });
        }
    }

    nodes
}

/* ─────────────────────────── serialisation ─────────────────────────── */

fn node_lines(n: &GraphNode, by_id: &HashMap<String, Asset>) -> Vec<String> {
    // `   # <name>` — three spaces, matching the TS `name()` helper exactly.
    let name = |id: Option<&Value>| -> String {
        match id {
            Some(v) => match by_id.get(&js_string(v)) {
                Some(a) => format!("   # {}", a.name),
                None => String::new(),
            },
            None => String::new(),
        }
    };
    let out_ref = n.out.clone().unwrap_or_default();
    let arg = |k: &str| n.args.get(k);
    let argv = |k: &str| arg(k).map(val).unwrap_or_else(|| "undefined".to_string());

    match n.op.as_str() {
        "envelope_extract" => {
            let src = arg("source");
            let mut out = vec![format!(
                "  - envelope_extract: {} -> {}{}",
                src.map(js_string).unwrap_or_else(|| "undefined".into()),
                out_ref,
                name(src)
            )];
            for k in ["band", "smooth", "gain"] {
                out.push(format!("      {}: {}", k, argv(k)));
            }
            out
        }
        "remap" => vec![
            format!(
                "  - remap: {} -> {}",
                arg("source").map(js_string).unwrap_or_else(|| "undefined".into()),
                out_ref
            ),
            format!("      in: {}", argv("in")),
            format!("      out: {}", argv("out")),
            format!("      ease: {}", argv("ease")),
        ],
        "constant" => vec![
            format!("  - constant: -> {}", out_ref),
            format!("      value: {}", argv("value")),
        ],
        "blender_render" => {
            let src = arg("source");
            vec![
                format!(
                    "  - blender_render: {} -> {}{}",
                    src.map(js_string).unwrap_or_else(|| "undefined".into()),
                    out_ref,
                    name(src)
                ),
                format!("      fps: {}", argv("fps")),
                format!("      resolution: {}", argv("resolution")),
            ]
        }
        "matte" => {
            // Not a blend: the base is seen only INSIDE the shape's marks. No blend mode
            // can express that, which is why it is its own op rather than a layer variant.
            let mut out = vec!["  - matte:".to_string()];
            let base = arg("base");
            let shape = arg("shape");
            out.push(format!(
                "      base: {}{}",
                base.map(js_string).unwrap_or_else(|| "undefined".into()),
                name(base)
            ));
            out.push(format!(
                "      shape: {}{}",
                shape.map(js_string).unwrap_or_else(|| "undefined".into()),
                name(shape)
            ));
            for k in ["invert", "threshold", "feather", "ground"] {
                if let Some(v) = arg(k) {
                    if !v.is_null() && v.as_str() != Some("") {
                        out.push(format!("      {}: {}", k, val(v)));
                    }
                }
            }
            out
        }
        // layer
        _ => {
            let mut out = vec!["  - layer:".to_string()];
            let base = arg("base");
            out.push(format!(
                "      base: {}{}",
                base.map(js_string).unwrap_or_else(|| "undefined".into()),
                name(base)
            ));
            if let Some(ov) = arg("overlay") {
                out.push(format!("      overlay: {}{}", js_string(ov), name(Some(ov))));
            }
            if let Some(b) = arg("bind") {
                out.push(format!("      bind: {}", val(b)));
            }
            out.push(format!("      blend: {}", argv("blend")));
            out.push(format!("      opacity: {}", argv("opacity")));
            out
        }
    }
}

/// The whole spec. Shot order in the file is shot order in the piece — that ordering is
/// the contract, not a convenience, so nothing here sorts.
///
/// `stamp` is the `created:` line. It is passed in rather than read from the clock so a
/// parity diff against the TypeScript emitter compares the artifact and not the minute
/// it ran in.
pub fn emit_spec(piece: &Piece, assets: &[Asset], stamp: &str) -> String {
    let by_id: HashMap<String, Asset> =
        assets.iter().map(|a| (a.id.clone(), a.clone())).collect();
    let total: f64 = piece.shots.iter().map(|s| s.duration).sum();

    let mut out: Vec<String> = vec![
        "---".into(),
        "spec_version: 1".into(),
        format!("piece: {}", piece.piece),
        format!("created: {}", stamp),
        format!("target: {}", piece.target),
        format!("fps: {}", piece.fps),
        format!("resolution: {}", piece.resolution),
        format!("duration: {:.1}", total),
        "---".into(),
        String::new(),
    ];

    for (i, shot) in piece.shots.iter().enumerate() {
        out.push(format!("## Shot {:02} — {}", i + 1, shot.title));
        out.push(format!("duration: {:.1}", shot.duration));

        let resolved: Vec<&Asset> = shot.source_ids.iter().filter_map(|id| by_id.get(id)).collect();
        if resolved.is_empty() {
            // Say it out loud in the artifact. A shot with no sources renders as black,
            // and the spec is the only place that fact can be noticed before the render.
            out.push("sources: []   # no sources attached — this shot renders black".into());
        } else {
            out.push("sources:".into());
            for a in &resolved {
                out.push(format!("  - {}: {}   # {}{}", a.kind, a.id, a.name, a.ext));
            }
        }

        let derived;
        let graph: &[GraphNode] = match &shot.nodes {
            Some(n) if !n.is_empty() => n,
            _ => {
                derived = derive_graph(shot, &by_id);
                &derived
            }
        };
        if !graph.is_empty() {
            out.push("graph:".into());
            for node in graph {
                out.extend(node_lines(node, &by_id));
            }
        }

        out.push(format!("-> {}", shot.id));
        out.push(String::new());
    }

    out.join("\n")
}

/// The house stamp format: `2026-09-11 03:42 PT`.
pub fn stamp_now() -> String {
    // Deliberately not a chrono dependency — one format string, local time, no crate.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    civil_stamp(secs as i64)
}

/// Days-from-epoch → civil date (Howard Hinnant's algorithm). UTC; the house writes PT
/// as a label on its own stamps and the renderer never parses this field.
fn civil_stamp(epoch_secs: i64) -> String {
    let days = epoch_secs.div_euclid(86_400);
    let rem = epoch_secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02} PT",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_number_formatting_matches_javascript() {
        // The two rules that decide whether the renderer accepts the spec.
        assert_eq!(js_string(&num(1.0)), "1", "String(1.0) is \"1\" in JS, not \"1.0\"");
        assert_eq!(js_string(&num(0.3)), "0.3");
        assert_eq!(js_string(&num(30.0)), "30");
        assert_eq!(
            val(&Value::Array(vec![num(0.0), num(1.0)])),
            "[0.00, 1.00]",
            "arrays run through toFixed(2)"
        );
        assert_eq!(val(&Value::Array(vec![num(0.35), num(1.0)])), "[0.35, 1.00]");
        assert_eq!(
            val(&Value::Object(map(vec![("opacity", s("v_opacity"))]))),
            "{ opacity: v_opacity }"
        );
    }

    fn asset(id: &str, kind: &str, name: &str, ext: &str) -> Asset {
        Asset {
            id: id.into(),
            kind: kind.into(),
            name: name.into(),
            catalog: String::new(),
            path: String::new(),
            ext: ext.into(),
            bytes: 0,
            mtime: 0.0,
            width: None,
            height: None,
            duration: None,
            tags: vec![],
            thumb_url: None,
        }
    }

    #[test]
    fn audio_plus_two_media_derives_the_proven_wiring() {
        let assets = vec![
            asset("aa", "media", "base", ".mp4"),
            asset("bb", "curve", "over", ".svg"),
            asset("cc", "audio", "bed", ".wav"),
        ];
        let by_id: HashMap<String, Asset> =
            assets.iter().map(|a| (a.id.clone(), a.clone())).collect();
        let shot = Shot {
            id: "shot_01".into(),
            title: "t".into(),
            duration: 4.0,
            source_ids: vec!["aa".into(), "bb".into(), "cc".into()],
            nodes: None,
        };
        let g = derive_graph(&shot, &by_id);
        let ops: Vec<&str> = g.iter().map(|n| n.op.as_str()).collect();
        assert_eq!(ops, vec!["envelope_extract", "remap", "layer"]);
        // The overlay is bound to the audio-derived opacity — "audio drives the motion".
        let layer = g.last().unwrap();
        assert_eq!(layer.arg("base").unwrap(), &s("aa"));
        assert_eq!(layer.arg("overlay").unwrap(), &s("bb"));
        assert_eq!(layer.arg("blend").unwrap(), &s("screen"));
        assert!(layer.arg("bind").is_some(), "audio present means a bind");
    }

    #[test]
    fn a_model_renders_before_it_layers() {
        let assets = vec![asset("mm", "model", "mark", ".blend")];
        let by_id: HashMap<String, Asset> =
            assets.iter().map(|a| (a.id.clone(), a.clone())).collect();
        let shot = Shot {
            id: "s".into(),
            title: "t".into(),
            duration: 4.0,
            source_ids: vec!["mm".into()],
            nodes: None,
        };
        let g = derive_graph(&shot, &by_id);
        assert_eq!(g[0].op, "blender_render");
        assert_eq!(g[0].out.as_deref(), Some("m_mm"));
        // A single source is still a layer, and it references the RENDER, not the model.
        assert_eq!(g[1].op, "layer");
        assert_eq!(g[1].arg("base").unwrap(), &s("m_mm"));
        assert_eq!(g[1].arg("blend").unwrap(), &s("normal"));
    }

    #[test]
    fn a_shot_with_no_sources_says_so_in_the_artifact() {
        let piece = Piece {
            piece: "p".into(),
            target: "t".into(),
            fps: 30.0,
            resolution: "1080x1920".into(),
            shots: vec![Shot {
                id: "shot_01".into(),
                title: "empty".into(),
                duration: 4.0,
                source_ids: vec![],
                nodes: None,
            }],
        };
        let md = emit_spec(&piece, &[], "2026-01-01 00:00 PT");
        assert!(md.contains("sources: []   # no sources attached — this shot renders black"));
        assert!(md.contains("duration: 4.0"));
    }
}
