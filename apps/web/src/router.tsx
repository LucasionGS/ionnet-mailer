import { type QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { fetchMeOrNull, setupStatusQuery } from "./lib/queries";
import { AppShell } from "./components/AppShell";
import { SetupPage } from "./routes/Setup";
import { LoginPage } from "./routes/Login";
import { MailPage } from "./routes/Mail";
import { ContactsPage } from "./routes/Contacts";
import { SettingsPage } from "./routes/Settings";
import { AdminDomainsPage } from "./routes/admin/Domains";
import { AdminDomainDetailPage } from "./routes/admin/DomainDetail";
import { AdminStatusPage } from "./routes/admin/Status";
import { AdminLayout } from "./routes/admin/AdminLayout";
import { AdminOverviewPage } from "./routes/admin/Overview";
import { AdminMailPage, type MailSearch } from "./routes/admin/MailFlow";
import { AdminSecurityPage, type SecuritySearch } from "./routes/admin/Security";
import { AdminLogsPage, type LogsSearch } from "./routes/admin/Logs";
import { AdminSetupStepsPage } from "./routes/admin/SetupSteps";
import { AuthSourceSchema, LogLevelSchema, LogSourceSchema, MailDirectionFilterSchema, MailLogStatusSchema, OverviewRangeSchema, type OverviewRange } from "@ionnet/shared";
import { NotFoundPage } from "./routes/NotFound";

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQuery);
    const onSetup = location.pathname.startsWith("/setup");
    if (!status.completed && !onSetup) throw redirect({ to: "/setup" });
    if (status.completed && onSetup) throw redirect({ to: "/login" });
    return { setup: status };
  },
  component: () => <Outlet />,
  notFoundComponent: NotFoundPage,
});

const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/setup", component: SetupPage });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  // `add` signs in to another mailbox while staying signed in to the current one; `email` fills in the address.
  validateSearch: (s: Record<string, unknown>): { redirect?: string; add?: boolean; email?: string } =>
    strip({ redirect: text(s.redirect), add: s.add === true || s.add === "true" ? true : undefined, email: text(s.email) }),
  beforeLoad: async ({ context, search }) => {
    const me = await fetchMeOrNull(context.queryClient);
    if (me && !search.add) throw redirect({ to: search.redirect ?? "/mail" });
  },
  component: LoginPage,
});

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  beforeLoad: async ({ context, location }) => {
    const me = await fetchMeOrNull(context.queryClient);
    if (!me) throw redirect({ to: "/login", search: { redirect: location.href } });
    return { me };
  },
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/mail/$folder", params: { folder: "INBOX" } });
  },
});

const mailIndexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/mail",
  beforeLoad: () => {
    throw redirect({ to: "/mail/$folder", params: { folder: "INBOX" } });
  },
});

const mailFolderRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/mail/$folder",
  validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s.q === "string" && s.q ? { q: s.q } : {}),
  component: MailPage,
});

const mailThreadRoute = createRoute({
  getParentRoute: () => mailFolderRoute,
  path: "/$threadId",
  component: () => null,
});

const contactsRoute = createRoute({ getParentRoute: () => authedRoute, path: "/contacts", component: ContactsPage });
const settingsRoute = createRoute({ getParentRoute: () => authedRoute, path: "/settings", component: SettingsPage });

const adminRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/admin",
  beforeLoad: ({ context }) => {
    if (!context.me.isAdmin) throw redirect({ to: "/mail/$folder", params: { folder: "INBOX" } });
  },
  component: AdminLayout,
});
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/admin/overview" });
  },
});

/** Keeps a search param only if it is a non-empty string the schema accepts. */
function param<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, v: unknown): T | undefined {
  const r = schema.safeParse(v);
  return r.success ? r.data : undefined;
}
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const adminOverviewRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/overview",
  validateSearch: (s: Record<string, unknown>): { range?: OverviewRange } => strip({ range: param(OverviewRangeSchema, s.range) }),
  component: AdminOverviewPage,
});
const adminMailRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/mail",
  validateSearch: (s: Record<string, unknown>): MailSearch =>
    strip({
      tab: s.tab === "log" || s.tab === "queue" || s.tab === "spam" ? s.tab : undefined,
      q: text(s.q),
      direction: param(MailDirectionFilterSchema, s.direction),
      status: s.status === "problems" ? ("problems" as const) : param(MailLogStatusSchema, s.status),
    }),
  component: AdminMailPage,
});
const adminSecurityRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/security",
  validateSearch: (s: Record<string, unknown>): SecuritySearch =>
    strip({
      tab: s.tab === "signins" || s.tab === "lockouts" || s.tab === "sessions" || s.tab === "audit" ? s.tab : undefined,
      q: text(s.q),
      result: s.result === "success" || s.result === "failed" ? s.result : undefined,
      source: param(AuthSourceSchema, s.source),
    }),
  component: AdminSecurityPage,
});
const adminLogsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/logs",
  validateSearch: (s: Record<string, unknown>): LogsSearch =>
    strip({ source: param(LogSourceSchema, s.source), level: param(LogLevelSchema, s.level), q: text(s.q) }),
  component: AdminLogsPage,
});
const adminDomainsRoute = createRoute({ getParentRoute: () => adminRoute, path: "/domains", component: AdminDomainsPage });
const adminDomainDetailRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/domains/$id",
  validateSearch: (s: Record<string, unknown>): { tab?: "mailboxes" | "aliases" | "dns" | "settings" } =>
    s.tab === "mailboxes" || s.tab === "aliases" || s.tab === "dns" || s.tab === "settings" ? { tab: s.tab } : {},
  component: AdminDomainDetailPage,
});
const adminStatusRoute = createRoute({ getParentRoute: () => adminRoute, path: "/status", component: AdminStatusPage });
const adminSetupStepsRoute = createRoute({ getParentRoute: () => adminRoute, path: "/setup", component: AdminSetupStepsPage });

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  authedRoute.addChildren([
    indexRoute,
    mailIndexRoute,
    mailFolderRoute.addChildren([mailThreadRoute]),
    contactsRoute,
    settingsRoute,
    adminRoute.addChildren([
      adminIndexRoute,
      adminOverviewRoute,
      adminSetupStepsRoute,
      adminDomainsRoute,
      adminDomainDetailRoute,
      adminMailRoute,
      adminSecurityRoute,
      adminLogsRoute,
      adminStatusRoute,
    ]),
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
