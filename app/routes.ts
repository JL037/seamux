import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sessions/:sessionId/messages", "routes/session-messages.ts"),
  route("sessions/:sessionId/action", "routes/session-action.ts"),
] satisfies RouteConfig;
