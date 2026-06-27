/**
 * ContribGrid — a GitHub-contribution-style activity heatmap, styled in the
 * brand greens, used as an on-brand "momentum / aktiivisuus" visual in the
 * pitch deck. It shows NO live business data on purpose: the pattern is a
 * deterministic, healthy-looking fill seeded by cell index, so it renders
 * identically every time (no Math.random, no flicker, SSR-safe).
 *
 * Self-contained, responsive, and horizontally scrollable on narrow screens.
 */

const ROWS = 7; // weekdays

// Ascending green intensities on a dark slide background. Index 0 = "empty".
const LEVELS = [
  "rgba(255,255,255,0.07)",
  "#2d5016",
  "#3f6e1f",
  "#6aa632",
  "#b8e07a",
];

const FI_MONTHS = ["Tam", "Hel", "Maa", "Huh", "Tou", "Kes", "Hei", "Elo", "Syy", "Lok", "Mar", "Jou"];

/** Deterministic 0..4 intensity for a cell, biased toward "active" so the
 *  board reads as busy/healthy without ever being random. */
function intensity(col: number, row: number): number {
  let x = (col + 1) * 374761393 + (row + 1) * 668265263;
  x = (x ^ (x >> 13)) * 1274126177;
  x = x ^ (x >> 16);
  const u = (x >>> 0) / 4294967295; // 0..1
  if (u < 0.18) return 0;
  if (u < 0.40) return 1;
  if (u < 0.65) return 2;
  if (u < 0.85) return 3;
  return 4;
}

/** Trailing `count` month abbreviations (FI), oldest → newest, ending this month. */
function trailingMonths(count: number): string[] {
  const now = new Date();
  const cur = now.getMonth(); // 0..11
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(FI_MONTHS[((cur - i) % 12 + 12) % 12]);
  }
  return out;
}

export function ContribGrid({ weeks = 26 }: { weeks?: number }) {
  const months = trailingMonths(6);
  const cell = 13;
  const gap = 3;
  const colStep = cell + gap;

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <div style={{ minWidth: weeks * colStep }}>
        {/* Month labels, spread evenly across the board */}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "0 2px 6px", color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600 }}>
          {months.map((m, i) => <span key={`${m}-${i}`}>{m}</span>)}
        </div>

        {/* The grid: columns = weeks, rows = weekdays */}
        <div style={{ display: "flex", gap }}>
          {Array.from({ length: weeks }).map((_, col) => (
            <div key={col} style={{ display: "flex", flexDirection: "column", gap }}>
              {Array.from({ length: ROWS }).map((_, row) => (
                <div
                  key={row}
                  style={{
                    width: cell,
                    height: cell,
                    borderRadius: 3,
                    background: LEVELS[intensity(col, row)],
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, color: "rgba(255,255,255,0.5)", fontSize: 11 }}>
          <span>Vähemmän</span>
          {LEVELS.map((bg, i) => (
            <div key={i} style={{ width: cell, height: cell, borderRadius: 3, background: bg }} />
          ))}
          <span>Enemmän</span>
        </div>
      </div>
    </div>
  );
}
