// A snapshot of how this browser lays the board out: the viewport and media
// queries, which stylesheets it has and whether they carry the phone rules,
// and every column's and card's size and computed style. The Debug tab's
// switch sends one to the server, for triage from a phone.

export type Snapshot = Record<string, unknown>;

// Recent errors, kept whether or not diagnostics are on, so a snapshot can
// show what went wrong before it was taken.
const errors: { at: string; message: string }[] = [];
if (typeof window !== "undefined") {
  const keep = (message: string) => {
    errors.push({ at: new Date().toISOString(), message: message.slice(0, 500) });
    if (errors.length > 20) errors.shift();
  };
  window.addEventListener("error", (e) =>
    keep(`${e.message} (${e.filename}:${e.lineno}:${e.colno})`),
  );
  window.addEventListener("unhandledrejection", (e) =>
    keep(`unhandled rejection: ${String(e.reason)}`),
  );
}

// Rules the phone layout depends on, as they appear escaped in a stylesheet.
const PROBES = {
  "max-md:hidden": "max-md\\:hidden",
  "max-md:text-sm": "max-md\\:text-sm",
  "max-md:*:shrink-0": "max-md\\:\\*\\:shrink-0",
  "md:hidden": "md\\:hidden",
};

const MEDIA = [
  "(width < 48rem)",
  "(max-width: 767.98px)",
  "(pointer: coarse)",
  "(hover: hover)",
  "(display-mode: standalone)",
  "(prefers-color-scheme: dark)",
];

function visible(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  // checkVisibility is missing before Safari 17.4.
  const check = (el as { checkVisibility?: () => boolean }).checkVisibility;
  return check ? check.call(el) : el.offsetParent !== null;
}

function box(el: Element) {
  const r = el.getBoundingClientRect();
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
  };
}

function safeArea() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const s = getComputedStyle(probe);
  const inset = {
    top: s.paddingTop,
    right: s.paddingRight,
    bottom: s.paddingBottom,
    left: s.paddingLeft,
  };
  probe.remove();
  return inset;
}

function stylesheets() {
  return [...document.styleSheets].map((sheet) => {
    const owner = sheet.ownerNode as HTMLElement | null;
    let text = "";
    let rules: number | string = 0;
    try {
      const list = [...sheet.cssRules];
      rules = list.length;
      text = list.map((r) => r.cssText).join("\n");
    } catch (e) {
      rules = `unreadable: ${(e as Error).message}`;
    }
    return {
      href: sheet.href,
      owner: owner
        ? `${owner.tagName.toLowerCase()}${[...owner.attributes]
            .filter((a) => a.name.startsWith("data-") || a.name === "href")
            .map((a) => ` ${a.name}="${a.value.slice(0, 80)}"`)
            .join("")}`
        : null,
      rules,
      bytes: text.length,
      has: Object.fromEntries(
        Object.entries(PROBES).map(([name, escaped]) => [
          name,
          text.includes(escaped),
        ]),
      ),
    };
  });
}

function columns() {
  return [...document.querySelectorAll<HTMLElement>("[data-column]")].map(
    (col) => {
      const s = getComputedStyle(col);
      return {
        column: col.dataset.column,
        ...box(col),
        display: s.display,
        flexDirection: s.flexDirection,
        overflowY: s.overflowY,
        classes: col.className,
        items: [...col.children].map((child) => {
          const cs = getComputedStyle(child);
          const card = child.matches("[data-slot=card]")
            ? child
            : child.querySelector("[data-slot=card]");
          const content = card?.querySelector("[data-slot=card-content]");
          const openChat = [...(card?.querySelectorAll("button") ?? [])].find(
            (b) => b.textContent?.includes("Open chat"),
          );
          return {
            tag: child.tagName.toLowerCase(),
            ...box(child),
            flexShrink: cs.flexShrink,
            minHeight: cs.minHeight,
            card: card
              ? {
                  name: card
                    .querySelector("[data-slot=card-title]")
                    ?.textContent?.slice(0, 40),
                  ...box(card),
                  overflow: getComputedStyle(card).overflow,
                  fontSize: content ? getComputedStyle(content).fontSize : null,
                  openChat: openChat
                    ? { visible: visible(openChat), ...box(openChat) }
                    : "missing",
                  replyInputVisible: visible(card.querySelector("form input")),
                }
              : null,
          };
        }),
      };
    },
  );
}

async function serviceWorker() {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const registrations = await navigator.serviceWorker
    .getRegistrations()
    .catch(() => []);
  return {
    controlled: navigator.serviceWorker.controller !== null,
    registrations: registrations.map((r) => ({
      scope: r.scope,
      active: r.active?.state ?? null,
      waiting: r.waiting?.state ?? null,
    })),
  };
}

export async function collectDiagnostics(
  reason: string,
  versions: { loaded?: string; board?: string },
): Promise<Snapshot> {
  const vv = window.visualViewport;
  const carousel = document.querySelector("[data-column]")?.parentElement;
  return {
    reason,
    at: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    versions,
    viewport: {
      inner: [innerWidth, innerHeight],
      client: [
        document.documentElement.clientWidth,
        document.documentElement.clientHeight,
      ],
      visual: vv
        ? { w: vv.width, h: vv.height, scale: vv.scale, top: vv.offsetTop }
        : null,
      screen: [screen.width, screen.height],
      orientation: screen.orientation?.type ?? null,
      dpr: devicePixelRatio,
      pageScrollY: scrollY,
      docScrollW: document.documentElement.scrollWidth,
    },
    media: Object.fromEntries(MEDIA.map((q) => [q, matchMedia(q).matches])),
    supports: {
      ":is()": CSS.supports("selector(:is(a))"),
      "range media": CSS.supports("(width < 1px)") || null,
      dvh: CSS.supports("height", "100dvh"),
      nesting: CSS.supports("selector(&)"),
    },
    safeArea: safeArea(),
    stylesheets: stylesheets(),
    carousel: carousel
      ? {
          display: getComputedStyle(carousel).display,
          ...box(carousel),
          scrollLeft: carousel.scrollLeft,
          scrollW: carousel.scrollWidth,
          activeTab:
            document.querySelector<HTMLElement>("[role=tab][aria-selected=true]")
              ?.dataset.tab ?? null,
        }
      : null,
    columns: columns(),
    serviceWorker: await serviceWorker(),
    errors: [...errors],
  };
}
