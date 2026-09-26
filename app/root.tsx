import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { THEME_KEY } from "~/components/theme-toggle";
import { isSecured, requireAuth } from "~/lib/auth.server";
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

export function loader({ request }: Route.LoaderArgs) {
  return { secured: isSecured(request) };
}

export function Layout({ children }: { children: React.ReactNode }) {
  // Undefined while an error renders without data: assume secured rather
  // than flash the warning.
  const unsecured = useRouteLoaderData<typeof loader>("root")?.secured === false;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-unsecured={unsecured ? "" : undefined}
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
        <meta name="theme-color" content={unsecured ? "#3A0B0B" : "#0B1220"} />
        <Meta />
        <Links />
        {/* Use the theme chosen with the header toggle, else follow the OS;
            shadcn tokens key off the .dark class. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{const k=${JSON.stringify(THEME_KEY)};const m=matchMedia("(prefers-color-scheme: dark)");const s=()=>{let t=null;try{t=JSON.parse(localStorage.getItem(k))}catch{}document.documentElement.classList.toggle("dark",t==="dark"||(t!=="light"&&m.matches))};s();m.addEventListener("change",s)})()`,
          }}
        />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

const HEALED_KEY = "seamux:healed-at";

// Fetch every module the page loaded again, past the browser's cache, then
// reload. A page that came back after the board restarted can hold modules
// its browser cached as immutable beside newer ones, and fail on every
// render (two copies of React, most often); a plain reload keeps them.
async function reloadFresh() {
  const urls = new Set(
    performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .concat(
        [...document.querySelectorAll<HTMLLinkElement>("link[rel=modulepreload]")].map(
          (l) => l.href,
        ),
      )
      .filter((u) => {
        const url = new URL(u, location.href);
        return (
          url.origin === location.origin &&
          /^\/(node_modules|app|@)/.test(url.pathname)
        );
      }),
  );
  await Promise.allSettled(
    [...urls].map((u) => fetch(u, { cache: "reload" })),
  );
  location.reload();
}

// Once a minute at most, so a failure the cache didn't cause can't loop.
let healing = false;
function healOnce() {
  if (healing) return;
  healing = true;
  try {
    const last = Number(sessionStorage.getItem(HEALED_KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(HEALED_KEY, String(Date.now()));
  } catch {
    return;
  }
  void reloadFresh();
}

// No hooks here: when React is what broke, the boundary still has to work.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const thrown = !isRouteErrorResponse(error);
  if (thrown && typeof window !== "undefined") healOnce();
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
      {thrown && (
        <button
          type="button"
          onClick={() => void reloadFresh()}
          className="my-4 cursor-pointer rounded-lg border px-3 py-1.5"
        >
          Reload, fetching everything fresh
        </button>
      )}
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
