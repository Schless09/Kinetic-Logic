import { JoinRedirect } from "./JoinRedirect";

/** Only needed when BUILD_FOR_CAPACITOR=1 (static export); ensures /join/[slug] is built. */
export function generateStaticParams() {
  return [{ slug: "default" }];
}

export default function JoinPage() {
  return <JoinRedirect />;
}
