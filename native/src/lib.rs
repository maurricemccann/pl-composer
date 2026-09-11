//! PL Composer — the scoring surface, as a real program.
//!
//! The web board (Next.js on Cloudflare Workers) proved the contract: a piece is scored
//! into `GraphNode[]`, emitted as markdown, and `compose_render.py` renders it. A Worker
//! can never invoke local ffmpeg or Blender, so the board had to hand the founder a spec
//! and stop. This crate is the same composer with the loop closed — it reads the library
//! off disk, emits the identical spec, and runs the render itself.
//!
//! `lib/emit.ts` and `lib/graph.ts` remain the reference implementation. Every rule here
//! is a port of a proven one, and `src/bin/emit_spec.rs` exists to prove the port by
//! diffing this crate's artifact against the TypeScript emitter's, byte for byte.

pub mod emit;
pub mod graph;
pub mod types;

pub use emit::{derive_graph, emit_spec, stamp_now};
pub use graph::{
    can_connect, canvas_for, default_args, from_graph_nodes, kind_spec, next_out, output_type,
    to_graph_nodes, GEdge, GNode, GNodeData, NodeKind, Pos, ADDABLE_KINDS,
};
pub use types::{asset_socket, Asset, GraphNode, Manifest, Piece, Shot, SocketType, SOCKET_TYPES};
