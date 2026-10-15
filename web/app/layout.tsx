import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { ControlsProvider } from "@/lib/controls";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ринок комікс-застосунків",
  description: "Comics / webtoon / manga apps: Sensor Tower net revenue, downloads and growth",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body className="min-h-screen font-sans antialiased">
        <ControlsProvider>
          <Nav />
          <main className="mx-auto max-w-7xl space-y-8 px-4 py-6">{children}</main>
        </ControlsProvider>
      </body>
    </html>
  );
}
