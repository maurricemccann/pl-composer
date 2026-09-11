"use client";

import { useState } from "react";

/**
 * The emitted spec, shown as the artifact it is.
 *
 * Deliberately not a toast or a silent download: the markdown is the product, so the
 * founder sees the exact text the CLI will read before it leaves the board. Copy puts
 * it on the clipboard; Download writes the .md; the command line underneath is the
 * literal next step, because a spec with no way to run it is half a deliverable.
 */
export default function SpecSheet({
  spec,
  pieceName,
  onClose,
}: {
  spec: string;
  pieceName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const file = `${pieceName || "untitled-piece"}.spec.md`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(spec);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([spec], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/25"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[720px] flex-col border-l rule bg-[var(--color-bg)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Emitted spec"
      >
        <header className="flex shrink-0 items-baseline justify-between border-b rule px-4 py-2.5">
          <div>
            <div className="text-[16px]" style={{ fontFamily: "var(--font-display)" }}>
              The spec
            </div>
            <div className="num text-[10px] text-[var(--color-muted)]">{file}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="border rule px-2.5 py-1 text-[12px] hover:bg-[var(--color-surface-2)]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={download}
              className="border border-[var(--color-gold)] bg-[var(--color-gold)]/12 px-2.5 py-1 text-[12px] hover:bg-[var(--color-gold)]/20"
            >
              Download
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="px-1.5 text-[15px] leading-none text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            >
              ×
            </button>
          </div>
        </header>

        <pre className="num min-h-0 flex-1 overflow-auto whitespace-pre px-4 py-3 text-[11.5px] leading-[1.6]">
          {spec}
        </pre>

        <footer className="shrink-0 border-t rule bg-[var(--color-surface)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
            Then render it
          </div>
          <code className="num mt-1 block text-[11px] text-[var(--color-text-dim)]">
            python compose_render.py {file}
          </code>
          <div className="mt-1.5 text-[11px] text-[var(--color-muted)]">
            In <span className="num">OpenMontage/projects/pl-curves</span>. The board
            emits; the CLI renders.
          </div>
        </footer>
      </div>
    </div>
  );
}
