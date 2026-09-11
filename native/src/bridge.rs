//! The one seam between `egui_snarl`'s world and the ported graph rules.
//!
//! Snarl addresses nodes by `NodeId` and ports by index; `graph.rs` — which is the proven
//! rule set — addresses them by string id and port name. Rather than teach either side
//! about the other, every crossing goes through here. Keeping it to one file is what
//! stops the type system quietly acquiring a second implementation inside the UI.
//!
//! Ordering is the subtle part. `to_graph_nodes` decides composite order from the order
//! layers are wired into the terminal, and `Snarl::wires()` gives no ordering guarantee at
//! all. So edges are sorted by (target index, source index) on the way out: deterministic
//! across runs, and for the terminal it reproduces node-insertion order — which for a
//! seeded canvas is exactly the derived wiring's order.

use crate::graph::{kind_spec, GEdge, GNode, GNodeData, NodeKind, Pos};
use egui_snarl::{InPinId, NodeId, OutPinId, Snarl};
use std::collections::HashMap;

/// The name of input port `idx` on a node — `base`, `overlay`, `audio`, `layers`.
pub fn port_name(snarl: &Snarl<GNodeData>, node: NodeId, idx: usize) -> Option<String> {
    let data = snarl.get_node(node)?;
    kind_spec(data.kind).inputs.get(idx).map(|p| p.id.to_string())
}

/// Snarl ▶ the shapes `graph.rs` works in. Also returns the id map, so a caller that
/// already has a `NodeId` (the viewer, mid-connect) can name it without a second pass.
pub fn canvas_of(snarl: &Snarl<GNodeData>) -> (Vec<GNode>, Vec<GEdge>, HashMap<NodeId, String>) {
    let mut ids: HashMap<NodeId, String> = HashMap::new();
    let mut order: HashMap<NodeId, usize> = HashMap::new();
    let mut nodes: Vec<GNode> = Vec::new();

    for (i, (nid, pos, data)) in snarl.nodes_pos_ids().enumerate() {
        let sid = format!("n{i}");
        ids.insert(nid, sid.clone());
        order.insert(nid, i);
        nodes.push(GNode {
            id: sid,
            position: Pos { x: pos.x, y: pos.y },
            data: data.clone(),
        });
    }

    let mut wires: Vec<(usize, usize, NodeId, NodeId, usize)> = snarl
        .wires()
        .filter_map(|(o, i)| {
            Some((
                *order.get(&i.node)?,
                *order.get(&o.node)?,
                o.node,
                i.node,
                i.input,
            ))
        })
        .collect();
    wires.sort_unstable_by_key(|(t, s, _, _, _)| (*t, *s));

    let edges: Vec<GEdge> = wires
        .into_iter()
        .enumerate()
        .filter_map(|(n, (_, _, src, tgt, input))| {
            Some(GEdge {
                id: format!("e{n}"),
                source: ids.get(&src)?.clone(),
                target: ids.get(&tgt)?.clone(),
                target_handle: port_name(snarl, tgt, input)?,
            })
        })
        .collect();

    (nodes, edges, ids)
}

/// The shapes `graph.rs` works in ▶ Snarl. Used whenever a shot is opened: the canvas is
/// rebuilt from the shot's graph (or the derived default), never carried between shots.
pub fn snarl_of(nodes: &[GNode], edges: &[GEdge]) -> Snarl<GNodeData> {
    let mut snarl = Snarl::new();
    let mut ids: HashMap<&str, NodeId> = HashMap::new();

    for n in nodes {
        let id = snarl.insert_node(
            egui::pos2(n.position.x, n.position.y),
            n.data.clone(),
        );
        ids.insert(n.id.as_str(), id);
    }

    for e in edges {
        let (Some(src), Some(tgt)) = (ids.get(e.source.as_str()), ids.get(e.target.as_str())) else {
            continue;
        };
        let Some(data) = snarl.get_node(*tgt) else { continue };
        let Some(idx) = kind_spec(data.kind)
            .inputs
            .iter()
            .position(|p| p.id == e.target_handle)
        else {
            continue;
        };
        snarl.connect(
            OutPinId { node: *src, output: 0 },
            InPinId { node: *tgt, input: idx },
        );
    }

    snarl
}

/// Is there exactly one terminal? A graph can never contain another shot (§4), and a
/// graph with none emits nothing — both are worth saying out loud on the card.
pub fn terminal_count(snarl: &Snarl<GNodeData>) -> usize {
    snarl
        .nodes()
        .filter(|d| d.kind == NodeKind::Shot)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{canvas_for, to_graph_nodes};
    use crate::emit::derive_graph;
    use crate::types::{Asset, Shot};

    fn asset(id: &str, kind: &str) -> Asset {
        Asset {
            id: id.into(), kind: kind.into(), name: id.into(), catalog: String::new(),
            path: String::new(), ext: ".x".into(), bytes: 0, mtime: 0.0, width: None,
            height: None, duration: None, tags: vec![], thumb_url: None,
        }
    }

    /// The property the whole UI rests on: a canvas that has been through Snarl and back
    /// emits the same graph it went in with. If this drifts, the canvas edits the spec by
    /// accident — which is the one failure a scoring surface must never have.
    #[test]
    fn a_round_trip_through_snarl_changes_nothing() {
        let by_id: HashMap<String, Asset> = [("m1", "media"), ("c1", "curve"), ("a1", "audio"), ("mo1", "model")]
            .iter()
            .map(|(i, k)| (i.to_string(), asset(i, k)))
            .collect();

        for ids in [
            vec!["m1"],
            vec!["m1", "c1"],
            vec!["m1", "c1", "a1"],
            vec!["mo1", "a1"],
            vec!["m1", "mo1", "c1", "a1"],
        ] {
            let shot = Shot {
                id: "shot_01".into(),
                title: "t".into(),
                duration: 4.0,
                source_ids: ids.iter().map(|s| s.to_string()).collect(),
                nodes: None,
            };
            let want = derive_graph(&shot, &by_id);

            let (nodes, edges) = canvas_for(&shot, &by_id);
            let snarl = snarl_of(&nodes, &edges);
            let (back_nodes, back_edges, _) = canvas_of(&snarl);
            let got = to_graph_nodes(&back_nodes, &back_edges);

            assert_eq!(got, want, "snarl round trip drifted for {:?}", ids);
        }
    }
}
