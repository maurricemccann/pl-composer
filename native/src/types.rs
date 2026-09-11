//! The Composer type system — spec §5, ported from `lib/types.ts`.
//!
//! This is the load-bearing part. Edges are typed and strictly validated; get the
//! types right and the spec emission writes itself. Everything here describes
//! INTENT. Nothing in this file computes pixels — the CLI evaluates.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/* ─────────────────────────── sockets ─────────────────────────── */

/// The socket types. Order matters only for display.
///
/// `Model` is the seventh, added S263 on the founder's ruling after phase 1 shipped
/// with 153 indexed .blend files that no socket could accept. It is deliberately NOT
/// interchangeable with Media: geometry has to be rendered before it is pixels, and
/// `BlenderRender` is the only edge out of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SocketType {
    Media,
    Curve,
    Audio,
    Value,
    Model,
    Shot,
    Spec,
}

pub const SOCKET_TYPES: [SocketType; 7] = [
    SocketType::Media,
    SocketType::Curve,
    SocketType::Audio,
    SocketType::Value,
    SocketType::Model,
    SocketType::Shot,
    SocketType::Spec,
];

impl SocketType {
    pub fn label(self) -> &'static str {
        match self {
            SocketType::Media => "Media",
            SocketType::Curve => "Curve",
            SocketType::Audio => "Audio",
            SocketType::Value => "Value",
            SocketType::Model => "Model",
            SocketType::Shot => "Shot",
            SocketType::Spec => "Spec",
        }
    }

    /// What it carries, and the one-line reason it exists as its own type. Kept as
    /// data rather than comments so the UI can show it on hover.
    pub fn carries(self) -> &'static str {
        match self {
            SocketType::Media => "File-backed pixels",
            SocketType::Curve => "A curves-library element",
            SocketType::Audio => "A track",
            SocketType::Value => "A number, constant or time-varying",
            SocketType::Model => "Geometry — a .blend, .glb, .fbx",
            SocketType::Shot => "What a card resolves to",
            SocketType::Spec => "Terminal",
        }
    }

    pub fn why(self) -> &'static str {
        match self {
            SocketType::Media => "Stills and video. Baked.",
            SocketType::Curve => "Parametric, not baked — it can be driven. That is why it is not Media.",
            SocketType::Audio => "The only source that produces motion from nothing.",
            SocketType::Value => "An envelope, a slider and an LFO are all Value. Envelope is a flavour, not a type.",
            SocketType::Model => "Not pixels yet. Render it to get Media; that stage is never implicit.",
            SocketType::Shot => "Exactly one per card.",
            SocketType::Spec => "The markdown.",
        }
    }

    /// pl-os palette tokens, not new invented hues. The graph canvas is the one place
    /// the spec allows boldness to be spent (§11), and typed sockets being colour-coded
    /// is what makes a dense graph readable at a glance.
    pub fn rgb(self) -> [u8; 3] {
        match self {
            SocketType::Media => [0xc9, 0xa8, 0x4c], // gold — the house accent
            SocketType::Curve => [0x9b, 0x72, 0xcf], // philosophy violet — the parametric one
            SocketType::Audio => [0x2d, 0x8a, 0x6e], // process green — generates motion
            SocketType::Value => [0x5f, 0x93, 0xa3], // info slate — deliberately quietest
            SocketType::Model => [0xb0, 0x7d, 0x2a], // warn amber — one render from usable
            SocketType::Shot => [0xc0, 0x39, 0x2b],  // proof red — a resolved shot asserts
            SocketType::Spec => [0x1a, 0x15, 0x10],  // ink — terminal
        }
    }
}

/* ─────────────────────────── assets (read-only) ─────────────────────────── */

/// One row of the CLI-produced manifest. The app reads this and never writes it.
/// `kind` is lowercase because it is the CLI's vocabulary, not the socket vocabulary —
/// `asset_socket()` is the single place the two are mapped.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub catalog: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub ext: String,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub mtime: f64,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub thumb_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub manifest_version: u32,
    #[serde(default)]
    pub generated: String,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

/// Which socket an asset plugs into. Every indexed kind has one (S263).
/// Returns `None` for a kind the manifest carries that this build does not know —
/// fail visible rather than silently defaulting it to Media.
pub fn asset_socket(kind: &str) -> Option<SocketType> {
    match kind {
        "media" => Some(SocketType::Media),
        "curve" => Some(SocketType::Curve),
        "audio" => Some(SocketType::Audio),
        "model" => Some(SocketType::Model),
        _ => None,
    }
}

/* ─────────────────────────── the piece ─────────────────────────── */

/// One operation in a shot's graph.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphNode {
    pub op: String,
    /// Node-local value identifier this node produces, e.g. "v_energy".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out: Option<String>,
    #[serde(default)]
    pub args: Map<String, Value>,
}

impl GraphNode {
    pub fn arg(&self, k: &str) -> Option<&Value> {
        self.args.get(k)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shot {
    pub id: String,
    pub title: String,
    pub duration: f64,
    /// How this shot ENTERS — `dissolve 0.5`, `black`, `cut` (S264). Shot 01's is
    /// ignored: it has nothing to come from, and a fade in from black is a different
    /// decision that should be asked for, not inferred. Absent = inherit the piece's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<String>,
    /// Asset ids this shot draws on. The graph is what wires them; this is the summary
    /// the spine card renders without touching graph state.
    #[serde(rename = "sourceIds", default)]
    pub source_ids: Vec<String>,
    /// Set once the graph canvas has been used. While absent the emitter derives a real
    /// default wiring from the sources — not a placeholder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<GraphNode>>,
}

/// How a shot enters — it crossfades out of the shot before it (S264).
///
/// Deliberately six words, not ffmpeg's fifty. Nearly all of the rest are gimmicks
/// that would read as somebody else's brand. `dissolve` maps to ffmpeg's `fade`, not
/// its `dissolve` — that one is a noisy random-pixel effect, which is not what the
/// word means to anyone.
pub const TRANSITIONS: [&str; 6] = ["cut", "dissolve", "black", "white", "wipe", "slide"];

/// What each one does, for the picker — nobody should have to render to find out.
pub fn transition_why(name: &str) -> &'static str {
    match name {
        "cut" => "Nothing. The next shot is simply there.",
        "dissolve" => "One picture becomes the other.",
        "black" => "Out through black, then in. The longest pause.",
        "white" => "Out through white. Louder than black — use it once.",
        "wipe" => "The next shot pushes up over this one.",
        "slide" => "Both move together, upward.",
        _ => "",
    }
}

/// The house default when a piece asks for transitions without saying how long.
pub const TRANSITION_SECONDS: f64 = 0.4;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Piece {
    pub piece: String,
    pub target: String,
    pub fps: f64,
    pub resolution: String,
    /// Piece-wide default every shot inherits unless it overrides. Absent = all cuts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<String>,
    #[serde(default)]
    pub shots: Vec<Shot>,
}

impl Default for Piece {
    fn default() -> Self {
        Piece {
            piece: "untitled-piece".into(),
            target: "remotion → openmontage".into(),
            fps: 30.0,
            resolution: "1080x1920".into(),
            // Cuts by default. Transitions are a decision, not a house style — a
            // new piece should not quietly arrive with crossfades nobody asked for.
            transition: None,
            shots: Vec::new(),
        }
    }
}

impl Piece {
    /// Total runtime. The spine header shows this; the emitted spec records it.
    pub fn duration(&self) -> f64 {
        self.shots.iter().map(|s| s.duration).sum()
    }
}
