import { Nav } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { logout } from "../login/actions";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex items-center justify-between gap-4 border-b p-4 md:w-56 md:flex-col md:items-stretch md:justify-start md:border-r md:border-b-0">
        <div className="px-3 font-semibold">Palang AI</div>
        <Nav />
        <form action={logout} className="md:mt-auto">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
            Sign out
          </Button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
