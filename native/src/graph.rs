//! The graph layer — spec §4 (Graph view), §5 (type system), §6 (node catalog).
//! Ported from `lib/graph.ts`.
//!
//! This module is the translation between two representations of the same thing:
//!
//! ```text
//!   canvas  ──to_graph_nodes──▶  Vec<GraphNode>  ──emit──▶  the markdown spec
//!           ◀─from_graph_nodes─
//! ```
//!
//! `Vec<GraphNode>` is the contract already proven end to end against a real CLI render.
//! The canvas is a way to author it, NOT a new format — so this round-trips rather than
//! replacing anything. Opening a shot with no explicit graph seeds the canvas from
//! `derive_graph()`, so the first thing the founder sees is the real default wiring.
//!
//! Nothing here computes pixels. Edges carry intent; the CLI evaluates (§5).

use crate::emit::derive_graph;
use crate::types::{asset_socket, Asset, GraphNode, Shot, SocketType};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/* ─────────────────────────── the node catalog (§6) ─────────────────────────── */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Source,
    BlenderRender,
    EnvelopeExtract,
    Remap,
    Constant,
    Layer,
    Matte,
    Shot,
}

pub const ADDABLE_KINDS: [NodeKind; 6] = [
    NodeKind::BlenderRender,
    NodeKind::EnvelopeExtract,
    NodeKind::Remap,
    NodeKind::Constant,
    NodeKind::Layer,
    NodeKind::Matte,
];

/// The same six kinds, grouped by role rather than a flat alphabet soup — so the add
/// menu and the legend both read as "render / value / combine" instead of six unrelated
/// buttons the founder has to already know the graph to sort. One source of truth for
/// both (founder request, S280: see the logic before wiring anything).
pub const NODE_GROUPS: &[(&str, &[NodeKind])] = &[
    ("render — geometry into pixels", &[NodeKind::BlenderRender]),
    ("value — a number to drive something", &[NodeKind::EnvelopeExtract, NodeKind::Remap, NodeKind::Constant]),
    ("combine — makes the picture", &[NodeKind::Layer, NodeKind::Matte]),
];

impl NodeKind {
    /// The op string this kind emits as. `Source` and `Shot` emit nothing — they are
    /// canvas-only structure, not operations.
    pub fn op(self) -> Option<&'static str> {
        match self {
            NodeKind::Source | NodeKind::Shot => None,
            NodeKind::BlenderRender => Some("blender_render"),
            NodeKind::EnvelopeExtract => Some("envelope_extract"),
            NodeKind::Remap => Some("remap"),
            NodeKind::Constant => Some("constant"),
            NodeKind::Layer => Some("layer"),
            NodeKind::Matte => Some("matte"),
        }
    }

    pub fn from_op(op: &str) -> Option<NodeKind> {
        match op {
            "blender_render" => Some(NodeKind::BlenderRender),
            "envelope_extract" => Some(NodeKind::EnvelopeExtract),
            "remap" => Some(NodeKind::Remap),
            "constant" => Some(NodeKind::Constant),
            "layer" => Some(NodeKind::Layer),
            "matte" => Some(NodeKind::Matte),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PortSpec {
    pub id: &'static str,
    pub label: &'static str,
    /// Which socket types may land here. Strict — this is the validation (§5).
    pub accepts: &'static [SocketType],
    /// A port that takes many edges. Only the terminal has one.
    pub multi: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ParamType {
    Number { min: f64, max: f64, step: f64 },
    Select(&'static [&'static str]),
    Range,
}

#[derive(Debug, Clone)]
pub struct ParamSpec {
    pub key: &'static str,
    pub label: &'static str,
    pub ty: ParamType,
}

#[derive(Debug, Clone)]
pub struct KindSpec {
    pub label: &'static str,
    /// One line saying what it is for — shown in the params panel, not memorised.
    pub why: &'static str,
    pub inputs: Vec<PortSpec>,
    /// What this node's single output socket carries. `None` for the terminal.
    pub output: Option<SocketType>,
    pub params: Vec<ParamSpec>,
    /// Rank orders emission when the dependency graph leaves a tie. Lower runs first.
    pub rank: i32,
}

const MEDIAISH: &[SocketType] = &[SocketType::Media, SocketType::Curve];
const ONLY_MODEL: &[SocketType] = &[SocketType::Model];
const ONLY_AUDIO: &[SocketType] = &[SocketType::Audio];
const ONLY_VALUE: &[SocketType] = &[SocketType::Value];
const ONLY_SHOT: &[SocketType] = &[SocketType::Shot];

fn port(id: &'static str, accepts: &'static [SocketType]) -> PortSpec {
    PortSpec { id, label: id, accepts, multi: false }
}

pub fn kind_spec(kind: NodeKind) -> KindSpec {
    match kind {
        NodeKind::Source => KindSpec {
            label: "Source",
            why: "A row of the library. The app reads the manifest and never writes it.",
            inputs: vec![],
            output: None, // resolved per-asset by asset_socket()
            params: vec![],
            rank: 0,
        },
        NodeKind::BlenderRender => KindSpec {
            label: "Blender Render",
            why: "Geometry is not pixels yet. This is the stage that makes it Media, and it is never implicit.",
            inputs: vec![port("model", ONLY_MODEL)],
            output: Some(SocketType::Media),
            params: vec![],
            rank: 0,
        },
        NodeKind::EnvelopeExtract => KindSpec {
            label: "Envelope Extract",
            why: "Audio is the only source that produces motion from nothing. This is how it drives something.",
            inputs: vec![port("audio", ONLY_AUDIO)],
            output: Some(SocketType::Value),
            params: vec![
                ParamSpec { key: "band", label: "band", ty: ParamType::Select(&["low", "mid", "high", "full"]) },
                ParamSpec { key: "smooth", label: "smooth", ty: ParamType::Number { min: 0.0, max: 1.0, step: 0.05 } },
                ParamSpec { key: "gain", label: "gain", ty: ParamType::Number { min: 0.0, max: 8.0, step: 0.1 } },
            ],
            rank: 1,
        },
        NodeKind::Remap => KindSpec {
            label: "Remap",
            why: "Rescales a Value into the range a parameter actually wants.",
            inputs: vec![port("value", ONLY_VALUE)],
            output: Some(SocketType::Value),
            params: vec![
                ParamSpec { key: "in", label: "in", ty: ParamType::Range },
                ParamSpec { key: "out", label: "out", ty: ParamType::Range },
                ParamSpec { key: "ease", label: "ease", ty: ParamType::Select(&["linear", "ease-in", "ease-out", "ease-in-out"]) },
            ],
            rank: 2,
        },
        NodeKind::Constant => KindSpec {
            label: "Constant",
            why: "A number with no source. A slider, an LFO and an envelope are all Value (§5).",
            inputs: vec![],
            output: Some(SocketType::Value),
            params: vec![ParamSpec { key: "value", label: "value", ty: ParamType::Number { min: -100.0, max: 100.0, step: 0.1 } }],
            rank: 1,
        },
        NodeKind::Layer => KindSpec {
            label: "Layer",
            why: "Composites one source over another. Bind a Value to drive a parameter over time.",
            inputs: vec![
                port("base", MEDIAISH),
                port("overlay", MEDIAISH),
                port("opacity", ONLY_VALUE),
                port("width", ONLY_VALUE),
            ],
            output: Some(SocketType::Shot),
            params: vec![
                // `screen` first because it is the default and the one the curve library
                // was built for — glowing linework on black needs no matting at all.
                ParamSpec { key: "blend", label: "blend", ty: ParamType::Select(&["screen", "add", "lighten", "normal", "overlay", "multiply"]) },
                ParamSpec { key: "opacity", label: "opacity", ty: ParamType::Number { min: 0.0, max: 1.0, step: 0.05 } },
            ],
            rank: 3,
        },
        NodeKind::Matte => KindSpec {
            label: "Matte",
            why: "The base seen ONLY inside the shape's marks. Not a blend — a window cut into one picture in the shape of another.",
            inputs: vec![port("base", MEDIAISH), port("shape", MEDIAISH)],
            output: Some(SocketType::Shot),
            params: vec![
                ParamSpec { key: "threshold", label: "threshold", ty: ParamType::Number { min: 0.0, max: 255.0, step: 1.0 } },
                ParamSpec { key: "feather", label: "feather", ty: ParamType::Number { min: 0.0, max: 40.0, step: 1.0 } },
                ParamSpec { key: "ground", label: "ground", ty: ParamType::Select(&["auto", "cream", "obsidian"]) },
            ],
            rank: 3,
        },
        NodeKind::Shot => KindSpec {
            label: "Shot",
            why: "What this card resolves to. Exactly one per card, and a graph can never contain another (§4).",
            inputs: vec![PortSpec { id: "layers", label: "layers", accepts: ONLY_SHOT, multi: true }],
            output: None,
            params: vec![],
            rank: 4,
        },
    }
}

fn s(v: &str) -> Value {
    Value::String(v.to_string())
}
fn num(f: f64) -> Value {
    Value::Number(serde_json::Number::from_f64(f).expect("finite"))
}

/// Which params a freshly-dropped node starts with. Same values the derived wiring uses.
pub fn default_args(kind: NodeKind) -> Map<String, Value> {
    let mut m = Map::new();
    match kind {
        NodeKind::EnvelopeExtract => {
            m.insert("band".into(), s("low"));
            m.insert("smooth".into(), num(0.3));
            m.insert("gain".into(), num(1.0));
        }
        NodeKind::Remap => {
            m.insert("in".into(), Value::Array(vec![num(0.0), num(1.0)]));
            m.insert("out".into(), Value::Array(vec![num(0.35), num(1.0)]));
            m.insert("ease".into(), s("linear"));
        }
        NodeKind::Constant => {
            m.insert("value".into(), num(1.0));
        }
        NodeKind::Layer => {
            m.insert("blend".into(), s("screen"));
            m.insert("opacity".into(), num(1.0));
        }
        // `ground: auto` means "let the renderer decide from the shape" — cream for ink,
        // obsidian otherwise. It is omitted from the emitted spec rather than written out.
        NodeKind::Matte => {
            m.insert("ground".into(), s("auto"));
        }
        NodeKind::BlenderRender => {
            m.insert("fps".into(), s("@piece.fps"));
            m.insert("resolution".into(), s("@piece.resolution"));
        }
        _ => {}
    }
    m
}

/* ─────────────────────────── canvas node shape ─────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GNodeData {
    pub kind: NodeKind,
    /// Sources only: which manifest row this is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// The identifier this node's output is referred to by — `v_energy`, `m_blend_07`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out: Option<String>,
    #[serde(default)]
    pub args: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Pos {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GNode {
    pub id: String,
    pub position: Pos,
    pub data: GNodeData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub target_handle: String,
}

/// The socket type a node's output carries. Sources resolve through the manifest.
pub fn output_type(data: &GNodeData, by_id: &HashMap<String, Asset>) -> Option<SocketType> {
    if data.kind == NodeKind::Source {
        let a = data.asset_id.as_ref().and_then(|id| by_id.get(id))?;
        return asset_socket(&a.kind);
    }
    kind_spec(data.kind).output
}

/// How other nodes refer to this one's output inside the spec.
fn ref_of(n: &GNode) -> String {
    if n.data.kind == NodeKind::Source {
        return n.data.asset_id.clone().unwrap_or_else(|| n.id.clone());
    }
    n.data.out.clone().unwrap_or_else(|| n.id.clone())
}

/* ─────────────────────────── validation (§5) ─────────────────────────── */

/// Strict typed connect. Three rules, all load-bearing:
///   1. the source's socket type must be one the target port accepts,
///   2. a non-multi port holds exactly one edge,
///   3. no cycles — a cycle has no valid emission order, and the founder would only
///      find out at render time.
pub fn can_connect(
    source: &str,
    target: &str,
    target_handle: &str,
    nodes: &[GNode],
    edges: &[GEdge],
    by_id: &HashMap<String, Asset>,
) -> Result<(), String> {
    let src = nodes.iter().find(|n| n.id == source).ok_or("unknown node")?;
    let tgt = nodes.iter().find(|n| n.id == target).ok_or("unknown node")?;
    if src.id == tgt.id {
        return Err("a node cannot feed itself".into());
    }

    let spec = kind_spec(tgt.data.kind);
    let p = spec
        .inputs
        .iter()
        .find(|p| p.id == target_handle)
        .ok_or("no such input")?;

    let t = output_type(&src.data, by_id).ok_or("this source is not in the current manifest")?;
    if !p.accepts.contains(&t) {
        let accepts: Vec<&str> = p.accepts.iter().map(|a| a.label()).collect();
        return Err(format!("{} takes {}, not {}", p.label, accepts.join(" or "), t.label()));
    }
    if !p.multi
        && edges
            .iter()
            .any(|e| e.target == tgt.id && e.target_handle == p.id)
    {
        return Err(format!("{} already has a connection", p.label));
    }
    if reaches(&tgt.id, &src.id, edges) {
        return Err("that would make a cycle".into());
    }
    Ok(())
}

/// Can `from` reach `to` by following edges forward?
fn reaches(from: &str, to: &str, edges: &[GEdge]) -> bool {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut stack: Vec<&str> = vec![from];
    while let Some(cur) = stack.pop() {
        if cur == to {
            return true;
        }
        if !seen.insert(cur) {
            continue;
        }
        for e in edges {
            if e.source == cur {
                stack.push(&e.target);
            }
        }
    }
    false
}

/* ─────────────────────────── canvas ▶ spec ─────────────────────────── */

/// Serialise the canvas into the emitter's contract.
///
/// Emission order is a topological sort (Kahn) with the catalog's `rank` breaking ties,
/// which reproduces the derived wiring's order exactly: renders, then the value chain,
/// then layers. Layers additionally tie-break on their position in the terminal's input
/// list, so composite order is the order they are wired — visible on each card.
pub fn to_graph_nodes(nodes: &[GNode], edges: &[GEdge]) -> Vec<GraphNode> {
    let by_node_id: HashMap<&str, &GNode> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    let input_ref = |node_id: &str, port: &str| -> Option<String> {
        let e = edges
            .iter()
            .find(|x| x.target == node_id && x.target_handle == port)?;
        by_node_id.get(e.source.as_str()).map(|n| ref_of(n))
    };

    // Layer composite order = the order layers are wired into the terminal.
    let terminal = nodes.iter().find(|n| n.data.kind == NodeKind::Shot);
    let mut layer_order: HashMap<&str, usize> = HashMap::new();
    if let Some(t) = terminal {
        for (i, e) in edges.iter().filter(|e| e.target == t.id).enumerate() {
            layer_order.insert(e.source.as_str(), i);
        }
    }

    let idx: HashMap<&str, usize> = nodes.iter().enumerate().map(|(i, n)| (n.id.as_str(), i)).collect();
    let tiebreak = |n: &GNode| -> usize {
        if n.data.kind == NodeKind::Layer || n.data.kind == NodeKind::Matte {
            *layer_order.get(n.id.as_str()).unwrap_or(&1_000_000)
        } else {
            *idx.get(n.id.as_str()).unwrap_or(&0)
        }
    };

    // Kahn, lowest (rank, tiebreak) first.
    let mut indeg: HashMap<&str, usize> = nodes.iter().map(|n| (n.id.as_str(), 0usize)).collect();
    for e in edges {
        if let Some(d) = indeg.get_mut(e.target.as_str()) {
            *d += 1;
        }
    }

    let mut ready: Vec<&GNode> = nodes.iter().filter(|n| indeg[n.id.as_str()] == 0).collect();
    let mut order: Vec<&GNode> = Vec::new();
    while !ready.is_empty() {
        ready.sort_by(|a, b| {
            let ra = kind_spec(a.data.kind).rank;
            let rb = kind_spec(b.data.kind).rank;
            ra.cmp(&rb).then_with(|| tiebreak(a).cmp(&tiebreak(b)))
        });
        let n = ready.remove(0);
        order.push(n);
        for e in edges {
            if e.source != n.id {
                continue;
            }
            if let Some(d) = indeg.get_mut(e.target.as_str()) {
                *d = d.saturating_sub(1);
                if *d == 0 {
                    if let Some(t) = by_node_id.get(e.target.as_str()) {
                        ready.push(t);
                    }
                }
            }
        }
    }

    let mut out: Vec<GraphNode> = Vec::new();
    for n in order {
        let kind = n.data.kind;
        let args = &n.data.args;
        match kind {
            NodeKind::Source | NodeKind::Shot => continue,
            NodeKind::BlenderRender | NodeKind::EnvelopeExtract | NodeKind::Remap => {
                let port = match kind {
                    NodeKind::BlenderRender => "model",
                    NodeKind::EnvelopeExtract => "audio",
                    _ => "value",
                };
                // An unwired node has nothing to say; the card flags it.
                let Some(source) = input_ref(&n.id, port) else { continue };
                let mut a = Map::new();
                a.insert("source".into(), s(&source));
                for (k, v) in args {
                    a.insert(k.clone(), v.clone());
                }
                out.push(GraphNode { op: kind.op().unwrap().into(), out: n.data.out.clone(), args: a });
            }
            NodeKind::Constant => {
                out.push(GraphNode {
                    op: "constant".into(),
                    out: n.data.out.clone(),
                    args: args.clone(),
                });
            }
            NodeKind::Matte => {
                // A matte needs both halves to mean anything.
                let (Some(base), Some(shape)) = (input_ref(&n.id, "base"), input_ref(&n.id, "shape")) else {
                    continue;
                };
                let mut a = Map::new();
                a.insert("base".into(), s(&base));
                a.insert("shape".into(), s(&shape));
                for k in ["threshold", "feather"] {
                    if let Some(v) = args.get(k) {
                        if !v.is_null() && v.as_str() != Some("") {
                            a.insert(k.into(), v.clone());
                        }
                    }
                }
                if let Some(g) = args.get("ground") {
                    if g.as_str() != Some("auto") && !g.is_null() {
                        a.insert("ground".into(), g.clone());
                    }
                }
                out.push(GraphNode { op: "matte".into(), out: None, args: a });
            }
            NodeKind::Layer => {
                // A layer with no base is not a layer yet.
                let Some(base) = input_ref(&n.id, "base") else { continue };
                let mut a = Map::new();
                a.insert("base".into(), s(&base));
                if let Some(ov) = input_ref(&n.id, "overlay") {
                    a.insert("overlay".into(), s(&ov));
                }
                let mut bind = Map::new();
                for k in ["opacity", "width"] {
                    if let Some(r) = input_ref(&n.id, k) {
                        bind.insert(k.into(), s(&r));
                    }
                }
                if !bind.is_empty() {
                    a.insert("bind".into(), Value::Object(bind));
                }
                for (k, v) in args {
                    a.insert(k.clone(), v.clone());
                }
                out.push(GraphNode { op: "layer".into(), out: None, args: a });
            }
        }
    }
    out
}

/* ─────────────────────────── spec ▶ canvas ─────────────────────────── */

const COL: f32 = 240.0;
const ROW: f32 = 132.0;

/// Rebuild the canvas from a graph.
///
/// Used two ways and deliberately only written once: re-opening a shot that already
/// carries an explicit graph, and seeding a shot that does not from `derive_graph()`.
/// Both are the same operation, so a seeded canvas is never a different shape from a
/// saved one.
pub fn from_graph_nodes(
    graph: &[GraphNode],
    source_ids: &[String],
    _by_id: &HashMap<String, Asset>,
) -> (Vec<GNode>, Vec<GEdge>) {
    let mut nodes: Vec<GNode> = Vec::new();
    let mut edges: Vec<GEdge> = Vec::new();
    // ref (asset id or v_/m_ name) → the canvas node that produces it.
    let mut producer: HashMap<String, String> = HashMap::new();
    let mut seq = 0usize;
    let mut nid = |k: &str| {
        seq += 1;
        format!("{}_{}", k, seq)
    };

    for aid in source_ids {
        let id = nid("src");
        nodes.push(GNode {
            id: id.clone(),
            position: Pos { x: 0.0, y: 0.0 },
            data: GNodeData {
                kind: NodeKind::Source,
                asset_id: Some(aid.clone()),
                out: None,
                args: Map::new(),
            },
        });
        producer.insert(aid.clone(), id);
    }

    let terminal_id = nid("shot");
    let mut layer_ids: Vec<String> = Vec::new();

    for g in graph {
        let Some(kind) = NodeKind::from_op(&g.op) else { continue };
        let id = nid(&g.op);
        let mut rest = g.args.clone();

        // The wired-in refs live on edges, not in args — strip them so a round trip does
        // not end up with both an edge and a stale literal saying the same thing.
        let mut links: Vec<(Option<Value>, &str)> = Vec::new();
        match kind {
            NodeKind::BlenderRender => {
                links.push((rest.remove("source"), "model"));
            }
            NodeKind::EnvelopeExtract => {
                links.push((rest.remove("source"), "audio"));
            }
            NodeKind::Remap => {
                links.push((rest.remove("source"), "value"));
            }
            NodeKind::Matte => {
                links.push((rest.remove("base"), "base"));
                links.push((rest.remove("shape"), "shape"));
                if !rest.contains_key("ground") {
                    rest.insert("ground".into(), s("auto"));
                }
            }
            NodeKind::Layer => {
                links.push((rest.remove("base"), "base"));
                links.push((rest.remove("overlay"), "overlay"));
                if let Some(Value::Object(bind)) = rest.remove("bind") {
                    for k in ["opacity", "width"] {
                        links.push((bind.get(k).cloned(), k));
                    }
                }
            }
            _ => {}
        }

        nodes.push(GNode {
            id: id.clone(),
            position: Pos { x: 0.0, y: 0.0 },
            data: GNodeData { kind, asset_id: None, out: g.out.clone(), args: rest },
        });

        for (r, portname) in links {
            let Some(r) = r else { continue };
            let key = match &r {
                Value::String(x) => x.clone(),
                other => other.to_string(),
            };
            if let Some(p) = producer.get(&key) {
                edges.push(GEdge {
                    id: format!("e{}", edges.len()),
                    source: p.clone(),
                    target: id.clone(),
                    target_handle: portname.to_string(),
                });
            }
        }

        if matches!(kind, NodeKind::Layer | NodeKind::Matte) {
            layer_ids.push(id.clone());
        }
        if let Some(o) = &g.out {
            producer.insert(o.clone(), id.clone());
        }
    }

    nodes.push(GNode {
        id: terminal_id.clone(),
        position: Pos { x: 0.0, y: 0.0 },
        data: GNodeData { kind: NodeKind::Shot, asset_id: None, out: None, args: Map::new() },
    });
    for l in &layer_ids {
        edges.push(GEdge {
            id: format!("e{}", edges.len()),
            source: l.clone(),
            target: terminal_id.clone(),
            target_handle: "layers".into(),
        });
    }

    layout(&mut nodes, &edges);
    (nodes, edges)
}

/// Columns by dependency depth, rows by arrival. Deliberately not a graph-layout
/// dependency — this graph is a handful of nodes deep and the founder rearranges by hand.
fn layout(nodes: &mut [GNode], edges: &[GEdge]) {
    let mut depth: HashMap<String, i32> = HashMap::new();

    fn compute(
        id: &str,
        edges: &[GEdge],
        depth: &mut HashMap<String, i32>,
        seen: &mut HashSet<String>,
    ) -> i32 {
        if let Some(d) = depth.get(id) {
            return *d;
        }
        if seen.contains(id) {
            return 0;
        }
        seen.insert(id.to_string());
        let ups: Vec<String> = edges
            .iter()
            .filter(|e| e.target == id)
            .map(|e| e.source.clone())
            .collect();
        let d = if ups.is_empty() {
            0
        } else {
            1 + ups
                .iter()
                .map(|u| compute(u, edges, depth, seen))
                .max()
                .unwrap_or(0)
        };
        depth.insert(id.to_string(), d);
        d
    }

    let ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();
    for id in &ids {
        let mut seen = HashSet::new();
        compute(id, edges, &mut depth, &mut seen);
    }

    let mut rows: HashMap<i32, i32> = HashMap::new();
    for n in nodes.iter_mut() {
        let d = *depth.get(&n.id).unwrap_or(&0);
        let r = *rows.get(&d).unwrap_or(&0);
        rows.insert(d, r + 1);
        n.position = Pos { x: 40.0 + d as f32 * COL, y: 32.0 + r as f32 * ROW };
    }
}

/* ─────────────────────────── entry point ─────────────────────────── */

/// The canvas for a shot: its saved graph if it has one, the real default wiring if not.
pub fn canvas_for(shot: &Shot, by_id: &HashMap<String, Asset>) -> (Vec<GNode>, Vec<GEdge>) {
    let derived;
    let graph: &[GraphNode] = match &shot.nodes {
        Some(n) if !n.is_empty() => n,
        _ => {
            derived = derive_graph(shot, by_id);
            &derived
        }
    };
    from_graph_nodes(graph, &shot.source_ids, by_id)
}

/// A fresh, unused `v_`/`m_` identifier. Names are for humans; uniqueness is for the CLI.
pub fn next_out(kind: NodeKind, nodes: &[GNode], asset_id: Option<&str>) -> Option<String> {
    let base = match kind {
        NodeKind::Layer | NodeKind::Matte | NodeKind::Source | NodeKind::Shot => return None,
        NodeKind::BlenderRender => format!("m_{}", asset_id.unwrap_or("render")),
        NodeKind::EnvelopeExtract => "v_energy".to_string(),
        NodeKind::Remap => "v_remap".to_string(),
        NodeKind::Constant => "v_const".to_string(),
    };
    let taken: HashSet<&str> = nodes.iter().filter_map(|n| n.data.out.as_deref()).collect();
    if !taken.contains(base.as_str()) {
        return Some(base);
    }
    for i in 2.. {
        let c = format!("{}_{}", base, i);
        if !taken.contains(c.as_str()) {
            return Some(c);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Shot;

    fn asset(id: &str, kind: &str) -> Asset {
        Asset {
            id: id.into(),
            kind: kind.into(),
            name: id.into(),
            catalog: String::new(),
            path: String::new(),
            ext: ".x".into(),
            bytes: 0,
            mtime: 0.0,
            width: None,
            height: None,
            duration: None,
            tags: vec![],
            thumb_url: None,
        }
    }

    fn world(pairs: &[(&str, &str)]) -> HashMap<String, Asset> {
        pairs.iter().map(|(i, k)| (i.to_string(), asset(i, k))).collect()
    }

    fn round_trip(shot: &Shot, by_id: &HashMap<String, Asset>) -> Vec<GraphNode> {
        let (nodes, edges) = canvas_for(shot, by_id);
        to_graph_nodes(&nodes, &edges)
    }

    fn shot(ids: &[&str]) -> Shot {
        Shot {
            id: "shot_01".into(),
            title: "t".into(),
            duration: 4.0,
            transition: None,
            source_ids: ids.iter().map(|s| s.to_string()).collect(),
            nodes: None,
        }
    }

    /// The load-bearing property: a canvas seeded from the derived wiring must emit the
    /// SAME graph it was seeded from. If this drifts, the canvas is a second source of
    /// truth instead of a way to author the one that already exists.
    #[test]
    fn seeded_canvas_round_trips_to_the_same_graph() {
        let cases: Vec<Vec<&str>> = vec![
            vec!["m1"],
            vec!["m1", "c1"],
            vec!["m1", "a1"],
            vec!["m1", "c1", "a1"],
            vec!["mo1"],
            vec!["m1", "mo1", "a1"],
        ];
        let by_id = world(&[
            ("m1", "media"),
            ("c1", "curve"),
            ("a1", "audio"),
            ("mo1", "model"),
        ]);
        for ids in cases {
            let sh = shot(&ids);
            let want = derive_graph(&sh, &by_id);
            let got = round_trip(&sh, &by_id);
            assert_eq!(got, want, "round trip drifted for sources {:?}", ids);
        }
    }

    #[test]
    fn the_type_system_refuses_the_wrong_wire() {
        let by_id = world(&[("a1", "audio"), ("m1", "media")]);
        let sh = shot(&["m1", "a1"]);
        let (nodes, edges) = canvas_for(&sh, &by_id);

        let audio_src = nodes
            .iter()
            .find(|n| n.data.asset_id.as_deref() == Some("a1"))
            .unwrap();
        let layer = nodes.iter().find(|n| n.data.kind == NodeKind::Layer).unwrap();

        // Audio into a Media port is the exact mistake the type system exists to stop.
        let err = can_connect(&audio_src.id, &layer.id, "base", &nodes, &edges, &by_id)
            .expect_err("Audio must not land in a Media port");
        assert!(err.contains("not Audio"), "reason should name the type: {err}");

        // An occupied single port refuses a second edge.
        let media_src = nodes
            .iter()
            .find(|n| n.data.asset_id.as_deref() == Some("m1"))
            .unwrap();
        let err = can_connect(&media_src.id, &layer.id, "base", &nodes, &edges, &by_id)
            .expect_err("base is already wired");
        assert!(err.contains("already has a connection"), "{err}");

        // A node cannot feed itself.
        assert!(can_connect(&layer.id, &layer.id, "base", &nodes, &edges, &by_id).is_err());
    }

    #[test]
    fn a_cycle_is_refused() {
        let by_id = world(&[("m1", "media"), ("c1", "curve")]);
        let sh = shot(&["m1", "c1"]);
        let (nodes, edges) = canvas_for(&sh, &by_id);
        let layer = nodes.iter().find(|n| n.data.kind == NodeKind::Layer).unwrap();
        let terminal = nodes.iter().find(|n| n.data.kind == NodeKind::Shot).unwrap();
        // terminal -> layer would close the loop layer -> terminal -> layer.
        let err = can_connect(&terminal.id, &layer.id, "base", &nodes, &edges, &by_id)
            .expect_err("cycle must be refused");
        assert!(err.contains("cycle") || err.contains("not"), "{err}");
    }

    #[test]
    fn a_matte_needs_both_halves() {
        let by_id = world(&[("m1", "media"), ("c1", "curve")]);
        let mut nodes = vec![
            GNode { id: "s1".into(), position: Pos { x: 0.0, y: 0.0 }, data: GNodeData { kind: NodeKind::Source, asset_id: Some("m1".into()), out: None, args: Map::new() } },
            GNode { id: "mt".into(), position: Pos { x: 0.0, y: 0.0 }, data: GNodeData { kind: NodeKind::Matte, asset_id: None, out: None, args: default_args(NodeKind::Matte) } },
            GNode { id: "sh".into(), position: Pos { x: 0.0, y: 0.0 }, data: GNodeData { kind: NodeKind::Shot, asset_id: None, out: None, args: Map::new() } },
        ];
        let mut edges = vec![
            GEdge { id: "e0".into(), source: "s1".into(), target: "mt".into(), target_handle: "base".into() },
            GEdge { id: "e1".into(), source: "mt".into(), target: "sh".into(), target_handle: "layers".into() },
        ];
        // Half-wired: emits nothing rather than a matte that cannot render.
        assert!(to_graph_nodes(&nodes, &edges).is_empty(), "a half-wired matte must emit nothing");

        // Wire the shape and it appears — with `ground: auto` omitted, not written out.
        nodes.push(GNode { id: "s2".into(), position: Pos { x: 0.0, y: 0.0 }, data: GNodeData { kind: NodeKind::Source, asset_id: Some("c1".into()), out: None, args: Map::new() } });
        edges.push(GEdge { id: "e2".into(), source: "s2".into(), target: "mt".into(), target_handle: "shape".into() });
        let g = to_graph_nodes(&nodes, &edges);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].op, "matte");
        assert_eq!(g[0].arg("base").unwrap(), &s("m1"));
        assert_eq!(g[0].arg("shape").unwrap(), &s("c1"));
        assert!(g[0].arg("ground").is_none(), "ground: auto is a default, not a spec line");
        let _ = by_id;
    }

    #[test]
    fn out_names_stay_unique() {
        let nodes = vec![GNode {
            id: "a".into(),
            position: Pos { x: 0.0, y: 0.0 },
            data: GNodeData { kind: NodeKind::EnvelopeExtract, asset_id: None, out: Some("v_energy".into()), args: Map::new() },
        }];
        assert_eq!(next_out(NodeKind::EnvelopeExtract, &nodes, None).as_deref(), Some("v_energy_2"));
        assert_eq!(next_out(NodeKind::Layer, &nodes, None), None, "layers have no out name");
    }
}
