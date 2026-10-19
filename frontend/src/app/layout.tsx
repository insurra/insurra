import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/lib/session";
import { AuthProvider } from "@/lib/auth";
import { UserContextProvider } from "@/lib/user-context";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insurra · AI Insurance Companion",
  description: "Your context-aware AI insurance decision and action companion.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        <AuthProvider>
          <SessionProvider>
            <UserContextProvider>
              <AppShell>{children}</AppShell>
            </UserContextProvider>
          </SessionProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
