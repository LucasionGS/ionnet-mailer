import { useDomainDns } from "@/lib/queries";
import { Badge } from "@/components/ui";

export function DomainDnsBadge({ id }: { id: string }) {
  const { data, isLoading } = useDomainDns(id);
  if (isLoading || !data) return <Badge tone="neutral">DNS …</Badge>;
  const required = data.records.filter((r) => r.group === "required");
  const ok = required.filter((r) => r.status === "ok").length;
  if (data.allRequiredOk) return <Badge tone="success" dot>DNS ok</Badge>;
  return (
    <Badge tone={ok === 0 ? "danger" : "warning"} dot>
      DNS {ok}/{required.length}
    </Badge>
  );
}
