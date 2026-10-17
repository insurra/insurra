import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/lib/session";
import { AuthProvider } from "@/lib/auth";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insurra · AI Insurance Companion",
  description: "Pendamping asuransi untuk langkah yang lebih pasti.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" data-scroll-behavior="smooth">
      <body>
        <AuthProvider>
          <SessionProvider>
            <AppShell>{children}</AppShell>
          </SessionProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
