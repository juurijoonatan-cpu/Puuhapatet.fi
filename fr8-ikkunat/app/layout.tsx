import type { Metadata } from "next";
import { Onest, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const onest = Onest({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-onest",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FR8 — Ikkunanpesu",
  description: "FR8 - VANHA TKK Ikkunanpesujärjestelmä · Bulevardi 31",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fi"
      className={`${onest.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="h-full bg-black text-white antialiased">{children}</body>
    </html>
  );
}
