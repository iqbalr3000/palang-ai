import { PageHeader } from "@/components/page-header";
import { admin } from "@/lib/admin";

export default async function ConfigPage() {
  const config = await (await admin()).config();
  return (
    <>
      <PageHeader
        title="Config"
        description="Effective gateway config, read-only. Edit palang.yaml and restart the gateway to change it. Secrets are redacted."
      />
      <pre className="overflow-auto rounded-md border bg-muted p-4 text-xs">
        {JSON.stringify(config, null, 2)}
      </pre>
    </>
  );
}
