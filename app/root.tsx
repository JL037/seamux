import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import type { Route } from "./+types/root";
import { StuckBoard } from "~/components/stuck-board";
import { THEME_KEY } from "~/components/theme-toggle";
import { BLUR_KEY } from "~/lib/use-blur";
import { Toaster } from "~/components/ui/sonner";
import { requireAuth } from "~/lib/auth.server";
import { DEFAULT_THEME } from "~/lib/theme";
import { readActiveTheme, themeStyles } from "~/lib/theme.server";
import { themeCssWanted, type ThemeStyles } from "~/lib/use-theme";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  // Fetched with credentials, so it gets through the tunnel's Access check
  // like the page did.
  {
    rel: "manifest",
    href: "/manifest.webmanifest",
    crossOrigin: "use-credentials",
  },
];

export const middleware: Route.MiddlewareFunction[] = [requireAuth];

// Every theme's CSS, and the active one. A store that can't be read leaves
// the board on seamux's own theme rather than stopping it.
export function loader(): { themes: ThemeStyles } {
  try {
    return { themes: { ...themeStyles(), active: readActiveTheme() } };
  } catch {
    return {
      themes: { hash: "", css: "", active: { name: DEFAULT_THEME, updatedAt: 0 } },
    };
  }
}

// The board's poll revalidates every loader every few seconds; the themes'
// CSS is fetched again only after an action, or when the poll's hash says
// it changed (useThemeSync).
export function shouldRevalidate({
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod) return defaultShouldRevalidate;
  return themeCssWanted();
}

// JSON for an inline script: nothing in it can close the <script>.
const inline = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

export function Layout({ children }: { children: React.ReactNode }) {
  // Missing on an error page that failed before the loader ran.
  const themes = useRouteLoaderData<typeof loader>("root")?.themes;
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        {/* Drawn edge to edge on a phone, with the safe areas padded in
            app.css; the keyboard shrinks the layout rather than covering it,
            where the browser allows. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="seamux" />
        <meta name="theme-color" content="#0B1220" />
        <Meta />
        <Links />
        {/* Use the theme chosen with the header toggle, else follow the OS;
            shadcn tokens key off the .dark class. When hydration fails,
            React renders <html> afresh and strips every attribute from it,
            so the class is put back whenever it goes missing. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{const k=${JSON.stringify(THEME_KEY)};const r=document.documentElement;const m=matchMedia("(prefers-color-scheme: dark)");const s=()=>{let t=null;try{t=JSON.parse(localStorage.getItem(k))}catch{}const d=t==="dark"||(t!=="light"&&m.matches);if(r.classList.contains("dark")!==d)r.classList.toggle("dark",d)};s();m.addEventListener("change",s);new MutationObserver(s).observe(r,{attributes:true,attributeFilter:["class"]})})()`,
          }}
        />
        {/* Every saved theme, printed from numbers only (app/lib/theme.ts),
            and the active one as data-theme on <html>, before the first
            paint. Kept there if hydration strips it, like the class above;
            useThemeSync changes it. */}
        {themes?.css ? (
          <style
            id="seamux-themes"
            dangerouslySetInnerHTML={{ __html: themes.css.replace(/</g, "") }}
          />
        ) : null}
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{const r=document.documentElement;window.__seamuxTheme=window.__seamuxTheme||${inline(themes?.active ?? { name: DEFAULT_THEME, updatedAt: 0 })};const s=()=>{const n=window.__seamuxTheme.name;const w=n===${inline(DEFAULT_THEME)}?null:n;if(r.getAttribute("data-theme")!==w){if(w===null)r.removeAttribute("data-theme");else r.setAttribute("data-theme",w)}};s();new MutationObserver(s).observe(r,{attributes:true,attributeFilter:["data-theme"]})})()`,
          }}
        />
        {/* Blur for screenshots, from the Debug tab, before the first paint
            so nothing shows unblurred. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{if(JSON.parse(localStorage.getItem(${JSON.stringify(BLUR_KEY)})))document.documentElement.setAttribute("data-blur","")}catch{}})()`,
          }}
        />
      </head>
      <body>
        {children}
        <StuckBoard />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}

// A page that fails as it starts has no Debug tab to send diagnostics from,
// so the error page reports itself: the error, and every script this page
// loaded, by the exact URL it was loaded from. Once per page, and it only
// sends: nothing is reloaded.
let reported = false;
function reportError(error: unknown) {
  if (reported) return;
  reported = true;
  const same = (u: string) => new URL(u, location.href).origin === location.origin;
  const snapshot = {
    reason: "error",
    at: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    error:
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : String(error),
    scripts: performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => same(u) && !u.includes("/diagnostics")),
    modulepreloads: [
      ...document.querySelectorAll<HTMLLinkElement>("link[rel=modulepreload]"),
    ].map((l) => l.href),
  };
  void fetch("/diagnostics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot),
    keepalive: true,
  }).catch(() => {});
}

// No hooks here: when React is what broke, the boundary still has to render.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (!isRouteErrorResponse(error) && typeof window !== "undefined") {
    reportError(error);
  }
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {/* A plain link, not a handler: it has to work when React doesn't. */}
      <p className="my-4">
        <a href="/reset" className="underline">
          Clear this browser's cache for the board, and reload
        </a>
      </p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
