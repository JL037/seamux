// Each card's path carries a colour for the project it belongs to, so cards
// from one repo can be spotted at a glance. A worktree
// (`.claude/worktrees/<name>` or `worktrees/<name>`) belongs to its repo.
export function projectOf(cwd: string): string {
  return cwd.replace(/\/(?:\.claude\/)?worktrees\/[^/]+(?:\/.*)?$/, "");
}

// The picker's colours: 12 hues from red (25) to blue (265), about 22 degrees
// apart, at one lightness and chroma so every hue is equally legible. The
// ramp stops at blue rather than wrapping round through purple, so its first
// and last colours stay far apart.
export const PALETTE = Array.from(
  { length: 12 },
  (_, i) => `oklch(0.7 0.15 ${Math.round(25 + (i * 240) / 11)})`,
);

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
