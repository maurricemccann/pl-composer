//! End-to-end over the founder's real piece and the real library.
//!
//! This is the failure a scoring surface must never have: you open the app, click through
//! the shots to look at them, save, and the emitted spec has quietly changed. Opening a
//! shot is not a read — it builds a canvas, and saving writes that canvas back as the
//! shot's explicit graph. If the canvas is not a perfectly faithful representation of the
//! derived wiring, simply *looking* at a piece edits it.
//!
//! So this walks the whole path the app walks — derive → canvas → Snarl → canvas → graph
//! → markdown — and asserts the artifact is identical to the one emitted before any of it
//! happened. Unit tests already prove each hop; this proves the hops compose, over the
//! founder's actual 9-shot piece against the live 2.13MB manifest rather than fixtures.
//!
//! Skips itself with a printed reason when the real files are not on this machine, rather
//! than passing silently — a green test that checked nothing is worse than no test.

use plcomposer::bridge::{canvas_of, snarl_of};
use plcomposer::{canvas_for, emit_spec, to_graph_nodes, Asset, Manifest, Piece};
use std::collections::HashMap;

const MANIFEST: &str = r"C:\dev\OpenMontage\projects\pl-curves\manifest.json";
const STAMP: &str = "2026-09-11 03:00 PT";

fn load() -> Option<(Piece, Vec<Asset>)> {
    let piece_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../the-practice-v1.piece.json");
    let piece: Piece = serde_json::from_str(&std::fs::read_to_string(piece_path).ok()?).ok()?;
    let manifest: Manifest = serde_json::from_str(&std::fs::read_to_string(MANIFEST).ok()?).ok()?;
    Some((piece, manifest.assets))
}

#[test]
fn opening_every_shot_and_saving_does_not_change_the_spec() {
    let Some((piece, assets)) = load() else {
        eprintln!("skipped: the real piece or manifest is not on this machine");
        return;
    };
    let by_id: HashMap<String, Asset> = assets.iter().map(|a| (a.id.clone(), a.clone())).collect();

    let before = emit_spec(&piece, &assets, STAMP);

    // Exactly what the app does: open each shot, then commit it back.
    let mut after_piece = piece.clone();
    for i in 0..after_piece.shots.len() {
        let (nodes, edges) = canvas_for(&after_piece.shots[i], &by_id);
        let snarl = snarl_of(&nodes, &edges);
        let (back_nodes, back_edges, _) = canvas_of(&snarl);
        after_piece.shots[i].nodes = Some(to_graph_nodes(&back_nodes, &back_edges));
    }
    let after = emit_spec(&after_piece, &assets, STAMP);

    if before != after {
        // Name the first divergence — "they differ" sends the next session re-deriving
        // what this run already knew.
        let (b, a): (Vec<&str>, Vec<&str>) = (before.lines().collect(), after.lines().collect());
        for (n, (lb, la)) in b.iter().zip(a.iter()).enumerate() {
            assert_eq!(lb, la, "first divergence at line {}", n + 1);
        }
        panic!("specs differ in length: {} vs {} lines", b.len(), a.len());
    }

    assert!(before.contains("piece: the-practice-v1"));
    assert_eq!(after_piece.shots.len(), 9, "the real piece is 9 shots");
}

/// The emitted duration must equal the sum of the shots, because that number is what the
/// renderer trims the audio bed to — a drift here is a silent length mismatch in the file.
#[test]
fn the_header_duration_is_the_sum_of_the_shots() {
    let Some((piece, assets)) = load() else {
        eprintln!("skipped: the real piece or manifest is not on this machine");
        return;
    };
    let md = emit_spec(&piece, &assets, STAMP);
    let total: f64 = piece.shots.iter().map(|s| s.duration).sum();
    assert!(
        md.contains(&format!("duration: {total:.1}")),
        "header duration should be {total:.1}"
    );
}
