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
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
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
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
