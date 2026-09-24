import { useRouteLoaderData } from "react-router";

import type { loader } from "~/root";

// Without SEAMUX_USER / SEAMUX_PASS the board is open to anything that can
// reach the port, and every place it names itself says so.
export function productName(secured: boolean): string {
  return secured ? "seamux" : "seamux (unsecured)";
}

// For meta functions, which can't use hooks: the root match carries the flag.
export function productNameFromMatches(
  matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined>,
): string {
  const root = matches.find((m) => m?.id === "root")?.loaderData as
    | { secured?: boolean }
    | undefined;
  return productName(root?.secured ?? true);
}

export function useProductName(): string {
  const root = useRouteLoaderData<typeof loader>("root");
  return productName(root?.secured ?? true);
}
