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
import { Toaster } from "~/components/ui/sonner";
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
