import { LocalTime } from "@/components/local-time";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { admin } from "@/lib/admin";
import { CreateKeyForm } from "./create-key-form";
import { RevokeButton } from "./revoke-button";

export default async function KeysPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const params = await searchParams;
  const client = await admin();
  const tenants = await client.tenants();
  const tenant = tenants.find((t) => t.id === params.tenant)?.id ?? tenants[0]?.id;

  if (!tenant) {
    return (
      <>
        <PageHeader title="API keys" />
        <p className="text-sm text-muted-foreground">No tenants are configured.</p>
      </>
    );
  }
  const keys = await client.keys(tenant);

  return (
    <>
      <PageHeader title="API keys" description="Keys clients use to call the gateway, per tenant.">
        <form method="get" className="flex items-center gap-2">
          <NativeSelect name="tenant" defaultValue={tenant} aria-label="Tenant">
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
      </PageHeader>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Create a key for {tenant}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Keyed by tenant so a shown key is cleared when switching tenants. */}
          <CreateKeyForm key={tenant} tenant={tenant} />
        </CardContent>
      </Card>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No keys for this tenant yet.
                </TableCell>
              </TableRow>
            ) : (
              keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                  <TableCell>
                    <LocalTime iso={k.created_at} dateOnly />
                  </TableCell>
                  <TableCell>
                    {k.last_used_at ? <LocalTime iso={k.last_used_at} /> : "Never"}
                  </TableCell>
                  <TableCell>
                    {k.revoked_at ? (
                      <span className="text-sm text-muted-foreground">Revoked</span>
                    ) : (
                      <span className="text-sm text-action-allow">Active</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!k.revoked_at && <RevokeButton keyId={k.id} name={k.name} />}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
