import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";
import logo from "@/assets/logo.png";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-brand-navy p-4">
      <img src={logo.src} alt="Palang AI" width={200} height={200} />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Enter the dashboard password.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
