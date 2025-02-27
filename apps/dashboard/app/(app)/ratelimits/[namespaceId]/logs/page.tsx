import { getTenantId } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";

import { CopyButton } from "@/components/dashboard/copy-button";
import { Loading } from "@/components/dashboard/loading";
import { Navbar as SubMenu } from "@/components/dashboard/navbar";
import { Navbar } from "@/components/navbar";
import { PageContent } from "@/components/page-content";
import { TimestampInfo } from "@/components/timestamp-info";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clickhouse } from "@/lib/clickhouse";
import { Gauge } from "@unkey/icons";
import { Empty } from "@unkey/ui";
import { Check, X } from "lucide-react";
import { parseAsArrayOf, parseAsBoolean, parseAsIsoDateTime, parseAsString } from "nuqs/server";
import { Suspense } from "react";
import { navigation } from "../constants";
import { Filters } from "./filter";
import { Menu } from "./menu";

export const dynamic = "force-dynamic";
export const runtime = "edge";

type Props = {
  params: {
    namespaceId: string;
  };
  searchParams: {
    after?: string;
    before?: string;
    identifier?: string | string[];
    ipAddress?: string | string[];
    country?: string | string[];
    success?: string;
  };
};

/**
 * Parse searchParam string arrays
 */
const stringParser = parseAsArrayOf(parseAsString).withDefault([]);

export default async function AuditPage(props: Props) {
  const tenantId = getTenantId();

  const namespace = await db.query.ratelimitNamespaces.findFirst({
    where: (table, { eq, and, isNull }) =>
      and(eq(table.id, props.params.namespaceId), isNull(table.deletedAt)),
    with: {
      workspace: true,
    },
  });
  if (!namespace || namespace.workspace.tenantId !== tenantId) {
    return notFound();
  }

  const selected = {
    identifier: stringParser.parseServerSide(props.searchParams.identifier),
    ipAddress: stringParser.parseServerSide(props.searchParams.ipAddress),
    country: stringParser.parseServerSide(props.searchParams.country),
    success: parseAsBoolean.parseServerSide(props.searchParams.success),
    after: parseAsIsoDateTime.parseServerSide(props.searchParams.after),
    before: parseAsIsoDateTime.parseServerSide(props.searchParams.before),
  };

  return (
    <div>
      <Navbar>
        <Navbar.Breadcrumbs icon={<Gauge />}>
          <Navbar.Breadcrumbs.Link href="/ratelimits">Ratelimits</Navbar.Breadcrumbs.Link>
          <Navbar.Breadcrumbs.Link href={`/ratelimits/${props.params.namespaceId}`} isIdentifier>
            {namespace.name}
          </Navbar.Breadcrumbs.Link>
          <Navbar.Breadcrumbs.Link href={`/ratelimits/${props.params.namespaceId}/logs`} active>
            Logs
          </Navbar.Breadcrumbs.Link>
        </Navbar.Breadcrumbs>
        <Navbar.Actions>
          <Badge
            key="namespaceId"
            variant="secondary"
            className="flex justify-between w-full gap-2 font-mono font-medium ph-no-capture"
          >
            {props.params.namespaceId}
            <CopyButton value={props.params.namespaceId} />
          </Badge>
        </Navbar.Actions>
      </Navbar>
      <PageContent>
        <SubMenu navigation={navigation(props.params.namespaceId)} segment="logs" />

        <div className="flex flex-col gap-8 mt-8">
          <Filters />
          <Suspense
            fallback={
              <div className="flex justify-center item-center mx-auto">
                <Loading />
              </div>
            }
          >
            <AuditLogTable
              workspaceId={namespace.workspace.id}
              namespaceId={namespace.id}
              selected={selected}
            />
          </Suspense>
        </div>
      </PageContent>
    </div>
  );
}

const AuditLogTable: React.FC<{
  workspaceId: string;
  namespaceId: string;
  selected: {
    identifier: string[];
    ipAddress: string[];
    country: string[];
    success: boolean | null;
    before: Date | null;
    after: Date | null;
  };
}> = async ({ workspaceId, namespaceId, selected }) => {
  const isFiltered =
    selected.identifier.length > 0 ||
    selected.ipAddress.length > 0 ||
    selected.country.length > 0 ||
    selected.before ||
    selected.after ||
    typeof selected.success === "boolean";

  const query = {
    workspaceId: workspaceId,
    namespaceId: namespaceId,
    start: selected.before?.getTime() ?? undefined,
    end: selected.after?.getTime() ?? undefined,
    identifier: selected.identifier.length > 0 ? selected.identifier : undefined,
    country: selected.country.length > 0 ? selected.country : undefined,
    ipAddress: selected.ipAddress.length > 0 ? selected.ipAddress : undefined,

    passed: selected.success ?? undefined,
  };
  const logs = await clickhouse.ratelimits.logs(query).then((res) => res.val!);

  if (logs.length === 0) {
    return (
      <Empty>
        <Empty.Icon />
        <Empty.Title>No logs found</Empty.Title>
        {isFiltered ? (
          <div className="flex flex-col items-center gap-2">
            <Empty.Description>
              No events matched these filters, try changing them.
            </Empty.Description>
          </div>
        ) : (
          <Empty.Description>
            Create, update or delete something and come back again.
          </Empty.Description>
        )}
      </Empty>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Identifier</TableHead>
            <TableHead>Passed</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((l) => (
            <TableRow key={l.request_id}>
              <TableCell>
                <div className="px-[2px] flex items-center hover:underline hover:decoration-dotted">
                  <TimestampInfo value={l.time} className="text-sm" />
                </div>
              </TableCell>

              <TableCell>
                <Badge variant="secondary" className="font-mono text-xs">
                  {l.identifier}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs text-content">
                  {l.passed ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <X className="w-4 h-4 text-content-alert" />
                  )}
                </span>
              </TableCell>
              <TableCell>
                <Menu namespace={{ id: namespaceId }} identifier={l.identifier} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
