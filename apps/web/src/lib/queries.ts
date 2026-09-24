import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import type {
  Account,
  AddressSuggestion,
  AuditEntry,
  AuthEvent,
  AuthSource,
  FailedIp,
  LogLevel,
  LogSource,
  LogView,
  MailDirectionFilter,
  MailLogEntry,
  MailLogStatus,
  Overview,
  OverviewRange,
  Page,
  QueueAction,
  QueueSnapshot,
  ReportAddressesApply,
  SetupStep,
  SetupStepKey,
  SpamHistory,
  WebSession,
  Alias,
  AliasCreate,
  AliasUpdate,
  Contact,
  ContactCreate,
  ContactUpdate,
  DeleteRequest,
  DnsCheckResult,
  Domain,
  DomainCreate,
  DomainDetail,
  DomainUpdate,
  FlagRequest,
  Folder,
  FolderCreate,
  LoginRequest,
  Lockout,
  Mailbox,
  MailboxCreate,
  MailboxUpdate,
  Me,
  Message,
  MessageRef,
  MoveRequest,
  Ok,
  PasswordChange,
  ProfileUpdate,
  Quota,
  ServerStatus,
  SetupCreateRequest,
  SetupHostnameCheckResult,
  SetupStatus,
  Thread,
  ThreadList,
  ThreadSummary,
} from "@ionnet/shared";
import { api, isApiError, setActiveAccount } from "./api";
import { rememberAccounts } from "./accounts";

export const qk = {
  setupStatus: ["setup", "status"] as const,
  me: ["auth", "me"] as const,
  accounts: ["auth", "accounts"] as const,
  folders: ["mail", "folders"] as const,
  threads: (folder: string, q: string) => ["mail", "threads", folder, q] as const,
  thread: (folder: string, id: string) => ["mail", "thread", folder, id] as const,
  message: (folder: string, uid: number) => ["mail", "message", folder, uid] as const,
  quota: ["mail", "quota"] as const,
  contacts: (q: string) => ["contacts", q] as const,
  suggest: (q: string) => ["contacts", "suggest", q] as const,
  domains: ["admin", "domains"] as const,
  domain: (id: string) => ["admin", "domain", id] as const,
  domainDns: (id: string) => ["admin", "domain", id, "dns"] as const,
  setupSteps: ["admin", "setup-steps"] as const,
  status: ["admin", "status"] as const,
  lockouts: ["admin", "lockouts"] as const,
  overview: (range: OverviewRange) => ["admin", "overview", range] as const,
  authEvents: (f: AuthEventFilter) => ["admin", "auth-events", f] as const,
  failedIps: (hours: number) => ["admin", "failed-ips", hours] as const,
  sessions: ["admin", "sessions"] as const,
  mailLog: (f: MailLogFilter) => ["admin", "mail-log", f] as const,
  queue: ["admin", "queue"] as const,
  spam: ["admin", "spam"] as const,
  logs: (f: LogFilter) => ["admin", "logs", f] as const,
  audit: (q: string) => ["admin", "audit", q] as const,
};

export interface AuthEventFilter {
  q?: string;
  result?: "success" | "failed";
  source?: AuthSource;
}
export interface MailLogFilter {
  q?: string;
  direction?: MailDirectionFilter;
  status?: MailLogStatus | "problems";
}
export interface LogFilter {
  source: LogSource;
  level?: LogLevel;
  q?: string;
  own?: boolean;
}

// ---- setup ---------------------------------------------------------------
export const setupStatusQuery = {
  queryKey: qk.setupStatus,
  queryFn: () => api.get<SetupStatus>("/api/setup/status"),
  staleTime: 60_000,
};
export function useSetupStatus() {
  return useQuery(setupStatusQuery);
}
export function setupHeaders(token: string): Record<string, string> {
  return { "X-Setup-Token": token };
}
export const setupApi = {
  verifyToken: (token: string) => api.post<Ok>("/api/setup/verify-token", { token }),
  checkHostname: (token: string, hostname: string) =>
    api.post<SetupHostnameCheckResult>("/api/setup/check-hostname", { hostname }, setupHeaders(token)),
  create: (token: string, body: SetupCreateRequest) =>
    api.post<{ domainId: string; mailboxId: string }>("/api/setup/create", body, setupHeaders(token)),
  dns: (token: string, domainId: string, refresh = false) =>
    api.get<DnsCheckResult>(`/api/setup/dns/${domainId}`, refresh ? { refresh: 1 } : undefined, setupHeaders(token)),
  finish: (token: string) => api.post<Ok>("/api/setup/finish", undefined, setupHeaders(token)),
};

// ---- auth ----------------------------------------------------------------
export const meQuery = {
  queryKey: qk.me,
  queryFn: async () => {
    const me = await api.get<Me>("/api/auth/me");
    setActiveAccount(me.id);
    return me;
  },
  staleTime: 5 * 60_000,
  retry: false,
};
export function useMe() {
  return useQuery(meQuery);
}
export async function fetchMeOrNull(qc: QueryClient): Promise<Me | null> {
  try {
    return await qc.ensureQueryData(meQuery);
  } catch (e) {
    if (isApiError(e) && e.status === 401) return null;
    throw e;
  }
}
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api.post<Me>("/api/auth/login", body),
    onSuccess: (me) => {
      setActiveAccount(me.id);
      rememberAccounts([me]);
      qc.setQueryData(qk.me, me);
    },
  });
}
/** Every mailbox signed in on this browser, with inbox unread counts for the switcher. */
export function useAccounts() {
  return useQuery({
    queryKey: qk.accounts,
    queryFn: async () => {
      const list = await api.get<Account[]>("/api/auth/accounts");
      rememberAccounts(list);
      return list;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileUpdate) => api.patch<Me>("/api/account/profile", body),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}
export function useChangePassword() {
  return useMutation({ mutationFn: (body: PasswordChange) => api.post<Ok>("/api/account/password", body) });
}

// ---- mail ----------------------------------------------------------------
export function useFolders() {
  return useQuery({ queryKey: qk.folders, queryFn: () => api.get<Folder[]>("/api/mail/folders"), staleTime: 30_000 });
}
export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FolderCreate) => api.post<Folder>("/api/mail/folders", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.folders }),
  });
}
export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.del<Ok>(`/api/mail/folders/${encodeURIComponent(path)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.folders }),
  });
}
export function useThreads(folder: string, q: string) {
  return useInfiniteQuery({
    queryKey: qk.threads(folder, q),
    queryFn: ({ pageParam }) =>
      api.get<ThreadList>("/api/mail/threads", { folder, q: q || undefined, cursor: pageParam ?? undefined, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
  });
}
export function useThread(folder: string, id: string | undefined) {
  return useQuery({
    queryKey: qk.thread(folder, id ?? ""),
    queryFn: () => api.get<Thread>(`/api/mail/threads/${encodeURIComponent(id!)}`, { folder }),
    enabled: !!id,
    staleTime: 60_000,
  });
}
export function useMessage(folder: string, uid: number | undefined) {
  return useQuery({
    queryKey: qk.message(folder, uid ?? 0),
    queryFn: () => api.get<Message>(`/api/mail/messages/${encodeURIComponent(folder)}/${uid}`),
    enabled: !!uid,
    staleTime: 60_000,
  });
}
export function useQuota() {
  return useQuery({ queryKey: qk.quota, queryFn: () => api.get<Quota>("/api/mail/quota"), staleTime: 60_000 });
}
export function invalidateMail(qc: QueryClient, folder?: string) {
  void qc.invalidateQueries({ queryKey: qk.folders });
  if (folder) {
    void qc.invalidateQueries({ queryKey: ["mail", "threads", folder] });
    void qc.invalidateQueries({ queryKey: ["mail", "thread", folder] });
  } else {
    void qc.invalidateQueries({ queryKey: ["mail", "threads"] });
    void qc.invalidateQueries({ queryKey: ["mail", "thread"] });
  }
}
type ThreadPages = InfiniteData<ThreadList, string | null>;

/**
 * Apply a change to every cached conversation list and open conversation right away, so the UI answers
 * before the server does. `threadFn`/`messageFn` return the updated item, or null to drop it.
 */
async function patchMailCache(
  qc: QueryClient,
  refs: MessageRef[],
  threadFn: (t: ThreadSummary, hit: number[]) => ThreadSummary | null,
  messageFn: (m: Message) => Message | null,
) {
  await Promise.all([qc.cancelQueries({ queryKey: ["mail", "threads"] }), qc.cancelQueries({ queryKey: ["mail", "thread"] })]);
  const byFolder = new Map<string, Set<number>>();
  for (const r of refs) {
    if (!byFolder.has(r.folder)) byFolder.set(r.folder, new Set());
    byFolder.get(r.folder)!.add(r.uid);
  }
  qc.setQueriesData<ThreadPages>({ queryKey: ["mail", "threads"] }, (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => {
        let removed = 0;
        const threads = page.threads.flatMap((t) => {
          const uids = byFolder.get(t.folder);
          const hit = uids ? t.uids.filter((u) => uids.has(u)) : [];
          if (!hit.length) return [t];
          const next = threadFn(t, hit);
          if (!next) removed++;
          return next ? [next] : [];
        });
        return removed ? { ...page, threads, total: Math.max(0, page.total - removed) } : { ...page, threads };
      }),
    };
  });
  qc.setQueriesData<Thread>({ queryKey: ["mail", "thread"] }, (data) => {
    if (!data) return data;
    const messages = data.messages.flatMap((m) => {
      if (!byFolder.get(m.folder)?.has(m.uid)) return [m];
      const next = messageFn(m);
      return next ? [next] : [];
    });
    return { ...data, messages };
  });
}

function useMailMutation<B extends { messages: MessageRef[] }>(
  path: string,
  threadFn: (body: B) => (t: ThreadSummary, hit: number[]) => ThreadSummary | null,
  messageFn: (body: B) => (m: Message) => Message | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: B) => api.post<Ok>(path, body),
    onMutate: (body) => patchMailCache(qc, body.messages, threadFn(body), messageFn(body)),
    // Success or failure, the server has the last word.
    onSettled: () => invalidateMail(qc),
  });
}

/** A conversation leaves the list once all of its messages are gone; otherwise it just gets shorter. */
const dropFromThread = (t: ThreadSummary, hit: number[]): ThreadSummary | null => {
  const uids = t.uids.filter((u) => !hit.includes(u));
  return uids.length ? { ...t, uids, messageCount: Math.max(1, t.messageCount - hit.length) } : null;
};

export function useFlagMessages() {
  return useMailMutation<FlagRequest>(
    "/api/mail/messages/flags",
    (body) => (t, hit) => {
      const whole = hit.length === t.uids.length;
      const next = { ...t };
      if (body.add.includes("\\Seen") && whole) next.unread = false;
      if (body.remove.includes("\\Seen")) next.unread = true;
      if (body.add.includes("\\Flagged")) next.flagged = true;
      if (body.remove.includes("\\Flagged") && whole) next.flagged = false;
      return next;
    },
    (body) => (m) => {
      const next = { ...m };
      if (body.add.includes("\\Seen")) next.unread = false;
      if (body.remove.includes("\\Seen")) next.unread = true;
      if (body.add.includes("\\Flagged")) next.flagged = true;
      if (body.remove.includes("\\Flagged")) next.flagged = false;
      return next;
    },
  );
}
export function useMoveMessages() {
  return useMailMutation<MoveRequest>(
    "/api/mail/messages/move",
    () => dropFromThread,
    () => () => null,
  );
}
export function useDeleteMessages() {
  return useMailMutation<DeleteRequest>(
    "/api/mail/messages/delete",
    () => dropFromThread,
    () => () => null,
  );
}

// ---- contacts ------------------------------------------------------------
export function useContacts(q: string) {
  return useQuery({ queryKey: qk.contacts(q), queryFn: () => api.get<Contact[]>("/api/contacts", { q: q || undefined }) });
}
export function useSuggest(q: string) {
  return useQuery({
    queryKey: qk.suggest(q),
    queryFn: () => api.get<AddressSuggestion[]>("/api/contacts/suggest", { q }),
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  });
}
export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContactCreate) => api.post<Contact>("/api/contacts", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}
export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ContactUpdate }) => api.patch<Contact>(`/api/contacts/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}
export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Ok>(`/api/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}

// ---- admin ---------------------------------------------------------------
export function useDomains() {
  return useQuery({ queryKey: qk.domains, queryFn: () => api.get<Domain[]>("/api/admin/domains") });
}
export function useDomain(id: string) {
  return useQuery({ queryKey: qk.domain(id), queryFn: () => api.get<DomainDetail>(`/api/admin/domains/${id}`) });
}
export function useDomainDns(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.domainDns(id),
    queryFn: () => api.get<DnsCheckResult>(`/api/admin/domains/${id}/dns`),
    enabled,
    staleTime: 60_000,
  });
}
export function useRefreshDomainDns(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.get<DnsCheckResult>(`/api/admin/domains/${id}/dns`, { refresh: 1 }),
    onSuccess: (r) => {
      qc.setQueryData(qk.domainDns(id), r);
      void qc.invalidateQueries({ queryKey: qk.domains });
    },
  });
}
export function useCreateDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DomainCreate) => api.post<Domain>("/api/admin/domains", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domains });
      void qc.invalidateQueries({ queryKey: qk.setupSteps });
    },
  });
}
export function useUpdateDomain(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DomainUpdate) => api.patch<Domain>(`/api/admin/domains/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domains });
      void qc.invalidateQueries({ queryKey: qk.domain(id) });
      void qc.invalidateQueries({ queryKey: qk.setupSteps });
    },
  });
}
export function useDeleteDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Ok>(`/api/admin/domains/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}
export function useCreateMailbox(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MailboxCreate) => api.post<Mailbox>(`/api/admin/domains/${domainId}/mailboxes`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domain(domainId) });
      void qc.invalidateQueries({ queryKey: qk.setupSteps });
      void qc.invalidateQueries({ queryKey: qk.domains });
    },
  });
}
export function useUpdateMailbox(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MailboxUpdate }) => api.patch<Mailbox>(`/api/admin/mailboxes/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domain(domainId) });
      void qc.invalidateQueries({ queryKey: qk.setupSteps });
      void qc.invalidateQueries({ queryKey: qk.quota });
    },
  });
}
export function useRecalculateQuota(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Mailbox>(`/api/admin/mailboxes/${id}/recalculate-quota`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domain(domainId) });
      void qc.invalidateQueries({ queryKey: qk.quota });
    },
  });
}
export function useDeleteMailbox(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Ok>(`/api/admin/mailboxes/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domain(domainId) });
      void qc.invalidateQueries({ queryKey: qk.setupSteps });
      void qc.invalidateQueries({ queryKey: qk.domains });
    },
  });
}
export function useCreateAlias(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AliasCreate) => api.post<Alias>(`/api/admin/domains/${domainId}/aliases`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domain(domainId) });
      void qc.invalidateQueries({ queryKey: qk.setupSteps });
      void qc.invalidateQueries({ queryKey: qk.domains });
    },
  });
}
export function useUpdateAlias(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AliasUpdate }) => api.patch<Alias>(`/api/admin/aliases/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domain(domainId) });
      void qc.invalidateQueries({ queryKey: qk.setupSteps });
    },
  });
}
export function useDeleteAlias(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Ok>(`/api/admin/aliases/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domain(domainId) });
      void qc.invalidateQueries({ queryKey: qk.setupSteps });
      void qc.invalidateQueries({ queryKey: qk.domains });
    },
  });
}
export function useSetupSteps(enabled = true) {
  return useQuery({ queryKey: qk.setupSteps, queryFn: () => api.get<SetupStep[]>("/api/admin/setup-steps"), enabled, staleTime: 60_000 });
}
function useSetupStepMutation<T>(fn: (body: T) => Promise<SetupStep[]>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (steps) => {
      qc.setQueryData(qk.setupSteps, steps);
      void qc.invalidateQueries({ queryKey: qk.domains });
      void qc.invalidateQueries({ queryKey: ["admin", "domain"] });
    },
  });
}
export function useApplyReportAddresses() {
  return useSetupStepMutation((body: ReportAddressesApply) => api.post<SetupStep[]>("/api/admin/setup-steps/report-addresses", body));
}
export function useSkipSetupStep() {
  return useSetupStepMutation(({ key, skipped }: { key: SetupStepKey; skipped: boolean }) => api.post<SetupStep[]>(`/api/admin/setup-steps/${key}/skip`, { skipped }));
}
export function useServerStatus() {
  return useQuery({ queryKey: qk.status, queryFn: () => api.get<ServerStatus>("/api/admin/status"), refetchInterval: 30_000 });
}
export function useLockouts() {
  return useQuery({ queryKey: qk.lockouts, queryFn: () => api.get<Lockout[]>("/api/admin/lockouts"), refetchInterval: 30_000 });
}
export function useDeleteLockout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.del<Ok>(`/api/admin/lockouts/${encodeURIComponent(key)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.lockouts }),
  });
}

// ---- admin: monitoring -----------------------------------------------------
const browserZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
})();

export function useOverview(range: OverviewRange) {
  return useQuery({
    queryKey: qk.overview(range),
    queryFn: () => api.get<Overview>("/api/admin/overview", { range, tz: browserZone }),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** Newest-first lists paged with `?before=<id>`. */
function usePaged<T>(key: readonly unknown[], path: string, query: Record<string, string | undefined>, refetchInterval?: number) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api.get<Page<T>>(path, { ...query, limit: 50, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval,
  });
}

export function useAuthEvents(f: AuthEventFilter) {
  return usePaged<AuthEvent>(qk.authEvents(f), "/api/admin/auth-events", { q: f.q, result: f.result, source: f.source }, 30_000);
}
export function useFailedIps(hours = 24) {
  return useQuery({ queryKey: qk.failedIps(hours), queryFn: () => api.get<FailedIp[]>("/api/admin/auth-events/failed-ips", { hours }), refetchInterval: 60_000 });
}

export function useWebSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: () => api.get<WebSession[]>("/api/admin/sessions") });
}
export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Ok>(`/api/admin/sessions/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}

export function useAudit(q: string) {
  return usePaged<AuditEntry>(qk.audit(q), "/api/admin/audit", { q: q || undefined });
}

export function useMailLog(f: MailLogFilter) {
  return usePaged<MailLogEntry>(qk.mailLog(f), "/api/admin/mail-log", { q: f.q, direction: f.direction, status: f.status }, 30_000);
}

export function useQueue() {
  return useQuery({ queryKey: qk.queue, queryFn: () => api.get<QueueSnapshot>("/api/admin/queue"), refetchInterval: 15_000 });
}
function useQueueMutation<V>(fn: (v: V) => Promise<Ok>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.queue });
      void qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}
export function useQueueAction() {
  return useQueueMutation(({ queueId, action }: { queueId: string; action: QueueAction }) =>
    api.post<Ok>(`/api/admin/queue/${encodeURIComponent(queueId)}/${action}`),
  );
}
export function useFlushQueue() {
  return useQueueMutation(() => api.post<Ok>("/api/admin/queue/flush"));
}

export function useSpamHistory() {
  return useQuery({ queryKey: qk.spam, queryFn: () => api.get<SpamHistory>("/api/admin/spam-history"), refetchInterval: 30_000 });
}

export function useLogs(f: LogFilter, live: boolean) {
  return useQuery({
    queryKey: qk.logs(f),
    queryFn: () => api.get<LogView>("/api/admin/logs", { source: f.source, level: f.level, q: f.q, own: f.own ? 1 : undefined, limit: 1000 }),
    refetchInterval: live ? 5000 : false,
    placeholderData: keepPreviousData,
  });
}
