import mark from "@/assets/mark.png";
import { Nav } from "@/components/nav";
import { AccountMenu } from "@/components/account-menu";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-wrap items-center justify-between gap-3 border-b bg-sidebar p-4 md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:gap-4 md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-2">
          <img src={mark.src} alt="" width={28} height={28} className="rounded-md" />
          <span className="font-semibold tracking-tight">
            Palang <span className="text-primary">AI</span>
          </span>
        </div>
        <div className="order-last w-full overflow-x-auto md:order-none md:w-auto md:overflow-visible">
          <Nav />
        </div>
        <div className="md:mt-auto md:border-t md:pt-3">
          <AccountMenu />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
