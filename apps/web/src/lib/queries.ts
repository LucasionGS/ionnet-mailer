import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  AddressSuggestion,
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
} from "@ionnet/shared";
import { api, isApiError } from "./api";

export const qk = {
  setupStatus: ["setup", "status"] as const,
  me: ["auth", "me"] as const,
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
  status: ["admin", "status"] as const,
  lockouts: ["admin", "lockouts"] as const,
};

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
  queryFn: () => api.get<Me>("/api/auth/me"),
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
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Ok>("/api/auth/logout"),
    onSettled: () => {
      qc.clear();
    },
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
export function useFlagMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FlagRequest) => api.post<Ok>("/api/mail/messages/flags", body),
    onSuccess: () => invalidateMail(qc),
  });
}
export function useMoveMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MoveRequest) => api.post<Ok>("/api/mail/messages/move", body),
    onSuccess: () => invalidateMail(qc),
  });
}
export function useDeleteMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeleteRequest) => api.post<Ok>("/api/mail/messages/delete", body),
    onSuccess: () => invalidateMail(qc),
  });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domains }),
  });
}
export function useUpdateDomain(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DomainUpdate) => api.patch<Domain>(`/api/admin/domains/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domains });
      void qc.invalidateQueries({ queryKey: qk.domain(id) });
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
      void qc.invalidateQueries({ queryKey: qk.domains });
    },
  });
}
export function useUpdateMailbox(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MailboxUpdate }) => api.patch<Mailbox>(`/api/admin/mailboxes/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domain(domainId) }),
  });
}
export function useDeleteMailbox(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Ok>(`/api/admin/mailboxes/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domain(domainId) });
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
      void qc.invalidateQueries({ queryKey: qk.domains });
    },
  });
}
export function useUpdateAlias(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AliasUpdate }) => api.patch<Alias>(`/api/admin/aliases/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domain(domainId) }),
  });
}
export function useDeleteAlias(domainId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Ok>(`/api/admin/aliases/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.domain(domainId) });
      void qc.invalidateQueries({ queryKey: qk.domains });
    },
  });
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
