// Each card's path carries a colour for the project it belongs to, so cards
// from one repo can be spotted at a glance. A worktree
// (`.claude/worktrees/<name>` or `worktrees/<name>`) belongs to its repo.
export function projectOf(cwd: string): string {
  return cwd.replace(/\/(?:\.claude\/)?worktrees\/[^/]+(?:\/.*)?$/, "");
}

// The picker's colours: twelve bright, saturated hues, each one a colour of
// its own name. Evenly spaced hues crowd the cool end, where cyan, blue and
// purple sit close together, so these are picked by hand: blue, violet and
// magenta are about 30 degrees apart, and each is as vivid as its hue allows.
export const PALETTE = [
  "oklch(0.64 0.24 25)", // red
  "oklch(0.71 0.21 48)", // orange
  "oklch(0.77 0.19 70)", // amber
  "oklch(0.85 0.2 92)", // yellow
  "oklch(0.84 0.24 129)", // lime
  "oklch(0.72 0.22 150)", // green
  "oklch(0.78 0.15 182)", // teal
  "oklch(0.79 0.15 212)", // cyan
  "oklch(0.62 0.21 260)", // blue
  "oklch(0.61 0.25 293)", // violet
  "oklch(0.67 0.29 322)", // magenta
  "oklch(0.66 0.24 354)", // pink
];

// A project with no picked colour gets one of the palette's, hashed from its
// path, the same on every poll and every reload. FNV-1a picks it.
export function hashedColor(project: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < project.length; i++) {
    h ^= project.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PALETTE[(h >>> 0) % PALETTE.length];
}
