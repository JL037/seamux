import { useId } from "react";

// The mark from ~/brain/assets/seamux: cmux's chevron on its side as a sail,
// a mast behind it and a waterline beneath. At 24px and below it drops the
// mast and thickens the sail and wave, as the asset README asks.
export function SeamuxMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const ramp = useId();
  const small = size <= 24;
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      aria-hidden
      className={className}
    >
      <defs>
        <linearGradient id={ramp} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--brand-primary)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-secondary)" }} />
        </linearGradient>
      </defs>
      {small ? (
        <>
          <g transform="rotate(-90 128 128)">
            <path
              d="M70 46 L196 128 L70 210 L70 168 L133 128 L70 88 Z"
              fill={`url(#${ramp})`}
            />
          </g>
          <path
            d="M40 216 Q74 198 108 216 T176 216 T216 216"
            fill="none"
            className="stroke-brand-secondary"
            strokeWidth="20"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <rect
            x="124"
            y="54"
            width="8"
            height="150"
            rx="4"
            className="fill-brand-primary"
            opacity="0.55"
          />
          <g transform="rotate(-90 128 128)">
            <path
              d="M70 52 L192 128 L70 204 L70 166 L131 128 L70 90 Z"
              fill={`url(#${ramp})`}
            />
          </g>
          <path
            d="M44 210 Q70 196 96 210 T148 210 T200 210 T212 206"
            fill="none"
            className="stroke-brand-secondary"
            strokeWidth="10"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
