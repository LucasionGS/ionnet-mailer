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
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s.redirect === "string" ? { redirect: s.redirect } : {},
  beforeLoad: async ({ context, search }) => {
    const me = await fetchMeOrNull(context.queryClient);
    if (me) throw redirect({ to: search.redirect ?? "/mail" });
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
  component: () => <Outlet />,
});
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/admin/domains" });
  },
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

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  authedRoute.addChildren([
    indexRoute,
    mailIndexRoute,
    mailFolderRoute.addChildren([mailThreadRoute]),
    contactsRoute,
    settingsRoute,
    adminRoute.addChildren([adminIndexRoute, adminDomainsRoute, adminDomainDetailRoute, adminStatusRoute]),
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
