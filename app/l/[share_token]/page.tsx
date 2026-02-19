import type { Metadata } from "next";

import { buildPublicShareUrl, normalizeCanonicalHost } from "@/app/_lib/wishlist-store";

import PublicWishlistClient from "./public-wishlist-client";

type PageProps = {
  params: Promise<{ share_token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { share_token } = await params;
  const canonicalHost = normalizeCanonicalHost(process.env.CANONICAL_HOST);

  return {
    title: "Shared wishlist",
    alternates: {
      canonical: buildPublicShareUrl(canonicalHost, share_token),
    },
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function PublicWishlistPage({ params }: PageProps) {
  const { share_token } = await params;
  return <PublicWishlistClient shareToken={share_token} />;
}
