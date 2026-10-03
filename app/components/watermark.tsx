import { WATERMARKS, type Watermark } from "~/lib/theme";

// Every watermark a theme may pick, each hidden until the theme on the page
// shows its own (printTheme in app/lib/theme.ts). The shapes are seamux's;
// a theme only colours them, through --watermark-1 to --watermark-6.

// A heart in a 24 by 22 box.
const HEART =
  "M12 21.6 10.3 20C4.2 14.6 0 10.9 0 6.4 0 2.8 2.8 0 6.4 0c2 0 4 .9 5.6 2.4C13.6.9 15.6 0 17.6 0 21.2 0 24 2.8 24 6.4c0 4.5-4.2 8.2-10.3 13.6L12 21.6Z";

const STRIPES = 6;

// Six stripes, top to bottom, clipped to the heart.
function PrideHeart() {
  const clip = "watermark-pride-heart-clip";
  return (
    <svg
      viewBox="0 0 24 22"
      aria-hidden="true"
      focusable="false"
      className="watermark watermark-pride-heart"
    >
      <defs>
        <clipPath id={clip}>
          <path d={HEART} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {Array.from({ length: STRIPES }, (_, i) => (
          <rect
            key={i}
            x={0}
            y={(i * 22) / STRIPES}
            width={24}
            // A hair taller, so no seam shows between stripes.
            height={22 / STRIPES + 0.05}
            style={{ fill: `var(--watermark-${i + 1})` }}
          />
        ))}
      </g>
    </svg>
  );
}

const DRAWN: Record<Watermark, () => React.ReactNode> = {
  "pride-heart": PrideHeart,
};

export function Watermarks() {
  return (
    <>
      {WATERMARKS.map((name) => {
        const Shape = DRAWN[name];
        return <Shape key={name} />;
      })}
    </>
  );
}
