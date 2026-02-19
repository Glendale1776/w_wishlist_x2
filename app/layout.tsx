import type { Metadata } from "next";
import "./globals.css";

import { CursorStarTail } from "@/app/_components/cursor-star-tail";
import { GlobalHeader } from "@/app/_components/global-header";

export const metadata: Metadata = {
  title: "I WISH ...",
  description: "Wishlist app foundation",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <GlobalHeader />
        <CursorStarTail />
        <div className="pt-16 sm:pt-[72px]">{children}</div>
      </body>
    </html>
  );
}
