//! Parity harness — phase 1's entire deliverable.
//!
//! Mirrors `scripts/emit-spec.mjs` argument for argument so the two can be run over the
//! same inputs and diffed:
//!
//! ```text
//!   emit-spec <piece.json> <manifest.json> <out.spec.md> [--created "<stamp>"]
//! ```
//!
//! `--created` pins the one line that legitimately differs between runs, so a diff
//! compares the artifact rather than the minute it ran in. Without it the real clock is
//! used, exactly like the TypeScript emitter.
//!
//! This is a convenience for proving the port, not a second source of truth.

use plcomposer::{emit_spec, stamp_now, Manifest, Piece};
use std::collections::HashSet;
use std::process::ExitCode;

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut positional: Vec<String> = Vec::new();
    let mut created: Option<String> = None;
    let mut it = argv.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--created" => created = it.next(),
            _ => positional.push(a),
        }
    }
    if positional.len() != 3 {
        eprintln!("usage: emit-spec <piece.json> <manifest.json> <out.spec.md> [--created \"<stamp>\"]");
        return ExitCode::from(1);
    }

    let piece: Piece = match read_json(&positional[0]) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("could not read piece {}: {e}", positional[0]);
            return ExitCode::from(1);
        }
    };
    let manifest: Manifest = match read_json(&positional[1]) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("could not read manifest {}: {e}", positional[1]);
            return ExitCode::from(1);
        }
    };

    // Same pre-flight the .mjs does: an id the manifest does not carry is a silent black
    // shot at render time, so it fails here instead.
    let known: HashSet<&str> = manifest.assets.iter().map(|a| a.id.as_str()).collect();
    let mut missing: Vec<&str> = piece
        .shots
        .iter()
        .flat_map(|s| s.source_ids.iter())
        .map(|s| s.as_str())
        .filter(|id| !known.contains(id))
        .collect();
    missing.sort_unstable();
    missing.dedup();
    if !missing.is_empty() {
        eprintln!("these ids are not in the manifest: {}", missing.join(", "));
        return ExitCode::from(1);
    }

    let stamp = created.unwrap_or_else(stamp_now);
    let md = emit_spec(&piece, &manifest.assets, &stamp);
    if let Err(e) = std::fs::write(&positional[2], &md) {
        eprintln!("could not write {}: {e}", positional[2]);
        return ExitCode::from(1);
    }
    println!(
        "{}: {} shots, {} chars -> {}",
        piece.piece,
        piece.shots.len(),
        md.chars().count(),
        positional[2]
    );
    ExitCode::SUCCESS
}

fn read_json<T: serde::de::DeserializeOwned>(path: &str) -> Result<T, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
